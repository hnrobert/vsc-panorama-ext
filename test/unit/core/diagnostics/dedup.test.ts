import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { diagnoseVxml, dropNonHudOverlaps } from '../../../../src/core/diagnostics';
import {
  checkVxmlCrossFileWarnings,
  checkVxmlStructure,
  checkVxmlTagsAndAttributes,
} from '../../../../src/core/diagnostics/vxml';
import { checkCustomHudWhitelist } from '../../../../src/core/diagnostics/custom-hud';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import type { Diagnostic, RuleId } from '../../../../src/core/diagnostics/types';

/**
 * Task 9 的后半段 —— 规格 §10.3 末段的去重：**同一处只报一条，§10.3 优先**。
 *
 * 判据是**区间重叠**：某条 `hud.*` 的 `[start, end)` 与某条非 `hud.*` 的区间
 * 重叠时，删掉非 `hud.*` 那条。
 *
 * **去重测试的空转形态（本项目已有十二次前科里最容易中的一种）**：若用例本身
 * 只会产生一条诊断，那么「去重后只剩一条」是恒真的，改坏去重逻辑也不会红。
 * 所以下面每条重叠用例都分两步走：
 *
 *   1. 直接调规则族函数（`checkVxmlStructure` / `checkVxmlTagsAndAttributes` /
 *      `checkCustomHudWhitelist`），证明**不去重时确实是两条**，并断言两条的
 *      区间真的重合；
 *   2. 再跑 `diagnoseVxml`，断言去重后只剩 `hud.*` 那条。
 *
 * 第 1 步不是装饰：它是第 2 步的**前提**。缺了它，第 2 步在「本来就只有一条」
 * 的情况下照样全绿。
 */
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();

const HUD_LAYOUT = '/p/panorama/layout/custom_game/hud.xml';

const strict = (text: string, index?: WorkspaceIndex): Diagnostic[] =>
  diagnoseVxml(parseVxml(text), { uri: HUD_LAYOUT, mode: 'customHudLayout', panels, observed, index, msg: ZH });

/**
 * 不经编排层、不去重的两侧原始产出。
 *
 * `index` 在场时把跨文件那条（`vxml.unknownClass`）也拼进非 hud 一侧——编排层
 * 参与去重的是**含跨文件规则**的那个数组，这里的口径必须与它一致，否则
 * 「不去重时是几条」这个前提对跨文件规则是错的（评审 M-4）。
 */
function raw(text: string, index?: WorkspaceIndex): { nonHud: Diagnostic[]; hud: Diagnostic[] } {
  const doc = parseVxml(text);
  const nonHud = [
    ...checkVxmlStructure(doc, panels, ZH),
    ...checkVxmlTagsAndAttributes(doc, panels, observed, ZH),
    ...(index ? checkVxmlCrossFileWarnings(doc, index, ZH) : []),
  ];
  return { nonHud, hud: checkCustomHudWhitelist(doc, ZH) };
}

/**
 * 与 `cross-file.test.ts` 的 `buildIndex` 同一种构建方式：目录存在性用「是不是
 * 某个文件的路径前缀」模拟，不需要真实文件系统。
 */
function buildIndex(files: Record<string, string>): WorkspaceIndex {
  const known = new Set(Object.keys(files));
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));
  const idx = new WorkspaceIndex({ exists });
  for (const [uri, text] of Object.entries(files)) idx.update(symbolsOfVcss(uri, parseVcss(text)));
  return idx;
}

const at = (d: Diagnostic): string => `${d.ruleId}[${d.start},${d.end})`;
const ids = (list: readonly Diagnostic[]): RuleId[] => list.map((d) => d.ruleId);

// ===========================================================================
// 1. 已确认的两处真实重叠
// ===========================================================================

