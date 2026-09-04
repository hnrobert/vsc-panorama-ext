import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { diagnoseVxml } from '../../../../src/core/diagnostics';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import { RULE_GROUP } from '../../../../src/core/diagnostics/types';
import type { Diagnostic, RuleId } from '../../../../src/core/diagnostics/types';

/**
 * Task 8 —— 规格 §10.1 的四条 VXML 结构 warning（`vxml.structure` /
 * `vxml.rootOnlyNested` / `vxml.rootPanelId` / `vxml.syntax`）与 §10.2 的
 * `vxml.duplicateId`（hint，配置键 `panorama.diagnostics.duplicateId`，
 * Ruling 4 / D-M4-5）。
 *
 * 本任务的判据核心是**根面板的定义**，它有一个已经在真实语料上验证过的陷阱：
 *
 *   根面板 = `<root>` 的**直接子元素**里，排除 `<styles>` / `<scripts>` /
 *   `<snippets>` 之后剩下的那一个（修复轮另排除 `<include>` / `<snippet>` /
 *   嵌套的 `<root>`——它们出现在那个位置是它们自己位置错了，见 vxml.ts 的
 *   MISPLACED_UNDER_ROOT）。
 *
 * **不是**「文档里第一个面板元素」。20 个 popup 的真实形态是
 * `<styles>` → `<scripts>` → `<snippets>`（里面装着 `<Panel>` 等真面板）→
 * `<PopupCustomLayout>`：朴素写法会把 `<snippets>` 里的 `<Panel>` 当成根面板，
 * 于是真正的根面板 `PopupCustomLayout`（`rootOnly: true`）被判成「嵌套位置」。
 * 控制者写计划时的粗扫正是这么报出「rootOnly 嵌套 21 次」的，逐例核查后全部
 * 是误报。本任务实测：按朴素定义两个构建合计 **42** 处误报，按正确定义 **0** 处。
 *
 * 用的是**真实出货的数据**（`PanelRegistry.load('zh-cn')` / `ObservedAttributes.load()`）
 * 而不是注入的桩——`rootOnly` 的那 43 种类型由 `data/panels.json` 决定，拿桩数据
 * 测只能证明分支结构对，证明不了发布出去的那份数据下行为对。
 */
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();

const LAYOUT = '/p/panorama/layout/a.xml';

/** 不带索引跑：跨文件的 `vxml.unknownClass` 因此整体跳过，断言里只剩单文件规则 */
const run = (text: string): Diagnostic[] =>
  diagnoseVxml(parseVxml(text), { uri: LAYOUT, mode: 'full', panels, observed, msg: ZH });
const ids = (text: string): RuleId[] => run(text).map((d) => d.ruleId);
const only = (text: string, id: RuleId): Diagnostic[] => run(text).filter((d) => d.ruleId === id);
/** 命中处的原文片段——比裸偏移量可读，且区间写歪立刻看得出来 */
const spans = (text: string, id: RuleId): string[] =>
  only(text, id).map((d) => text.slice(d.start, d.end));

// ===========================================================================
// A. 根面板的定义 —— 本任务最要紧的一层
// ===========================================================================

