import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { diagnoseVxml } from '../../../../src/core/diagnostics';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';

/**
 * `vxml.unknownTag`（§10.1，warning，D-M4-2）与 `vxml.unknownAttribute`
 * （§10.2，hint，D-M4-1）。
 *
 * **这份测试是 `vxml.unknownAttribute` 唯一的防线**（Ruling 16）：观测压制层是从
 * 20260829 挖的，而 20260829 实测是 20260716 的真超集，因此语料闸门对这条规则的
 * 「期望 0」是**构造性恒真**——挖掘源覆盖了被测对象的全部内容，任何实现都不可能
 * 在语料上报出东西。闸门那个 0 不构成证据，标准相应提高：
 *
 * - 判定顺序里的**每一层**都有一个「只被这一层保护」的用例，选用例时逐个核过
 *   不会被更靠前的层遮蔽（层间遮蔽是本项目反复出现的空转测试形态）；
 * - 每条用例都实测过 tamper：删掉它保护的那一层必须变红，且报错条数与预期一致。
 *
 * 判定顺序（D-M4-1 + Ruling 17），顺序本身是承重的：
 *
 *   标签 T-L0  结构标签（root/styles/scripts/snippets/snippet/include）整个不判
 *        T-L1  panels.json 有            → 通过
 *        T-L2  观测层有                  → 静默通过
 *              都没有                    → vxml.unknownTag（warning）
 *
 *   属性 A-L1  标签不在 panels.json 里    → 整个元素的属性一律不判（Ruling 17）
 *        A-L2  该面板属性集（含继承）有   → 通过
 *        A-L3  data-* 或 on*             → 通过（规则层通用豁免，不查数据）
 *        A-L4  观测层有                  → 静默通过
 *              都没有                    → vxml.unknownAttribute（hint）
 *
 * 用的是**真实出货的数据**（`PanelRegistry.load('zh-cn')` / `ObservedAttributes.load()`）
 * 而不是注入的桩：这两条规则的行为完全由这两份数据决定，拿桩数据测只能证明分支
 * 结构对，证明不了发布出去的那份数据下行为对。用到的具体事实都在各用例里注明。
 */
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();

const LAYOUT = '/p/panorama/layout/a.xml';

/** 不带索引跑：跨文件的 vxml.unknownClass 因此整体跳过，断言里只剩本任务这两条 */
const run = (text: string) => diagnoseVxml(parseVxml(text), { uri: LAYOUT, mode: 'full', panels, observed, msg: ZH });
const ids = (text: string) => run(text).map((d) => d.ruleId);

// ===========================================================================
// 标签侧：vxml.unknownTag（§10.1，warning）
// ===========================================================================

