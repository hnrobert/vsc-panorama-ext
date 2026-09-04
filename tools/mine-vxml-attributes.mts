import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE } from './paths.mjs';
import { parseVxml } from '../src/core/vxml/parser.ts';
import type { VxmlElement } from '../src/core/vxml/ast.ts';

/**
 * 从真实布局里挖出「运行期 XSD 没有、Valve 自己却在用」的标签与属性，产出
 * `data/vxml-observed-attributes.json`——一个**压制层**，供 Task 7 的
 * `vxml.unknownTag` / `vxml.unknownAttribute` 在判定时静默放行。
 *
 * 为什么需要这一层（D-M4-1，用户拍板）：运行期 XSD
 * （`panorama_generate_layout_xsd`）的属性集**本身不完整**——20260829 一个构建
 * 里就有 554 处合法属性不在集内，光 `Label@value` 就 337 次。数据源被证明不可靠，
 * 「属性不属于该面板」这条规则的级别就从 warning 降为 hint，并用这一层兜底。
 * D-M4-2（同一逻辑推及标签）：标签也收，但标签规则的级别保持 warning。
 *
 * 与 `src/core/data/observed-values.ts` 同性质：**弱可靠**（语料里出现过 !=
 * 引擎支持），因此只能用于**压制**提示，绝不能用于**产生**提示。方向不同、
 * 风险不同：误压制的后果是漏一条 hint，误产生的后果是对着正确代码报错。
 *
 * 挖掘源固定 20260829 单构建（Ruling 16 第 1 条），与 `mine-css-values.mts`
 * 的先例一致，且实测它是 20260716 的真超集（反向只多出
 * `ToggleButton@series-button` 3 次与标签 `CSGOInfoHudLayouts`）。
 */

/** 挖掘源构建。20260829 的 layout/ 外面还包一层 panorama/（20260716 没有，但这里用不到它）。 */
const MINE_BUILD = '20260829';
const LAYOUT_DIR = `${ARCHIVE}/${MINE_BUILD}/panorama/layout`;

/**
 * `<root>` 的骨架元素，不是面板，拿去查 `panels.json` 没有意义——它们若被当成
 * 未知标签收进观测层，Task 7 的 `unknownTag` 会对 `<include>` / `<snippet>`
 * 之类静默放行，掩盖真正的结构错误。
 */
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  'include',
  'root',
  'scripts',
  'snippet',
  'snippets',
  'styles',
]);

/**
 * `data-*`（自定义数据属性）与 `on*`（事件处理器）不进数据文件：它们是**规则层**
 * 的通用豁免——任何面板都可以有任意名字的自定义 data- 属性和事件处理器，逐个
 * 枚举既没完没了（20260829 上已经 33 种 / 267 次），又会让数据文件随语料漂移。
 * 在挖掘阶段就排除，Task 7 那边不查数据直接放行，两侧口径一致。
 */
const EXCLUDED_ATTR_PREFIXES: readonly string[] = ['data-', 'on'];

interface PanelDataShape {
  readonly attributeSets: Record<string, string[]>;
  readonly panels: Record<string, { sets: string[] }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 直接读 `data/panels.json`，而不是 import `src/core/data/panels.ts` 的
 * `PanelRegistry`：那个文件（以及 `src/core/data/` 下的其余几个）引入 JSON 时
 * **不带** `with { type: 'json' }` 导入属性——在 tsc/esbuild 的构建链路下没问题，
 * 但本脚本经 `node --experimental-strip-types` 由 Node 原生 ESM loader 加载，
 * 而它要求 JSON 模块必须带那个导入属性，实测会以
 * `Module ".../panels.json" needs an import attribute of "type: json"` 直接失败
 * （同一个限制已经记在 `test/unit/core/strip-types.test.ts` 的注释里）。
 * 属性集的展开逻辑只有「并起 sets 指向的那几张表」这一句，在这里重写一遍比
 * 为了复用去改三个 core 文件的导入写法划算得多。
 */
function loadAttributeSets(): Map<string, ReadonlySet<string>> {
  const data = JSON.parse(
    readFileSync(resolve(HERE, '../data/panels.json'), 'utf8'),
  ) as PanelDataShape;

  const out = new Map<string, ReadonlySet<string>>();
  for (const [panel, info] of Object.entries(data.panels)) {
    const merged = new Set<string>();
    for (const setName of info.sets) {
      for (const attr of data.attributeSets[setName] ?? []) merged.add(attr);
    }
    out.set(panel, merged);
  }
  return out;
}

function allXml(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allXml(p, out);
    else if (name.endsWith('.xml')) out.push(p);
  }
  return out;
}