describe('§10.3 去重 · 真实重叠一：<Button text="…">', () => {
  // XSD 里 ButtonType 确实没有 text（只有 TextButtonType 有），所以 §10.2 的
  // vxml.unknownAttribute 会命中同一个属性名区间。
  const TEXT = '<root><Panel><Button text="Go" /></Panel></root>';

  it('不去重时确实是两条，且区间逐字重合', () => {
    const { nonHud, hud } = raw(TEXT);
    expect(ids(nonHud)).toEqual(['vxml.unknownAttribute']);
    expect(ids(hud)).toEqual(['hud.buttonText']);
    // 重合到偏移量级别——不是「都在同一个元素上」这种含糊说法
    expect([nonHud[0].start, nonHud[0].end]).toEqual([hud[0].start, hud[0].end]);
    expect(TEXT.slice(hud[0].start, hud[0].end)).toBe('text');
    // 前提核实：panels.json 里 Button 真的没有 text（有的是 TextButton）
    expect(panels.hasAttribute('Button', 'text')).toBe(false);
    expect(panels.hasAttribute('TextButton', 'text')).toBe(true);
  });

  it('去重后只剩 §10.3 那条', () => {
    // tamper：拿掉编排层的 dropNonHudOverlaps，这条红——同一位置出现两条
    // （['hud.buttonText','vxml.unknownAttribute']）。
    expect(ids(strict(TEXT))).toEqual(['hud.buttonText']);
  });
});

describe('§10.3 去重 · 真实重叠二：rootOnly 类型出现在嵌套位置', () => {
  // 43 种 rootOnly 类型（panels.json 的 rootOnly 位）嵌套时，§10.1 的
  // vxml.rootOnlyNested 与 §10.3 的 hud.panelNotAllowed 都落在标签名上。
  const TEXT = '<root><Panel><PopupCustomLayout /></Panel></root>';

  it('不去重时确实是两条，且区间逐字重合', () => {
    const { nonHud, hud } = raw(TEXT);
    expect(ids(nonHud)).toEqual(['vxml.rootOnlyNested']);
    expect(ids(hud)).toEqual(['hud.panelNotAllowed']);
    expect([nonHud[0].start, nonHud[0].end]).toEqual([hud[0].start, hud[0].end]);
    expect(TEXT.slice(hud[0].start, hud[0].end)).toBe('PopupCustomLayout');
    expect(panels.get('PopupCustomLayout')?.rootOnly).toBe(true);
  });

  it('去重后只剩 §10.3 那条', () => {
    expect(ids(strict(TEXT))).toEqual(['hud.panelNotAllowed']);
  });
});

// ===========================================================================
// 2. 必须钉住的**非**重叠：style
// ===========================================================================

describe('§10.3 去重 · style 不在重叠之列（规格 §10.3 末段）', () => {
  const TEXT = '<root><Panel style="width: 10px;" /></root>';

  it('§10.2 本来就不命中 style——那一条不是被去重删掉的', () => {
    // 这条用例的全部价值在这里：若哪天 §10.2 也开始命中 style，去重会把它删掉，
    // 于是「最终只有一条 hud.inlineStyle」照样成立，**去重写宽了也发现不了**。
    // 所以断言的对象是**不去重时的原始产出**：非 hud 侧必须一条都没有。
    const { nonHud, hud } = raw(TEXT);
    expect(nonHud).toEqual([]);
    expect(ids(hud)).toEqual(['hud.inlineStyle']);
    expect(panels.hasAttribute('Panel', 'style')).toBe(true);
  });

  it('最终输出仍然只有 §10.3 那条', () => {
    expect(ids(strict(TEXT))).toEqual(['hud.inlineStyle']);
  });
});

// ===========================================================================
// 3. 去重不能写宽：不重叠的非 hud.* 必须原样保留
// ===========================================================================