describe('diagnoseVxml · vxml.unknownTag（10.1，warning）', () => {
  it('标签不在 panels.json、也不在观测层 → 报 warning，区间精确覆盖标签名（不含 <）', () => {
    const text = '<root><NotARealPanelType /></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.unknownTag']);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('NotARealPanelType');
    expect(diags[0].severity).toBe('warning');
    // 规格 §10.1 末段：每条 warning 都要给替代写法，不能只说「这个不行」
    expect(diags[0].fix).toBeTruthy();
  });

  it('T-L1 独家：panels.json 里的面板类型不报', () => {
    // Label / Button / Image / Panel 都在 panels.json 的 panels 里，且都不在观测
    // 层的 tags 里（观测层只有 6 个 ItemPreview*/CSGO* 标签）——所以这条只可能由
    // T-L1 保住，T-L2 帮不上忙。
    expect(ids('<root><Panel><Label /><Button /><Image /></Panel></root>')).toEqual([]);
  });

  it('T-L2 独家：panels.json 没有、但观测层收了的 6 种标签静默通过', () => {
    // 这 6 种是 D-M4-2 的全部理由所在：XSD 的 panels.json 少收了它们，而 Valve
    // 自己的布局里在用（popups/popup_tournament_journal.xml、itempreviewdebug.xml、
    // hud/infohudlayouts.xml）。它们都不在 panels.json 里，所以 T-L1 拦不住，
    // 只有 T-L2 拦得住。
    expect(
      ids(
        '<root><Panel>' +
          '<ItemPreviewPanel /><ItemPreviewSlider /><ItemPreviewColorSlider />' +
          '<ItemPreviewDebug /><CSGOInfoHudLayouts /><CSGOShieldDamageAlert />' +
          '</Panel></root>',
      ),
    ).toEqual([]);
  });

  it('T-L0 独家：6 个结构标签不是面板，不拿去查 panels.json', () => {
    // root/styles/scripts/snippets/snippet/include 一个都不在 panels.json 里，
    // 也一个都不在观测层里（挖掘脚本的 STRUCTURAL_TAGS 明确排除了它们）——
    // T-L1 与 T-L2 对它们全都恒假，这条只可能由 T-L0 保住。
    const text =
      '<root>\n' +
      '\t<styles><include src="s2r://panorama/styles/a.css" /></styles>\n' +
      '\t<scripts><include src="s2r://panorama/scripts/a.js" /></scripts>\n' +
      '\t<snippets><snippet name="x"><Panel /></snippet></snippets>\n' +
      '\t<Panel />\n' +
      '</root>';
    expect(ids(text)).toEqual([]);
  });

  it('嵌套深处的未知标签照样报——遍历要走完整棵树', () => {
    const text = '<root><Panel><Panel><Panel><NopePanel /></Panel></Panel></Panel></root>';
    expect(ids(text)).toEqual(['vxml.unknownTag']);
  });

  it('结构标签的子树要继续走：<snippet> 里的未知标签必须报', () => {
    // 结构标签自己不判，但它的子树里装的正是真面板（20 个 popup 都是这个形状）。
    // 「跳过结构标签」若写成「跳过整棵子树」，这条立刻变绿而墙已经塌了。
    expect(ids('<root><snippets><snippet name="x"><NopePanel /></snippet></snippets><Panel /></root>')).toEqual([
      'vxml.unknownTag',
    ]);
  });
});

// ===========================================================================
// 属性侧：vxml.unknownAttribute（§10.2，hint）
// ===========================================================================