describe('diagnoseVxml · 根面板的定义（<snippets> 陷阱）', () => {
  /**
   * **这条用例是整个任务的承重墙。** 结构逐字取自
   * `20260829/panorama/layout/popups/popup_accept_match.xml`（`<styles>` →
   * `<scripts>` → 装着面板的 `<snippets>` → `PopupCustomLayout`）。
   *
   * 把实现改坏成「文档里第一个面板元素就是根面板」时，它会**同时**从两个方向
   * 变红，两个方向互不替代：
   *
   *  1. `PopupCustomLayout`（`rootOnly: true`）不再被认作根面板 →
   *     多出一条 `vxml.rootOnlyNested`；
   *  2. `<snippets>` 里那个带 `id` 的 `<Panel>` 被误认成根面板 →
   *     多出一条 `vxml.rootPanelId`。
   *
   * 第 2 条钉住的是 brief 里「`<snippets>` 里的 `<Panel>` 也不被当成根面板」
   * 这半句。两条互不替代，只断言第 1 条就漏了半个判据。
   *
   * **这条用例咬不住哪个变体**（T8 评审 I-1；修复轮又逐字实现该变体重测了一次，
   * 写在这里免得后人误信）：「跳过 `<snippet>` 子树、但仍按文档序取第一个面板
   * 元素」这个**半吊子变体**，在这份 fixture 上算出的根面板同样是
   * `PopupCustomLayout`（`<styles>` / `<scripts>` 不是面板元素，`<snippets>`
   * 被它自己跳过），于是上面两个方向的行为都与正确实现**相同**——本用例与 990
   * 文件语料闸门双双全绿。实测咬住它的是另外三条，全都在「根位置 = `<root>` 的
   * **直接子元素**」这个判据上做文章：
   *
   *   · vxml.structure「`<root>` 下有两个根面板 → 报在多出来的那个上」
   *   · 「两个 `<root>` 时，第二个 `<root>` 下的 rootOnly 面板处在根位置，不算嵌套」
   *   · vxml.structure「`<root>` 嵌套 `<root>` → 报在里层那个上」
   *
   * 所以本条 popup 用例守的是「`<snippets>` 子树不算根位置」，那三条守的是
   * 「只有直接子元素才算根位置」，分工不同、互不替代，谁都不能因为「另一条
   * 盖住了」而被弱化。
   */
  it('真实 popup 结构：<snippets> 之后的 PopupCustomLayout 是根面板，snippets 里的 Panel 不是', () => {
    const text = [
      '<root>',
      '\t<styles>',
      '\t\t<include src="s2r://panorama/styles/gamestyles.vcss_c" />',
      '\t</styles>',
      '\t<scripts>',
      '\t\t<include src="s2r://panorama/scripts/avatar.vts_c" />',
      '\t</scripts>',
      '\t<snippets>',
      '\t\t<snippet name="AcceptMatchPlayerSlot">',
      '\t\t\t<Panel id="JsAvatarImage" class="accept-match__slots__player" />',
      '\t\t</snippet>',
      '\t</snippets>',
      '\t<PopupCustomLayout class="accept-match Hidden">',
      '\t\t<Panel class="accept-match-hit-blocker" />',
      '\t</PopupCustomLayout>',
      '</root>',
    ].join('\n');

    // 一条诊断都不该有：这是 Valve 自己出货的合法布局
    expect(ids(text)).toEqual([]);
  });

  it('rootOnly 类型真的出现在嵌套位置 → 报 warning，区间精确覆盖标签名', () => {
    // ContextMenu 是 43 种 rootOnly 之一；根面板是 Panel，ContextMenu 在它里面
    const text = '<root><Panel><ContextMenu /></Panel></root>';
    const diags = only(text, 'vxml.rootOnlyNested');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('ContextMenu');
    expect(diags[0].severity).toBe('warning');
    // 规格 §10.1 末段：每条 warning 都要给替代写法
    expect(diags[0].fix).toBeTruthy();
  });

  it('rootOnly 类型作为根面板 → 不报', () => {
    expect(ids('<root><PopupCustomLayout /></root>')).toEqual([]);
  });

  it('rootOnly 类型嵌在 <snippet> 里 → 报（snippet 内不是根位置）', () => {
    const text = '<root><snippets><snippet name="s"><ContextMenu /></snippet></snippets><Panel /></root>';
    expect(spans(text, 'vxml.rootOnlyNested')).toEqual(['ContextMenu']);
  });

  it('非 rootOnly 类型嵌套 → 不报（区分力：规则不是「凡嵌套就报」）', () => {
    expect(only('<root><Panel><Label /></Panel></root>', 'vxml.rootOnlyNested')).toEqual([]);
  });

  /**
   * T8 评审 Minor 5。只认第一个 <root> 的直接子元素时，第二个 <root> 下的
   * ContextMenu 会被判成「嵌套在其他面板里」——它明明就在一个 <root> 的根位置上。
   * 同一个根因（多了一个 <root>）挂两条诊断，与本任务反复遵守的取舍相抵。
   * 改法：根位置的集合并进**所有**顶层 <root> 的直接子元素；报点（数量、id）
   * 仍只看第一个 <root>——多一个 <root> 时哪棵才是真的无从判断，此时只压制、
   * 不追加指控（与「没有 <root> 时整条跳过」同一条原则）。
   */
  it('两个 <root> 时，第二个 <root> 下的 rootOnly 面板处在根位置，不算嵌套', () => {
    const text = '<root><Panel /></root><root><ContextMenu /></root>';
    // 只剩「<root> 只能出现一次」这一条
    expect(ids(text)).toEqual(['vxml.structure']);
  });

  it('第二个 <root> 里真正嵌套的 rootOnly 照旧报（放行的是根位置，不是整棵第二树）', () => {
    // 区分力：挡住「roots.length > 1 就整条跳过 rootOnlyNested」这个偷懒变体
    const text = '<root><Panel /></root><root><Panel><ContextMenu /></Panel></root>';
    expect(spans(text, 'vxml.rootOnlyNested')).toEqual(['ContextMenu']);
  });

  it('没有 <root> 时整条 rootOnlyNested 跳过——根面板是谁无从判断，只报结构错误', () => {
    // 与 Ruling 13 / 17 / 19 同一条原则：信息不完整时不下结论。
    // 缺 <root> 这个真正的错误由 vxml.structure 独家报出，不再给里面每个
    // rootOnly 类型各挂一条「嵌套」——那是同一个根因挂多条诊断。
    expect(ids('<ContextMenu />')).toEqual(['vxml.structure']);
  });
});

