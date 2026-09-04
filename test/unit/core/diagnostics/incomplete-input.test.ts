import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import type { VxmlElement } from '../../../../src/core/vxml/ast';
import { symbolsOfVcss } from '../../../../src/core/index/symbols';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { diagnoseVxml } from '../../../../src/core/diagnostics';
import { judgeableAttributes, tagNameSettled } from '../../../../src/core/diagnostics/vxml';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';

/**
 * **通则「信息不完整时不下结论」的横向闸门**（Ruling 25，承接 Ruling 13 / 17 /
 * 19 / 22 / 23+24 那五次逐例应用）。
 *
 * 五条裁决被逐条应用在「当时正在做的那条规则」上，于是最终评审在别的规则里又找到
 * 三处该应用而没应用的（`vxml.unknownClass` / `vxml.unknownAttribute` /
 * `vxml.structure`）。**这份文件不是第六、七、八处的补丁，是那条通则本身的闸门**：
 * 它不认识任何一条具体规则，只认识两件事——
 *
 * 1. **身份未定的构造**（开始标签缺 `>` 的标签名；语法坏掉的属性；未闭合元素的
 *    末尾属性）上，**除 `vxml.syntax` 外一条诊断都不许有**；
 * 2. 判据取自实现自己导出的 `tagNameSettled` / `judgeableAttributes`，不在测试里
 *    抄第二份——抄一份就会分叉，而分叉正是 Ruling 24 当初点名要避免的。
 *
 * 于是**将来新增的第 29 条规则**如果忘了走守卫，只要它把诊断挂在这些位置上，这里
 * 就会红，不需要有人记得回头重扫一遍旧规则。
 *
 * **闸门的边界（有意为之，不是漏）**：判据只覆盖「身份未定」，不覆盖「结构未完」。
 * 元素缺闭合标签时它的身份**已经确定**（`<Frame>` 就是一个 Frame），身份类结论照旧
 * 成立——这是 Ruling 24 收窄那条，推广过去的代价是自上而下写文件时整份文件在敲完
 * 最后一个 `</…>` 之前一条规则都不报。下面「收窄必须活着」一节两个方向各钉一次。
 *
 * 「缺闭合标签」唯一挡住的是**缺失类结论**（「里面没有 X」）：那种结论依赖的恰恰是
 * 「内容已经写完」，容器还没收尾就等于依据还没到齐。见「缺失类结论」一节。
 */
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();

const LAYOUT = '/p/panorama/layout/a.xml';
const HUD = '/p/panorama/layout/custom_game/a.xml';
const A = '/p/panorama/styles/a.css';

/** 索引里只有 `.known` 一个类，其余类名一律「找不到定义」——unknownClass 才有活信号 */
function stubIndex(): WorkspaceIndex {
  const known = new Set([A]);
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));
  const idx = new WorkspaceIndex({ exists });
  idx.update(symbolsOfVcss(A, parseVcss('.known\n{\n\twidth: 1px;\n}')));
  return idx;
}
const index = stubIndex();

const run = (text: string, mode: 'full' | 'customHudLayout' = 'full') =>
  diagnoseVxml(parseVxml(text), {
    uri: mode === 'full' ? LAYOUT : HUD,
    mode,
    panels,
    observed,
    index,
    msg: ZH,
  });
const ids = (text: string, mode: 'full' | 'customHudLayout' = 'full') =>
  run(text, mode).map((d) => d.ruleId);

function* walk(els: readonly VxmlElement[]): Generator<VxmlElement> {
  for (const el of els) {
    yield el;
    yield* walk(el.children);
  }
}

/**
 * 「身份未定」的构造在文档里占据的区间。三种来源与实现里的三个守卫一一对应，
 * 判据直接调实现导出的那两个谓词。
 */
function undecidedRanges(text: string): Array<{ readonly at: string; readonly range: [number, number] }> {
  const out: Array<{ at: string; range: [number, number] }> = [];
  for (const el of walk(parseVxml(text).roots)) {
    if (!tagNameSettled(el)) out.push({ at: `<${el.tag}`, range: [el.tagNameStart, el.tagNameEnd] });
    const judgeable = new Set(judgeableAttributes(text, el));
    for (const a of el.attributes) {
      if (judgeable.has(a)) continue;
      // 取值侧的规则（unknownClass / duplicateId / hud.binding）挂在值里而不是
      // 属性名上，所以区间要一路盖到取值末尾，只盖属性名会漏掉它们。
      out.push({ at: `${a.name}=`, range: [a.nameStart, a.valueEnd ?? a.nameEnd] });
    }
  }
  return out;
}

/**
 * 「编辑中途」的输入。前八条是最终评审逐条实测出症状的那几处，后面是把两份真实
 * 形状的布局按字符截断——自上而下敲文件时每一个中间状态都长这样。
 */
const MID_EDIT: readonly string[] = (() => {
  const seeds = [
    '<root><Panel class="abc></Panel></root>',
    '<root><Panel class="fo',
    '<root><Panel width=10 /></root>',
    '<root><Panel id="a></root>',
    '<root><Panel><Label id="a" /><Label id="a',
    '<root><Panel><ContextMenu',
    '<root><styles><include src="a" /></styles>',
    '<Pane',
    '<root><Panel foo="1" bar="2" cla',
    '<root><Panel class=',
  ];
  const layouts = [
    '<root>\n\t<styles>\n\t\t<include src="s2r://panorama/styles/a.vcss" />\n\t</styles>\n' +
      '\t<Panel class="known" id="Top">\n\t\t<Label text="hi" class="known" />\n' +
      '\t\t<Button class="known"><Label text="go" /></Button>\n\t</Panel>\n</root>\n',
    '<root>\n\t<snippets>\n\t\t<snippet name="row">\n\t\t\t<Panel class="known" id="r" />\n' +
      '\t\t</snippet>\n\t</snippets>\n\t<Panel id="Root2" class="known">\n' +
      '\t\t<Image src="file://x.png" />\n\t</Panel>\n</root>\n',
  ];
  const truncations = layouts.flatMap((t) =>
    [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95].map((f) => t.slice(0, Math.floor(t.length * f))),
  );
  return [...seeds, ...truncations];
})();