function* walkElements(roots: readonly VxmlElement[]): Generator<VxmlElement> {
  const stack = [...roots];
  while (stack.length > 0) {
    const el = stack.pop();
    if (el === undefined) break;
    // 结构标签自己不产出观测记录，但它的子树要照常走——`<snippet>` 里装的正是
    // 一堆真面板，漏掉整棵子树会少收一大片。
    for (const child of el.children) stack.push(child);
    yield el;
  }
}

export interface MinedObservations {
  /** 标签 -> 出现次数；只含 panels.json 里查不到的标签 */
  readonly tags: Record<string, number>;
  /** 标签 -> 属性 -> 出现次数；只含「标签认识、但属性不在该面板属性集里」的组合 */
  readonly attributes: Record<string, Record<string, number>>;
}

/**
 * 挖掘口径：
 * - 结构标签（`STRUCTURAL_TAGS`）整个跳过，只往下走子树；
 * - 标签不在 `panels.json` 的 `panels` 里 → 记标签，**不记它的属性**（不知道
 *   它该有哪些属性，无从判断哪些算缺口；Task 7 必须自己做到「标签不认识就不判
 *   它的属性」，否则那 22 处会被报成 hint）；
 * - 标签认识、属性不在该面板 `sets` 展开后的属性集里 → 记属性；
 * - `data-*` / `on*` 一律不记（见 `EXCLUDED_ATTR_PREFIXES`）。
 */
function mineObservations(
  sources: readonly string[],
  attributeSets: ReadonlyMap<string, ReadonlySet<string>>,
): MinedObservations {
  const tags = new Map<string, number>();
  const attributes = new Map<string, Map<string, number>>();

  for (const text of sources) {
    for (const el of walkElements(parseVxml(text).roots)) {
      if (STRUCTURAL_TAGS.has(el.tag)) continue;

      const known = attributeSets.get(el.tag);
      if (known === undefined) {
        tags.set(el.tag, (tags.get(el.tag) ?? 0) + 1);
        continue;
      }

      for (const attr of el.attributes) {
        if (EXCLUDED_ATTR_PREFIXES.some((p) => attr.name.startsWith(p))) continue;
        if (known.has(attr.name)) continue;
        const perTag = attributes.get(el.tag) ?? new Map<string, number>();
        perTag.set(attr.name, (perTag.get(attr.name) ?? 0) + 1);
        attributes.set(el.tag, perTag);
      }
    }
  }

  // 逐层按名字升序落盘，保证同样输入产出逐字节相同的文件（gen:values 幂等）。
  const sortedRecord = (m: ReadonlyMap<string, number>): Record<string, number> =>
    Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));

  return {
    tags: sortedRecord(tags),
    attributes: Object.fromEntries(
      [...attributes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, perTag]) => [tag, sortedRecord(perTag)]),
    ),
  };
}

const attributeSets = loadAttributeSets();
const files = allXml(LAYOUT_DIR);
const mined = mineObservations(
  files.map((f) => readFileSync(f, 'utf8')),
  attributeSets,
);

const out = resolve(HERE, '../data/vxml-observed-attributes.json');
const kinds = Object.values(mined.attributes).reduce((n, m) => n + Object.keys(m).length, 0);
const uses = Object.values(mined.attributes).reduce(
  (n, m) => n + Object.values(m).reduce((a, b) => a + b, 0),
  0,
);

mkdirSync(dirname(out), { recursive: true });
// JSON.stringify 只产出 \n，Node 不做行尾转换，因此这里写出的就是 LF
// （.gitattributes 对 data/*.json 钉的也是 eol=lf）。
writeFileSync(
  out,
  JSON.stringify(
    {
      source:
        `从 ${MINE_BUILD} 构建的 ${files.length} 个真实布局挖掘（弱可靠：语料里出现过 != 引擎支持）。` +
        '这一层只用于**压制**提示，绝不用于产生提示——运行期 XSD 的属性集本身不完整' +
        '（D-M4-1），此处补的是它的缺口。',
      minedFrom: MINE_BUILD,
      excludedTags: [...STRUCTURAL_TAGS].sort(),
      excludedAttributePrefixes: [...EXCLUDED_ATTR_PREFIXES].sort(),
      tags: mined.tags,
      attributes: mined.attributes,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(
  `已写出 ${out}\n  来源 ${files.length} 个布局（${MINE_BUILD}）` +
    `\n  标签 ${Object.keys(mined.tags).length} 种` +
    `\n  属性 ${uses} 次 / ${kinds} 种，分布在 ${Object.keys(mined.attributes).length} 个面板上`,
);