// ===========================================================================
// B. vxml.structure
// ===========================================================================

describe('diagnoseVxml · vxml.structure（10.1，warning）', () => {
  it('缺 <root> → 报 warning，区间落在第一个顶层元素的标签名上', () => {
    const text = '<Panel />';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('Panel');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].fix).toBeTruthy();
  });

  it('空文档 / 只有注释 → 一条都不报（新建文件不是结构错误）', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   \n\t\n')).toEqual([]);
    expect(ids('<!-- 还没开始写 -->')).toEqual([]);
  });

  it('<root> 出现两次 → 报在第二个上', () => {
    const text = '<root><Panel /></root><root><Panel /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    // 第二个 <root> 的标签名，不是第一个
    expect(diags[0].start).toBe(text.lastIndexOf('<root>') + 1);
  });

  it('<root> 下没有根面板 → 报', () => {
    const text = '<root><styles><include src="a" /></styles></root>';
    expect(spans(text, 'vxml.structure')).toEqual(['root']);
  });

  it('<root> 下有两个根面板 → 报在多出来的那个上', () => {
    const text = '<root><Panel /><Label /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('Label');
  });

  /**
   * T8 评审 Minor 1。<include> / <snippet> / 嵌套的 <root> 都是**结构标签**：
   * 它们出现在 <root> 的直接子元素位置上，是**它们自己**位置错了，不是根面板。
   * 把它们算进根面板计数的后果是报点落在**无辜的真根面板**上，还给出一条南辕
   * 北辙的替代写法——「把 <Panel> 挪进第一个根面板里」，而那个「第一个根面板」
   * 正是 <include> 自己。语料 540 个布局对这三者零命中（<root> 元素数恒为 1、
   * 根面板数恒为 1），所以这不是回归风险，是新写文件时的体验缺陷。
   */
  it('<include> 直接挂在 <root> 下 → 报在 <include> 自己身上，不牵连真正的根面板', () => {
    const text = '<root><include src="a" /><Panel /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('include');
    // 替代写法要指向它该待的地方，而不是「把你的根面板塞进 <include> 里」
    expect(diags[0].fix).toContain('<styles>');
  });

  it('<root> 下只有一个 <include> → 位置错 + 没有根面板，两条都报', () => {
    // 两条不是同一个根因：把 <include> 挪进 <styles> 之后，「没有根面板」
    // 依然成立。诊断该不该合并，判据就是「修掉其中一条另一条会不会跟着消失」。
    const text = '<root><include src="a" /></root>';
    expect(spans(text, 'vxml.structure')).toEqual(['include', 'root']);
  });

  it('<snippet> 直接挂在 <root> 下（漏了 <snippets> 外壳）→ 报在 <snippet> 上', () => {
    const text = '<root><snippet name="s"><Panel /></snippet><Panel /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('snippet');
    expect(diags[0].fix).toContain('<snippets>');
  });

  it('<root> 嵌套 <root> → 报在里层那个上，里层不被当成根面板', () => {
    const text = '<root><root><Panel /></root></root>';
    const diags = only(text, 'vxml.structure');
    // 里层 <root> 位置错一条（报在里层的标签名上）+ 外层没有根面板一条
    expect(diags.map((d) => d.start)).toEqual([text.indexOf('<root><Panel') + 1, 1]);
  });

  it('<styles> 重复出现 → 报在第二个上', () => {
    const text = '<root><styles /><styles /><Panel /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(text.lastIndexOf('<styles') + 1);
  });

  it('骨架顺序错误（<scripts> 写在 <styles> 前）→ 报在靠后的那个 <styles> 上', () => {
    const text = '<root><scripts /><styles /><Panel /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(text.indexOf('<styles') + 1);
  });

  it('骨架出现在根面板之后 → 报', () => {
    const text = '<root><Panel /><snippets /></root>';
    const diags = only(text, 'vxml.structure');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('snippets');
  });

  it('语料里真实出现的四种骨架形态全部不报', () => {
    // 540 个布局实测只有这四种（另有 2 个文件一个骨架元素都没有）：
    // styles>scripts 194、styles>scripts>snippets 184、styles 130、styles>snippets 30
    const p = '<Panel /></root>';
    expect(ids('<root><styles /><scripts />' + p)).toEqual([]);
    expect(ids('<root><styles /><scripts /><snippets />' + p)).toEqual([]);
    expect(ids('<root><styles />' + p)).toEqual([]);
    expect(ids('<root><styles /><snippets />' + p)).toEqual([]);
    expect(ids('<root>' + p)).toEqual([]);
  });

  it('<root 开始标签没写完时不判根面板数量——信息不完整不下结论', () => {
    // 用户刚敲下 `<root` 的那一刻，报「<root> 下没有根面板」是纯噪音。
    // 真正的问题（开始标签缺 >）由 vxml.syntax 独家报出。
    expect(ids('<root')).toEqual(['vxml.syntax']);
  });
});