describe('§10.3 去重 · 严格模式下 §10.1 / §10.2 继续生效', () => {
  it('根面板 id 与一条 hud.* 并存时两条都在（区间不重叠）', () => {
    // tamper：把去重写成「只要有 hud.* 就把非 hud.* 全删掉」，这条红——
    // vxml.rootPanelId 会消失。
    const text = '<root><Panel id="a"><TextButton /></Panel></root>';
    const { nonHud, hud } = raw(text);
    expect(ids(nonHud)).toEqual(['vxml.rootPanelId']);
    expect(ids(hud)).toEqual(['hud.panelNotAllowed']);
    // 两条区间确实不相交（一个在 id 属性名上，一个在 TextButton 标签名上）
    expect(nonHud[0].end).toBeLessThanOrEqual(hud[0].start);

    expect(ids(strict(text)).sort()).toEqual(['hud.panelNotAllowed', 'vxml.rootPanelId']);
  });

  it('严格模式下 vxml.structure 照报（多出来的根面板）', () => {
    const text = '<root><Panel /><Panel /></root>';
    expect(ids(strict(text))).toEqual(['vxml.structure']);
  });

  it('严格模式下 vxml.syntax 照报（缺闭合标签）', () => {
    const text = '<root><Panel><Label text="x"></Panel></root>';
    expect(ids(strict(text))).toContain('vxml.syntax');
  });

  it('同一元素上、区间不重叠的非 hud.* 必须留下——去重是按**区间**，不是按元素', () => {
    // 评审 I-1：上面那条「根面板 id 与一条 hud.* 并存」对「按元素去重」这个变体
    // **天生是瞎的**——它的两条诊断落在两个不同的元素上（`id` 在 <Panel> 上、
    // hud.* 在 <TextButton> 上），按元素还是按区间都一样留。而
    // dropNonHudOverlaps 的四条单元测试喂的是合成 Diagnostic、不带元素信息，
    // 按元素的实现根本走不到那个函数。实测：那个变体下 222/222 全绿。
    //
    // 这个输入一石二鸟——**同一个 <Button> 上**同时挂着两条非 hud.*：
    //   text[21,25) 与 hud.buttonText[21,25) 重叠 → 必须删
    //   id  [14,16) 与任何 hud.* 都不重叠         → 必须留
    // 「按元素去重」会把 id 那条一起吞掉，规格 §10.3 明说根面板 id 在严格模式下
    // 继续生效，那是超删。
    // tamper：把去重改成「凡是产出过 hud.* 的元素，其开始标签范围内的非 hud.*
    // 全删」，这条红（少了 vxml.rootPanelId）。
    const text = '<root><Button id="a" text="x" /></root>';
    const { nonHud, hud } = raw(text);
    expect(ids(nonHud)).toEqual(['vxml.rootPanelId', 'vxml.unknownAttribute']);
    expect(ids(hud)).toEqual(['hud.buttonText']);
    // 两条非 hud.* 与那条 hud.* 的位置关系，逐个钉死——「重叠」与「不重叠」
    // 各一条，且两条都在同一个元素的开始标签里
    expect([nonHud[0].start, nonHud[0].end]).toEqual([14, 16]); // id：不重叠
    expect([nonHud[1].start, nonHud[1].end]).toEqual([21, 25]); // text：重叠
    expect([hud[0].start, hud[0].end]).toEqual([21, 25]);

    expect(ids(strict(text))).toEqual(['hud.buttonText', 'vxml.rootPanelId']);
  });
});

// ===========================================================================
// 5. 严格模式 + 工作区索引（评审 M-4）
// ===========================================================================
//
// 编排层参与去重的是**含跨文件规则**的那个数组：
//   generic = ctx.index ? [...base, ...checkVxmlCrossFileWarnings(...)] : base
// 上面各节的夹具都不带索引，于是 `generic === base`，一种真实的接线错误——
// 「只对 base 去重、把跨文件那条原样附上」——不会被任何用例发现。这一节把
// 「严格模式 + 索引」这条路径走一遍，两个方向各一条。