describe('diagnoseVxml · vxml.unknownAttribute（10.2，hint）', () => {
  it('属性不属于该面板 → 报 hint，区间精确覆盖属性名（不含 = 与取值）', () => {
    const text = '<root><Label bogusattr="x" /></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.unknownAttribute']);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('bogusattr');
    // 级别是 hint 而不是规格 §10.1 原写的 warning（D-M4-1）：XSD 的属性集被证明
    // 不完整，20260829 一个构建里就有 554 处合法属性不在集内。数据源被证明不可靠，
    // 级别就该降——依据是规格 §10 自己的分级原则。
    expect(diags[0].severity).toBe('hint');
    expect(diags[0].fix).toBeTruthy();
  });

  it('A-L1 独家（Ruling 17）：未知标签带若干未知属性 → 只报 1 条 unknownTag，0 条 unknownAttribute', () => {
    // 标签本身已经由 unknownTag 报了；再对它的每个属性各报一条 hint，是同一个
    // 根因挂多条诊断。而且我们对这个标签一无所知，没有任何依据断言它该有哪些属性。
    const text = '<root><NopePanel alpha="1" beta="2" gamma="3" /></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.unknownTag']);
    expect(diags.filter((d) => d.ruleId === 'vxml.unknownAttribute')).toHaveLength(0);
  });

  it('A-L1 独家（Ruling 17，语料形态）：观测层收了的标签，其属性一条都不判', () => {
    // 这正是语料里那 44 处（20260829 有 23、20260716 有 21）的来源，逐字取自
    // popups/popup_tournament_journal.xml:36。注意 id / class 这种**任何面板都有**
    // 的属性也在其中——因为 ItemPreviewPanel 不在 panels.json 里，它的属性集是空的，
    // 没有 Ruling 17 这一步，连 id 和 class 都会被报成 hint。
    //
    // 这条与上一条不能互相替代：上一条的标签会报 unknownTag（T-L2 不认识它），
    // 这条的标签**一条诊断都不该有**——若把 Ruling 17 的守卫写成「只在真报了
    // unknownTag 时才跳过属性」，上一条照样绿，只有这条会红。
    //
    // 外面那层 `<Panel>` 是 Task 8 之后加的：它让 ItemPreviewPanel 处在**嵌套**
    // 位置。不加的话 ItemPreviewPanel 自己就是根面板，它带的那个 id 会正确地
    // 触发一条 vxml.rootPanelId（§10.1「根面板不能带 id」），与本用例要测的
    // Ruling 17 无关却会把 toEqual([]) 打红。原用例的判据一字未改。
    const text =
      '<root><Panel><ItemPreviewPanel id="id-tournament-journal-model" class="tournament-journal__model" ' +
      'manifest="resource/ui/econ/itemmodelpanelcharweaponinspect.res" ' +
      'item="models/inventory_items/5_year_coin.mdl" mouse_rotate="true" sound="weapon" /></Panel></root>';
    expect(ids(text)).toEqual([]);
  });

  it('A-L2 独家：该面板属性集（含继承）里的属性不报', () => {
    // text 由 Label 自己声明、id/class 由基类 Panel 声明（继承要生效）。三者都
    // 不是 data-/on 开头，也都不在观测层的 Label 表里（那张表是 XSD 的**补集**：
    // clampfractionalpixelpositions/group/menuclass/modenum/teamnum/value），
    // 所以只有 A-L2 保得住它们。
    // Label 套在一层 <Panel> 里（Task 8 之后）：直接挂在 <root> 下它就是根面板，
    // 那个 id 会正确地触发 vxml.rootPanelId，与本用例要测的 A-L2 无关。
    expect(ids('<root><Panel><Label id="a" class="b" text="hi" /></Panel></root>')).toEqual([]);
  });

  it('A-L3 独家：data-* 与 on* 一律放行，且不查数据文件', () => {
    // 两个都必须是「XSD 里没有、观测层里也没有」的名字，否则会被 A-L2 / A-L4 遮蔽：
    // - data-*：panels.json 的全部属性集合里 0 个 data- 开头的属性；观测层按
    //   excludedAttributePrefixes 明确不收 data-*。
    // - on*：XSD 里确实有 24 个 on* 属性（onactivate/onmouseover…），拿它们做用例
    //   会被 A-L2 遮蔽，所以这里用一个 XSD 里没有的事件名；观测层同样不收 on*。
    expect(ids('<root><Label data-my-custom-thing="1" onbogusevent="Foo()" /></root>')).toEqual([]);
  });

  it('A-L4 独家：XSD 没有、观测层里有的属性静默通过', () => {
    // Label@value 是 D-M4-1 的头号证据：337 次，而 XSD 的 Label 属性集里没有它。
    // 它不是 data-/on 开头，A-L2 也拦不住（正因为拦不住才有观测层），只有 A-L4
    // 保得住——这一层没了，Valve 自己出货的写法就会被报成 hint。
    expect(ids('<root><Label value="5" /></root>')).toEqual([]);
  });

  it('A-L4 是按面板分域的，不是塌成一个扁平属性名集合', () => {
    // value 观测到过在 Label 上（337 次），没观测到过在 Panel 上。塌平之后
    // 「属性用错面板」这类真错误会被一并压掉。
    expect(ids('<root><Panel value="5" /></root>')).toEqual(['vxml.unknownAttribute']);
  });

  it('结构标签自己的属性也不判（由 T-L0 与 A-L1 联合保证，非任一层独家）', () => {
    // <snippet name>、<include src> 是结构标签的合法属性，但它们不是面板，
    // panels.json 里查不到「snippet 该有哪些属性」——不能拿去判。
    //
    // **这条不是「只被一层保护」的用例，标题里已经写明，别当成 T-L0 的独家证据**：
    // 结构标签必然不在 panels.json 里，所以就算 T-L0 整个删掉，A-L1（Ruling 17
    // 的守卫）照样会挡住属性侧——单删 T-L0 时这条变红是因为 unknownTag 冒出来了，
    // 不是因为属性侧漏了。实测：T-L0 与 A-L1 一起删掉，属性侧才真的漏出来。
    // 也就是说结构标签的属性豁免在结构上与 A-L1 冗余，这条断言是**口径锁**
    // （钉住规格要求的行为），不是一层承重墙。T-L0 真正独家承重的是标签侧那条。
    expect(
      ids(
        '<root><styles><include src="s2r://panorama/styles/a.css" /></styles>' +
          '<snippets><snippet name="x"><Panel /></snippet></snippets><Panel /></root>',
      ),
    ).toEqual([]);
  });

  it('同一元素上多个未知属性各报一条，逐个区间精确', () => {
    const text = '<root><Label bogusone="1" bogustwo="2" /></root>';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vxml.unknownAttribute', 'vxml.unknownAttribute']);
    expect(diags.map((d) => text.slice(d.start, d.end))).toEqual(['bogusone', 'bogustwo']);
  });

  it('嵌套深处的未知属性照样报', () => {
    expect(ids('<root><Panel><Panel><Label bogusattr="x" /></Panel></Panel></root>')).toEqual([
      'vxml.unknownAttribute',
    ]);
  });

  it('A-L0（Ruling 22）：元素未闭合时跳过它的**最后一个**属性，前面的照判', () => {
    // T8 评审发现的噪音：编辑中途的半截属性名会立刻产出一条 hint——敲
    // `<Panel cla` 时 `cla` 就被报（`clas` 在观测层里、`cla` 不在，所以 A-L4
    // 也拦不住）。Ruling 22 的裁决是**只跳过最后一个属性**，不是「未闭合元素的
    // 属性全部不判」：`foo` 与 `bar` 已经写完整了，对它们下结论有依据；正在被敲
    // 的只有最后那个 token。
    //
    // 用例的两个名字必须是**真的**会被报的（否则这条测试是空转的，本项目已有
    // 十二次前科）：foo / bar 都不在 panels.json 的 Panel 属性集里（那 58 个里
    // 没有）、不是 data-/on 开头、观测层的 Panel 表里也没有——下面第一条断言
    // 正是在钉这一点：把 `cla` 换成写完整的属性时，三个都报。
    const done = '<root><Panel foo="1" bar="2" cla="3" /></root>';
    expect(ids(done)).toEqual([
      'vxml.unknownAttribute',
      'vxml.unknownAttribute',
      'vxml.unknownAttribute',
    ]);

    // 未闭合：末尾那个 `cla` 不判，foo / bar 照判。
    // tamper：去掉 A-L0 守卫 → 这里变成 3 条（多一条落在 `cla` 上）；
    //         把守卫写成「未闭合元素的属性全不判」→ 变成 0 条。两个方向都红。
    const editing = '<root><Panel foo="1" bar="2" cla';
    const diags = run(editing).filter((d) => d.ruleId === 'vxml.unknownAttribute');
    expect(diags.map((d) => editing.slice(d.start, d.end))).toEqual(['foo', 'bar']);
  });
});

// ===========================================================================
// 编排：两条规则不依赖工作区索引
// ===========================================================================

describe('diagnoseVxml · 标签/属性两条规则不依赖索引', () => {
  it('无索引时照常产出——它们是单文件判据，不像 unknownClass 需要跨文件事实', () => {
    // 这条挡住一种很容易犯的接线错误：把新规则塞进 ctx.index 的那个三元里，
    // 于是编辑器在索引建好之前（或索引被用户关掉时）一条都不报。
    // 两个面板套在一层 <Panel> 里（Task 8 之后）：并排挂在 <root> 下就是两个
    // 根面板，会正确地触发一条 vxml.structure（「根面板只能有一个」），与本
    // 用例要测的「不依赖索引」无关。
    expect(ids('<root><Panel><NopePanel /><Label bogusattr="x" /></Panel></root>')).toEqual([
      'vxml.unknownTag',
      'vxml.unknownAttribute',
    ]);
  });
});