// ===========================================================================
// C. vxml.rootPanelId —— Panorama 的真实约束，XSD 查不出来
// ===========================================================================

describe('diagnoseVxml · vxml.rootPanelId（10.1，warning）', () => {
  it('根面板带 id → 报 warning，区间覆盖属性名，替代写法指向 class', () => {
    const text = '<root><Panel id="main" class="x" /></root>';
    const diags = only(text, 'vxml.rootPanelId');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('id');
    expect(diags[0].severity).toBe('warning');
    // 规格 §10.1 末段点名了这一条的替代写法就是 class
    expect(diags[0].fix).toContain('class');
  });

  it('XSD 认为根面板的 id 完全合法——这条只能硬编码，不能靠 unknownAttribute 兜住', () => {
    // 规格 §10.1「关于根面板 id 这条」：根位置用的是与普通面板相同的类型，
    // 都从基础 Panel 继承了 id，schema 层合法但引擎不接受。
    expect(panels.hasAttribute('Panel', 'id')).toBe(true);
    expect(panels.hasAttribute('PopupCustomLayout', 'id')).toBe(true);
    expect(ids('<root><PopupCustomLayout id="p" /></root>')).toEqual(['vxml.rootPanelId']);
  });

  it('嵌套面板带 id → 不报（区分力：规则不是「凡 id 就报」）', () => {
    expect(only('<root><Panel><Label id="inner" /></Panel></root>', 'vxml.rootPanelId')).toEqual([]);
  });
});