describe('§10.3 去重 · 严格模式 + 工作区索引', () => {
  const index = buildIndex({ '/p/panorama/styles/a.css': '.other\n{\n\twidth: 1px;\n}' });

  it('跨文件的 vxml.unknownClass 与 hud.binding 区间相交时，同样被去重删掉', () => {
    // class="{d:x}" 是真会撞上的组合：类名抽取用的是 /[^\s]+/ ——整个 {d:x} 被
    // 当成一个类名 token[20,25)，而 hud.binding 落在它开头的 {d:[20,23)。
    // tamper：把编排层改成「只对 base 去重、跨文件那条原样附上」
    // （`[...hud, ...dropNonHudOverlaps(base, hud), ...crossFile]`），这条红。
    const text = '<root><Panel class="{d:x}" /></root>';
    const { nonHud, hud } = raw(text, index);
    expect(ids(nonHud)).toEqual(['vxml.unknownClass']);
    expect(ids(hud)).toEqual(['hud.binding']);
    expect([nonHud[0].start, nonHud[0].end]).toEqual([20, 25]);
    expect([hud[0].start, hud[0].end]).toEqual([20, 23]);
    // 区间相交但不相等——这也是三张表里唯一一处**部分重叠**的真实场景
    expect(ids(strict(text, index))).toEqual(['hud.binding']);
  });

  it('不相交时跨文件那条照旧留下——去重没有把整组跨文件规则丢掉', () => {
    // tamper：把去重写宽成「有 hud.* 就删光非 hud.*」，这条红。
    const text = '<root><Panel class="nope-cls"><TextButton /></Panel></root>';
    const { nonHud, hud } = raw(text, index);
    expect(ids(nonHud)).toEqual(['vxml.unknownClass']);
    expect(ids(hud)).toEqual(['hud.panelNotAllowed']);
    expect(ids(strict(text, index))).toEqual(['hud.panelNotAllowed', 'vxml.unknownClass']);
  });
});

// ===========================================================================
// 4. 去重函数本身的边界语义
// ===========================================================================
//
// 上面几条走的是真实文档，覆盖不到「区间刚好相邻」与「非 hud 之间互相重叠」
// 这两种边界——真实规则产不出相邻区间的一对。这里直接对函数本身钉。

describe('dropNonHudOverlaps 的区间语义', () => {
  const mk = (ruleId: RuleId, start: number, end: number): Diagnostic => ({
    ruleId,
    severity: 'error',
    start,
    end,
    message: 'm',
  });

  it('区间半开：相邻不算重叠，两条都留', () => {
    // tamper：把重叠判据写成 `a.start <= b.end && b.start <= a.end`，这条红。
    const hud = [mk('hud.inlineStyle', 5, 10)];
    const kept = dropNonHudOverlaps([mk('vxml.unknownAttribute', 0, 5)], hud);
    expect(kept).toHaveLength(1);
  });

  it('部分重叠、完全包含、被包含，三种都删', () => {
    const hud = [mk('hud.inlineStyle', 5, 10)];
    expect(dropNonHudOverlaps([mk('vxml.unknownAttribute', 4, 6)], hud)).toEqual([]);
    expect(dropNonHudOverlaps([mk('vxml.unknownAttribute', 0, 20)], hud)).toEqual([]);
    expect(dropNonHudOverlaps([mk('vxml.unknownAttribute', 6, 7)], hud)).toEqual([]);
  });

  it('items 内部互相重叠不删——去重只在 §10.3 与其余规则之间发生', () => {
    // tamper：把判据写成「区间重叠就删后来的那条」（拿 items 跟自己比），这条红。
    //
    // **这条注释曾经说谎，是评审 M-1 抓出来的**：交付时函数开头有一句
    // `if (hud.length === 0) return [...items];`，`hud = []` 的调用被它提前接走，
    // `filter` 根本没执行，这条用例走不到它声称覆盖的那一行。那句早返回只是个
    // 微优化（空数组上的 `some` 本来就恒假），已经删掉——现在这条用例真的会走进
    // filter，注释也就名副其实了。
    const two = [mk('vxml.syntax', 0, 5), mk('vxml.unknownAttribute', 0, 5)];
    expect(dropNonHudOverlaps(two, [])).toEqual(two);
  });

  it('不修改传入的两个数组', () => {
    // 编排层把两侧拼起来返回，去重函数若原地删就会连 hud 那侧一起改坏。
    const base = [mk('vxml.unknownAttribute', 0, 5)];
    const hud = [mk('hud.buttonText', 0, 5)];
    dropNonHudOverlaps(base, hud);
    expect(base).toHaveLength(1);
    expect(hud).toHaveLength(1);
  });

  it('删的是非 hud 那条，不是 hud 那条（方向不能反）', () => {
    // tamper：把两个参数写反，这条红。
    const hud = [mk('hud.buttonText', 0, 5)];
    const kept = dropNonHudOverlaps([mk('vxml.unknownAttribute', 0, 5)], hud);
    expect(kept).toEqual([]);
    expect(at(hud[0])).toBe('hud.buttonText[0,5)');
  });
});