describe('通则 · 身份未定的构造上不下结论', () => {
  it('MID_EDIT 里确实存在身份未定的构造——否则下面那条是空转的', () => {
    const withUndecided = MID_EDIT.filter((t) => undecidedRanges(t).length > 0);
    // 24 条输入里至少 15 条含身份未定的构造。写成下限而不是等号，是为了让
    // 将来往 MID_EDIT 里加用例不必回来改数字，同时仍然拦得住「谓词退化成恒真」
    // 这种让闸门空转的坏法（那时这里会掉到 0）。
    expect(withUndecided.length).toBeGreaterThanOrEqual(15);
  });

  it('身份未定的区间上，除 vxml.syntax 外一条诊断都没有（full 与严格模式各跑一遍）', () => {
    const leaks: string[] = [];
    for (const text of MID_EDIT) {
      const undecided = undecidedRanges(text);
      if (undecided.length === 0) continue;
      for (const mode of ['full', 'customHudLayout'] as const) {
        for (const d of run(text, mode)) {
          if (d.ruleId === 'vxml.syntax') continue;
          for (const u of undecided) {
            if (d.start < u.range[1] && u.range[0] < d.end) {
              leaks.push(
                `${mode} ${JSON.stringify(text)} :: ${d.ruleId}@${JSON.stringify(
                  text.slice(d.start, d.end),
                )} 落在身份未定的 ${u.at} 上`,
              );
            }
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe('通则 · 三处最终评审点名的漏网（逐条钉住症状本身）', () => {
  it('评审 I-2：class 缺右引号时不报 vxml.unknownClass，区间不再退化成半行文本', () => {
    const text = '<root><Panel class="abc></Panel></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.syntax']);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('class');
  });

  it('评审 I-2：正在敲的末尾 class 不报 vxml.unknownClass（Ruling 22 同一判据）', () => {
    expect(ids('<root><Panel class="fo')).toEqual(['vxml.syntax']);
  });

  it('评审 I-2 同族：语法坏掉的 id 不报 vxml.rootPanelId', () => {
    expect(ids('<root><Panel id="a></root>')).toEqual(['vxml.syntax']);
  });

  it('评审 I-2 同族：语法坏掉的 id 不报 vxml.duplicateId', () => {
    expect(ids('<root><Panel><Label id="a" /><Label id="a')).toEqual(['vxml.syntax']);
  });

  it('评审 M-1：裸值属性同一个 token 上不再挂两条（full 与严格模式一致）', () => {
    const text = '<root><Panel width=10 /></root>';
    expect(ids(text)).toEqual(['vxml.syntax']);
    expect(ids(text, 'customHudLayout')).toEqual(['vxml.syntax']);
  });

  it('评审 M-2：<root> 还没有闭合标签时不报「下没有根面板」', () => {
    expect(ids('<root><styles><include src="a" /></styles>')).toEqual(['vxml.syntax']);
  });

  it('评审 M-2：只敲了半个标签名时不报「文档缺少 <root>」', () => {
    expect(ids('<Pane')).toEqual(['vxml.syntax']);
  });

  it('未闭合的 rootOnly 面板不报 vxml.rootOnlyNested', () => {
    expect(ids('<root><Panel><ContextMenu')).toEqual(['vxml.syntax']);
  });
});

describe('通则 · 收窄必须活着：身份已定就照旧下结论', () => {
  it('缺闭合标签不影响身份类结论——rootOnly 嵌套照报（Ruling 24 收窄）', () => {
    expect(ids('<root><Panel><ContextMenu></Panel></root>')).toEqual([
      'vxml.rootOnlyNested',
      'vxml.syntax',
    ]);
  });

  it('缺闭合标签不影响 hud.* ——<Frame> 照报（Ruling 24 收窄，error 不做成「写完才生效」）', () => {
    expect(ids('<root><Panel><Frame></Panel></root>', 'customHudLayout')).toContain(
      'hud.snippetsOrFrame',
    );
  });

  it('只跳过坏掉的那一个属性，同元素上写好的属性照判', () => {
    const text = '<root><Panel width=10 bogusattr="x" /></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.syntax', 'vxml.unknownAttribute']);
    expect(text.slice(diags[1].start, diags[1].end)).toBe('bogusattr');
  });

  it('未闭合元素只跳过末尾那个属性，前面写完的照判（Ruling 22 的最小性）', () => {
    const text = '<root><Panel foo="1" bar="2" cla';
    const diags = run(text).filter((d) => d.ruleId === 'vxml.unknownAttribute');
    expect(diags.map((d) => text.slice(d.start, d.end))).toEqual(['foo', 'bar']);
  });

  it('内容已收尾时缺失类结论照报——<Zzzz></Zzzz> 仍然「文档缺少 <root>」', () => {
    expect(ids('<Zzzz></Zzzz>')).toEqual(['vxml.structure', 'vxml.unknownTag']);
  });

  it('容器未收尾只挡「里面没有 X」，不挡「多出来的 X」', () => {
    const text = '<root><Panel /><Panel /></root';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.structure', 'vxml.syntax']);
    expect(diags[0].message).toContain('多出来的');
  });
});