// ===========================================================================
// D. vxml.syntax
// ===========================================================================

describe('diagnoseVxml · vxml.syntax（10.1，warning）', () => {
  it('开始标签缺 > → 报，区间落在标签名上', () => {
    const text = '<root><Panel</root>';
    const diags = only(text, 'vxml.syntax');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('Panel');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].fix).toBeTruthy();
  });

  it('缺闭合标签 → 报，区间落在标签名上', () => {
    const text = '<root><Panel></root>';
    const diags = only(text, 'vxml.syntax');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('Panel');
  });

  it('被祖先的同长度闭合标签顺带收掉 → 仍判为未闭合（钉住闭合标签的标签名比对）', () => {
    // T8 评审 I-2：closedByEndTag 里「text.slice(nameStart, nameEnd) === el.tag」
    // 那一行原本**零测试覆盖**——换成 `true &&`（结尾只要是个 </x> 就算收尾、
    // 不比对名字）之后 635 条 + 990 文件语料闸门一条都不红。其余几条用例躲过去
    // 纯属巧合：它们的祖先闭合标签与被测标签**长度不同**（`</root>` 里 root 4 个
    // 字符 vs Panel 5 个），于是 `text[nameStart - 1] === '/'` 那道位置检查顺手
    // 挡下了。这里 Image 与 Panel 都是 5 个字符，位置检查完全失效，唯一在守的
    // 就是标签名逐字比对——注释里写死的「被祖先闭合标签顺带收掉的元素判为未闭合」
    // 这条语义，到这里才真的有断言在守。
    const text = '<root><Panel><Image></Panel></root>';
    expect(spans(text, 'vxml.syntax')).toEqual(['Image']);
  });

  it('<root> 自己缺闭合标签也报', () => {
    const text = '<root><Panel />';
    expect(spans(text, 'vxml.syntax')).toEqual(['root']);
  });

  it('属性值没加引号 → 报，区间落在属性名上', () => {
    const text = '<root><Panel class=foo /></root>';
    const diags = only(text, 'vxml.syntax');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('class');
    // 裸取值 foo 会被解析器当成下一个属性名（这是容错解析的真实后果，
    // 不是本规则的问题），于是 §10.2 的 unknownAttribute 也会挂一条 hint。
    // 如实钉住整个列表，免得将来有人以为这里只出一条。
    expect(ids(text)).toEqual(['vxml.syntax', 'vxml.unknownAttribute']);
  });

  it('属性值缺右引号 → 报，区间落在属性名上', () => {
    // 右引号漏了，但开始标签本身在下一行收了 > ——所以这是「引号未闭合」
    // 而不是「开始标签缺 >」，两条分支各自独立可达
    const text = '<root><Panel class="foo\n>\n</Panel></root>';
    const diags = only(text, 'vxml.syntax');
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('class');
  });

  /**
   * T8 评审 Minor 4。改动前一个漏掉的闭合标签会按**未闭合祖先数**放大：自上而下
   * 新写一个文件、还没写任何闭合标签时，深度 N 就刷 N 条 warning。Ruling 21
   * 批准的是「就元素确实没闭合这件事报告」，不是按嵌套深度放大同一件事。
   *
   * 取舍：一个元素若**它自己的直接子元素**也没收尾，就不再为它单报——那是同一
   * 串编辑中途的未闭合链，只报最内层那一条。选最内层（而不是最外层）是因为那里
   * 才是光标所在，而且补一个闭合标签之后下一条会自动浮出来，逐层收敛。
   */
  it('一串未闭合的祖先只报最内层那一条——不按嵌套深度放大', () => {
    // 结构与「自上而下新写、一个闭合标签都还没写」等价（空白与判据无关，省掉更好读）
    const text = '<root><styles /><Panel><Panel><Label text="a" />';
    const diags = only(text, 'vxml.syntax');
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(text.lastIndexOf('<Panel') + 1);
  });

  it('压制只看直接子元素：孙子没闭合、儿子闭好了，祖父照旧报', () => {
    // 区分力：挡住把上一条实现成「整份文档只报最深的一条」。
    // <Panel> 由 </Panel> 正常收尾，所以 <root> 的未闭合与 <Image> 的无关，各报一条。
    const text = '<root><Panel><Image></Panel>';
    expect(spans(text, 'vxml.syntax')).toEqual(['root', 'Image']);
  });

  it('两处彼此独立的遗漏各报一条', () => {
    const text = '<root><Panel><Image></Panel><Label></root>';
    expect(spans(text, 'vxml.syntax')).toEqual(['Image', 'Label']);
  });

  it('结构完整的文档一条 syntax 都不报（区分力：规则不是恒报）', () => {
    expect(only('<root><Panel /></root>', 'vxml.syntax')).toEqual([]);
    expect(only('<root><Panel class="a"></Panel></root>', 'vxml.syntax')).toEqual([]);
    expect(only('<root><Panel class="a" /></root>', 'vxml.syntax')).toEqual([]);
  });

  it('同一个元素只出一条：开始标签没写完时，不再判它的属性与闭合标签', () => {
    // `<Panel class=` 三处毛病同时成立（属性值缺引号、开始标签缺 >、缺闭合
    // 标签），但根因只有一个——用户还在敲。报三条是 Task 5 评审 I-2 与
    // Ruling 19 反复修过的同型问题。
    const text = '<root><Panel class=</root>';
    expect(only(text, 'vxml.syntax')).toHaveLength(1);
  });

  it('属性有毛病时优先报属性——它比「开始标签缺 >」更具体、更可操作', () => {
    const text = '<root><Panel class="foo';
    const diags = only(text, 'vxml.syntax');
    // Panel 上只出属性那一条，不再叠加「开始标签缺 >」。外层 <root> 同样没收尾，
    // 但它的直接子元素 <Panel> 也没收尾——同一串编辑中途的未闭合链，按上面那条
    // 取舍只报最内层，所以整份文档就这一条。
    expect(diags.map((d) => text.slice(d.start, d.end))).toEqual(['class']);
  });
});

// ===========================================================================
// E. Ruling 19 —— unknownTag 让位给 syntax
// ===========================================================================

describe('diagnoseVxml · Ruling 19：未闭合元素不报 vxml.unknownTag', () => {
  it('未闭合的未知标签 → 只出 vxml.syntax，0 条 vxml.unknownTag', () => {
    // T7 评审实测的原始场景：编辑中途的半截标签会立刻挂一条
    // 「Lab 不是已知的面板类型」，而 vxml.syntax 会在同一个元素上再报一条。
    const text = '<root><Lab</root>';
    expect(ids(text)).toEqual(['vxml.syntax']);
    expect(only(text, 'vxml.unknownTag')).toHaveLength(0);
  });

  it('已闭合的未知标签照旧报 vxml.unknownTag（守卫不能写宽）', () => {
    // 这条与上一条互相点名：只有上一条的话，把守卫写成「未知标签一律不报」
    // 也能过；只有这一条的话，守卫压根没加也能过。
    expect(ids('<root><Lab /></root>')).toEqual(['vxml.unknownTag']);
  });
});

// ===========================================================================
// F. vxml.duplicateId —— 作用域模型（Ruling 20）
// ===========================================================================

describe('diagnoseVxml · vxml.duplicateId（10.2，hint，自己的配置键）', () => {
  it('是 hint，且归在自己的配置组 duplicateId 下（Ruling 4 / D-M4-5）', () => {
    const text = '<root><Panel><Label id="x" /><Label id="x" /></Panel></root>';
    const diags = only(text, 'vxml.duplicateId');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('hint');
    expect(RULE_GROUP['vxml.duplicateId']).toBe('duplicateId');
  });

  it('报的是第二次出现的位置，不是第一次；区间覆盖 id 的取值', () => {
    const text = '<root><Panel><Label id="dup" /><Label id="dup" /></Panel></root>';
    const diags = only(text, 'vxml.duplicateId');
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(text.lastIndexOf('dup'));
    expect(text.slice(diags[0].start, diags[0].end)).toBe('dup');
    // 第一次出现的位置绝不能被报出来
    expect(diags[0].start).not.toBe(text.indexOf('dup'));
  });

  it('出现三次 → 报两条，位置是第 2、3 次；一条都不落在第 1 次上', () => {
    // 这条专门钉「报第一次出现」那个变体：它的条数（2）与 message（id 名字）
    // 与正确实现完全相同，**只有位置不同**——所以必须断言位置。
    const text = '<root><Panel><Label id="t" /><Label id="t" /><Label id="t" /></Panel></root>';
    const diags = only(text, 'vxml.duplicateId');
    const at = [...text.matchAll(/id="t"/g)].map((m) => m.index + 4);
    expect(diags.map((d) => d.start)).toEqual([at[1], at[2]]);
  });

  it('同名 id 分处两个不同的 <snippet> → 不报（每个 snippet 是独立作用域）', () => {
    const text =
      '<root><snippets>' +
      '<snippet name="a"><Panel id="same" /></snippet>' +
      '<snippet name="b"><Panel id="same" /></snippet>' +
      '</snippets><Panel /></root>';
    expect(only(text, 'vxml.duplicateId')).toEqual([]);
  });

  it('同一个 <snippet> 内重复 → 报', () => {
    const text =
      '<root><snippets><snippet name="a"><Panel id="same" /><Panel id="same" /></snippet></snippets><Panel /></root>';
    expect(spans(text, 'vxml.duplicateId')).toEqual(['same']);
  });

  it('snippet 内与主树同名 → 不报（分属两个作用域）', () => {
    // 夹具原本给根面板挂了个与判据无关的 id="same2"，顺带触发一条 vxml.rootPanelId
    // （T8 评审 M-6）。去掉之后这份输入干干净净，可以直接钉全列表——本任务其余
    // 用例大量用 ids(text) 全列表断言，那是 T7 立下的好习惯，这条不该例外。
    const text =
      '<root><snippets><snippet name="a"><Panel id="same" /></snippet></snippets>' +
      '<Panel><Label id="same" /></Panel></root>';
    expect(ids(text)).toEqual([]);
  });

  it('<snippet> 自己的 id 归主树作用域（作用域只看祖先、不含自身）', () => {
    // T8 评审 M-3：这条取舍原本零覆盖——把 snippetScopeOf 的 `el.parent` 起步
    // 改成 `el` 起步（<snippet> 自己算自己的作用域）之后 635 条 + 语料闸门
    // 一条都不红。语料上确实不可达（带 id 的 <snippet> 0 个），正因为不可达，
    // 它才更需要一条用例把语义定下来，否则将来会被人顺手改掉。两个方向各钉一次。

    // 方向一：<snippet> 自己的 id 与**主树**元素同名 → 算重复
    const outer =
      '<root><snippets><snippet name="a" id="dup" /></snippets>' +
      '<Panel><Label id="dup" /></Panel></root>';
    const diags = only(outer, 'vxml.duplicateId');
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(outer.lastIndexOf('dup'));

    // 方向二：与它**自己内部**的元素同名 → 不算（那是另一个作用域）
    const inner =
      '<root><snippets><snippet name="a" id="dup"><Panel id="dup" /></snippet></snippets>' +
      '<Panel /></root>';
    expect(only(inner, 'vxml.duplicateId')).toEqual([]);
  });

  it('空 id="" 重复 → 不报（空 id 不是 id，语料里 80 处）', () => {
    const text = '<root><Panel><Label id="" /><Label id="" /><Image id="" /></Panel></root>';
    expect(only(text, 'vxml.duplicateId')).toEqual([]);
  });

  it('主树里两个不同的 id → 不报（区分力：规则不是「凡 id 就报」）', () => {
    expect(
      only('<root><Panel><Label id="a" /><Label id="b" /></Panel></root>', 'vxml.duplicateId'),
    ).toEqual([]);
  });
});
