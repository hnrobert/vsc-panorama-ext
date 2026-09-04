import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { diagnoseVxml, diagnoseVcss } from '../../../../src/core/diagnostics';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import { CUSTOM_HUD_WHITELIST, layoutModeFor } from '../../../../src/core/mode';
import type { Diagnostic, RuleId } from '../../../../src/core/diagnostics/types';

/**
 * Task 9 —— 规格 §10.3 的七条 CustomHudLayout 白名单 error。
 *
 * **仅在 `mode === 'customHudLayout'` 时生效，且只作用于 VXML**（规格 §6.2：
 * CustomHudLayout 对样式没有任何限制，`custom_game/` 下的 `.css` 与别处完全
 * 同等对待）。本文件最后一节专门钉住后半句。
 *
 * 语料闸门对这七条**一点活信号都没有**，而且成因与 Ruling 16 那次（`vxml.
 * unknownAttribute` 的压制层是从被测语料自己挖的）不同：这里是**语料根本不进入
 * 这条代码路径**——990 个文件全在 `layout/` 下，没有一个匹配 `custom_game/`，
 * `layoutModeFor` 对它们一律返回 `'full'`。闸门里那七个 0 是「没跑过」，不是
 * 「跑过且没报」。**真正的防线只有这份单元测试**，标准相应提高：
 *
 * - 每条规则都有一个「只被这条规则保护」的用例，且逐个核过不会被别的规则遮蔽；
 * - 每条用例都实测过 tamper（改坏哪一行会让它变红，报错条数是多少），逐条记在
 *   task-9-report.md 里。
 *
 * 判定顺序（实现见 src/core/diagnostics/custom-hud.ts，顺序本身是承重的）：
 *
 *   标签 H-T0  root / styles / include        → 整个元素不判（标签与属性都不判）
 *        H-T1  未闭合（`el.unclosed`）        → 标签侧不报（Ruling 19 家族）
 *        H-T2  scripts                        → hud.scripts
 *        H-T3  snippets / snippet / Frame     → hud.snippetsOrFrame
 *        H-T4  Panel / Label / Image / Button → 进属性侧
 *              其余一切                        → hud.panelNotAllowed，属性不判
 *
 *   属性 H-A0  未闭合元素的**最后一个**属性   → 不判（Ruling 22）
 *        H-A1  style                          → hud.inlineStyle
 *        H-A2  on*                            → hud.scripts
 *        H-A3  Button 上的 text               → hud.buttonText
 *        H-A4  不在该面板白名单里              → hud.attributeNotAllowed
 *        H-A5  取值里的 {d:} / {g:} / {t:}    → hud.binding（与 H-A1..A4 并行，
 *                                               区间在取值里、与属性名不重叠）
 */
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();
const props = PropertyRegistry.load('zh-cn');

/** 命中 `panorama.customHudLayout.include` 默认 glob 的路径 */
const HUD_LAYOUT = '/p/panorama/layout/custom_game/hud.xml';
/** 不命中的普通布局 */
const FULL_LAYOUT = '/p/panorama/layout/a.xml';

/** 不带索引跑：跨文件的 `vxml.unknownClass` 因此整体跳过 */
const strict = (text: string): Diagnostic[] =>
  diagnoseVxml(parseVxml(text), {
    uri: HUD_LAYOUT,
    mode: 'customHudLayout',
    panels,
    observed,
    msg: ZH,
  });
const full = (text: string): Diagnostic[] =>
  diagnoseVxml(parseVxml(text), { uri: FULL_LAYOUT, mode: 'full', panels, observed, msg: ZH });

/** 只看本任务这七条；别的规则由 Task 7/8 的测试各自负责 */
const hud = (text: string): Diagnostic[] => strict(text).filter((d) => d.ruleId.startsWith('hud.'));
const hudIds = (text: string): RuleId[] => hud(text).map((d) => d.ruleId);
/** 命中处的原文片段——比裸偏移量可读，区间写歪立刻看得出来 */
const hudSpans = (text: string): string[] => hud(text).map((d) => text.slice(d.start, d.end));

// ===========================================================================
// 0. 路径判定与模式开关
// ===========================================================================

describe('§10.3 · 只在 CustomHudLayout 模式下生效', () => {
  // 七条规则全部踩一遍的一份文档。下面两条用例共用它，一条断言严格模式下
  // 七条都报、一条断言普通模式下一条都不报。
  const KITCHEN_SINK =
    '<root>' +
    '<scripts><include src="s2r://panorama/scripts/x.js" /></scripts>' +
    '<snippets><snippet name="s"><Panel /></snippet></snippets>' +
    '<Panel>' +
    '<TextButton />' +
    '<Frame />' +
    '<Panel hittestchildren="true" style="width: 10px;" onactivate="Go()" />' +
    '<Button text="Go" />' +
    '<Label text="{d:score}" />' +
    '</Panel>' +
    '</root>';

  it('严格模式下七条规则各至少命中一次', () => {
    // 七条一条不落——少一条就说明那条规则整个没接进编排层。
    expect(new Set(hudIds(KITCHEN_SINK))).toEqual(
      new Set([
        'hud.panelNotAllowed',
        'hud.attributeNotAllowed',
        'hud.buttonText',
        'hud.scripts',
        'hud.inlineStyle',
        'hud.snippetsOrFrame',
        'hud.binding',
      ]),
    );
    // 级别是 error（规格 §10.3：后果确定，级别就该到 error）
    expect(new Set(hud(KITCHEN_SINK).map((d) => d.severity))).toEqual(new Set(['error']));
    // 规格 §10.1 末段要求每条都给替代写法，§10.3 同理——只说「这个不行」没用
    expect(hud(KITCHEN_SINK).every((d) => (d.fix ?? '').length > 0)).toBe(true);
  });

  it('同一份文档在 full 模式下一条 hud.* 都不报', () => {
    // tamper：拿掉 diagnoseVxml 里 `ctx.mode === 'customHudLayout'` 那个判断
    // （改成无条件跑白名单规则），这条立刻红。
    expect(full(KITCHEN_SINK).filter((d) => d.ruleId.startsWith('hud.'))).toEqual([]);
    // 而且不是「什么都没报」——普通模式下 §10.1/§10.2 照常工作，否则这条用例
    // 用一份根本没被诊断过的文档也能全绿（本项目的空转形态之一）。
    expect(full(KITCHEN_SINK).length).toBeGreaterThan(0);
  });

  it('默认 glob 认得 custom_game/ 这条路径——模式判定与本文件的夹具是同一套', () => {
    // 上面两条用例是把 mode 直接喂进 ctx 的。这条把 §6.2 的路径判定也钉一次，
    // 否则「规则只在 custom_game/ 下生效」这句话在测试里是断的：夹具的 uri
    // 可能根本不匹配那个 glob，而没有任何一条断言会发现。
    expect(layoutModeFor(HUD_LAYOUT)).toBe('customHudLayout');
    expect(layoutModeFor(FULL_LAYOUT)).toBe('full');
  });
});

// ===========================================================================
// 1. hud.panelNotAllowed —— 四种面板之外的任何面板类型
// ===========================================================================

describe('§10.3 · hud.panelNotAllowed', () => {
  it('引擎认得、白名单不认的面板类型照样报 error', () => {
    // 挑 TextButton 是有意的：它在 data/panels.json 里（所以 vxml.unknownTag
    // 不会命中）、`rootOnly` 为 false（所以 vxml.rootOnlyNested 也不会命中），
    // 于是这条 error 只可能由白名单规则产生，不是蹭了别人的命中。
    const text = '<root><Panel><TextButton /></Panel></root>';
    expect(hudIds(text)).toEqual(['hud.panelNotAllowed']);
    expect(hudSpans(text)).toEqual(['TextButton']);
    expect(strict(text).map((d) => d.ruleId)).toEqual(['hud.panelNotAllowed']);
  });

  it('白名单里的四种面板不报', () => {
    // tamper：白名单表里删掉任何一种（例如 Image），这条立刻红 1 条。
    expect(hudIds('<root><Panel><Label /><Image /><Button /></Panel></root>')).toEqual([]);
    // 白名单就是 mode.ts 那张表本身，不在这里重抄一份（brief 明令）
    expect(Object.keys(CUSTOM_HUD_WHITELIST).sort()).toEqual(['Button', 'Image', 'Label', 'Panel']);
  });

  it('root / styles / include 三个结构元素不报——否则严格模式下没法引样式表', () => {
    // <styles><include src=… /></styles> 是 CustomHudLayout 引 .vcss 的唯一
    // 途径（规格 §6.2 明确样式不受限），把它们判成「不允许的面板类型」会让每份
    // 合法的严格模式布局都挂三条 error。
    // tamper：从 H-T0 的允许集里去掉 include，这条红 1 条；去掉 styles 红 1 条。
    expect(
      hudIds('<root><styles><include src="s2r://panorama/styles/x.css" /></styles><Panel /></root>'),
    ).toEqual([]);
  });
});

// ===========================================================================
// 2. hud.attributeNotAllowed —— 该面板白名单之外的属性
// ===========================================================================

describe('§10.3 · hud.attributeNotAllowed', () => {
  it('XSD 认、白名单不认的属性报 error，且区间落在属性名上', () => {
    // hittestchildren 是 data/panels.json 里如假包换的 Panel 属性（所以
    // vxml.unknownAttribute 不会命中，这条 error 是白名单规则独家产出的），
    // 但不在 §6.2 的 Panel 白名单（id / class / hittest）里。
    const text = '<root><Panel hittestchildren="true" /></root>';
    expect(hudIds(text)).toEqual(['hud.attributeNotAllowed']);
    expect(hudSpans(text)).toEqual(['hittestchildren']);
    // 没有蹭 §10.2 的命中：整份诊断里没有 vxml.unknownAttribute
    expect(strict(text).map((d) => d.ruleId)).toEqual(['hud.attributeNotAllowed']);
    expect(panels.hasAttribute('Panel', 'hittestchildren')).toBe(true);
  });

  it('白名单内的属性逐面板放行', () => {
    // 每种面板都把自己白名单里的属性写全，一条都不该报。
    expect(
      hudIds(
        '<root><Panel>' +
          '<Panel id="a" class="b" hittest="true" />' +
          '<Label id="c" class="d" hittest="true" text="hi" />' +
          '<Image id="e" class="f" hittest="true" src="s2r://panorama/images/x.png"' +
          ' texturewidth="10" textureheight="10" />' +
          '<Button id="g" class="h" />' +
          '</Panel></root>',
      ),
    ).toEqual([]);
  });

  it('判定是**逐面板**的，不是把四张表并起来', () => {
    // 这条专门咬「把白名单塌成一个扁平属性集」这种坏法：下面三个属性各自都在
    // **别的**面板的白名单里，塌平之后一条都报不出来。
    // tamper：把 customHudAttributesOf 换成「四张表的并集」，这条红 3 条。
    expect(hudIds('<root><Panel><Panel text="x" /></Panel></root>')).toEqual([
      'hud.attributeNotAllowed', // text 只属于 Label
    ]);
    expect(hudIds('<root><Panel><Panel src="s2r://panorama/images/x.png" /></Panel></root>')).toEqual([
      'hud.attributeNotAllowed', // src 只属于 Image
    ]);
    expect(hudIds('<root><Panel><Button hittest="true" /></Panel></root>')).toEqual([
      'hud.attributeNotAllowed', // hittest 属于 Panel/Label/Image，唯独不属于 Button
    ]);
  });

  it('不允许的面板类型不再逐属性重复报——同一根因只报一条', () => {
    // <TextButton id="x" class="y" foo="z" /> 只报「这个面板类型不允许」一条。
    // 逐属性再报三条说的是同一件事（面板本身就不能用），而且 foo 这种属性在一个
    // 根本不该存在的面板上判「属不属于白名单」也没有依据——与 Ruling 17
    // （标签不认识就不判它的属性）是同一条原则。
    expect(hudIds('<root><Panel><TextButton id="x" class="y" foo="z" /></Panel></root>')).toEqual([
      'hud.panelNotAllowed',
    ]);
  });
});

// ===========================================================================
// 3. hud.buttonText —— <Button text="…"> 单独成条
// ===========================================================================

describe('§10.3 · hud.buttonText', () => {
  it('Button 上的 text 报的是 buttonText，不是 attributeNotAllowed', () => {
    // 规格 §10.3 明确它「单独成条」，因为「文字请用子 <Label>」比「Button 不
    // 支持 text 属性」有用得多。
    // tamper：删掉 H-A3 这一层，它会掉进 H-A4 变成 hud.attributeNotAllowed，
    // 这条红（ruleId 对不上，且 message 里的 <Label> 提示没了）。
    const text = '<root><Panel><Button text="Go" /></Panel></root>';
    expect(hudIds(text)).toEqual(['hud.buttonText']);
    expect(hudSpans(text)).toEqual(['text']);
    expect(hud(text)[0].message).toContain('Label');
  });

  it('Label 上的 text 合法，不报', () => {
    // 咬「buttonText 写成不看标签名」这种坏法。
    expect(hudIds('<root><Panel><Label text="Go" /></Panel></root>')).toEqual([]);
  });
});

// ===========================================================================
// 4. hud.scripts —— <scripts> 块与任何 on* 属性
// ===========================================================================

describe('§10.3 · hud.scripts', () => {
  it('<scripts> 块报一条，区间在标签名上', () => {
    // 块里的 <include> 不再各报一条——它是 H-T0 的允许集成员。
    const text = '<root><scripts><include src="s2r://panorama/scripts/x.js" /></scripts><Panel /></root>';
    expect(hudIds(text)).toEqual(['hud.scripts']);
    expect(hudSpans(text)).toEqual(['scripts']);
  });

  it('on* 事件属性报 scripts，不是 attributeNotAllowed', () => {
    // onactivate 是 data/panels.json 里合法的 Panel 属性（vxml.unknownAttribute
    // 不会命中），只被 §10.3 拦下。
    // tamper：删掉 H-A2 这一层，它掉进 H-A4 变成 hud.attributeNotAllowed，这条红。
    const text = '<root><Panel onactivate="Go()" /></root>';
    expect(hudIds(text)).toEqual(['hud.scripts']);
    expect(hudSpans(text)).toEqual(['onactivate']);
    expect(panels.hasAttribute('Panel', 'onactivate')).toBe(true);
  });
});

// ===========================================================================
// 5. hud.inlineStyle —— style 内联属性
// ===========================================================================

describe('§10.3 · hud.inlineStyle', () => {
  it('style 报 inlineStyle，并提示改用 .vcss + class', () => {
    // tamper：删掉 H-A1 这一层，它掉进 H-A4 变成 hud.attributeNotAllowed，这条红。
    const text = '<root><Panel style="width: 10px;" /></root>';
    expect(hudIds(text)).toEqual(['hud.inlineStyle']);
    expect(hudSpans(text)).toEqual(['style']);
    expect(hud(text)[0].fix).toContain('class');
  });

  it('style 在 XSD 里是合法的 Panel 属性——§10.2 不会命中它（规格 §10.3 末段）', () => {
    // 这句是去重那一节的前提（style 不在重叠之列），在这里也钉一次：若哪天
    // panels.json 里 Panel 没了 style，dedup.test.ts 那条「非重叠」用例会从
    // 「本来就只有一条」悄悄变成「靠去重才剩一条」，去重写宽了也发现不了。
    expect(panels.hasAttribute('Panel', 'style')).toBe(true);
    expect(strict('<root><Panel style="width: 10px;" /></root>').map((d) => d.ruleId)).toEqual([
      'hud.inlineStyle',
    ]);
  });
});

// ===========================================================================
// 6. hud.snippetsOrFrame —— <snippets> / <snippet> / <Frame>
// ===========================================================================

describe('§10.3 · hud.snippetsOrFrame', () => {
  it('<snippets> 与 <snippet> 各报一条，里面的 <Panel> 不受牵连', () => {
    const text = '<root><snippets><snippet name="s"><Panel /></snippet></snippets><Panel /></root>';
    expect(hudIds(text)).toEqual(['hud.snippetsOrFrame', 'hud.snippetsOrFrame']);
    expect(hudSpans(text)).toEqual(['snippets', 'snippet']);
  });

  it('<Frame> 报的是 snippetsOrFrame，不是 panelNotAllowed', () => {
    // Frame 在 panels.json 里是一种正经面板（derivedFrom: Panel），落到白名单
    // 规则手里两条都可能命中——规格把它与 snippets 归在同一条，因为根因是同一个
    // 「复用机制不可用」。
    // tamper：把 Frame 从 H-T3 的集合里去掉，它掉进 hud.panelNotAllowed，这条红。
    const text = '<root><Panel><Frame /></Panel></root>';
    expect(hudIds(text)).toEqual(['hud.snippetsOrFrame']);
    expect(hudSpans(text)).toEqual(['Frame']);
    expect(panels.get('Frame')?.rootOnly).toBe(false);
  });
});

// ===========================================================================
// 7. hud.binding —— 只有 {s:} 开放
// ===========================================================================

describe('§10.3 · hud.binding', () => {
  it('{s:} 放行', () => {
    expect(hudIds('<root><Panel><Label text="{s:playername}" /></Panel></root>')).toEqual([]);
  });

  it('{d:} / {g:} / {t:} 各报一条，区间正好覆盖前缀', () => {
    const text =
      '<root><Panel>' +
      '<Label text="{d:score}" /><Label text="{g:x}" /><Label text="{t:y}" />' +
      '</Panel></root>';
    expect(hudIds(text)).toEqual(['hud.binding', 'hud.binding', 'hud.binding']);
    expect(hudSpans(text)).toEqual(['{d:', '{g:', '{t:']);
    // tamper：把判据写成「取值里出现 {」（连 {s:} 一起报），上面那条 {s:} 用例红；
    // 把判据写成只查 {d:}，这条红 2 条。
  });

  it('取值中段的绑定也认，一个取值里多个绑定各报一条', () => {
    // 咬「只看取值开头」这种坏法——真实写法几乎都是 "Score: {d:x}"。
    const text = '<root><Panel><Label text="Score: {d:a} / {t:b}" /></Panel></root>';
    expect(hudIds(text)).toEqual(['hud.binding', 'hud.binding']);
    expect(hudSpans(text)).toEqual(['{d:', '{t:']);
  });

  it('绑定判定与属性名判定并行——两条区间不重叠，各报各的', () => {
    // hittestchildren 不在白名单（属性名区间一条 error），它的取值里又有 {d:}
    // （取值区间一条 error）。两者根因不同、区间不重叠，都留着。
    // tamper：把绑定扫描挪进「属性名合法」的分支里，这条红 1 条（少了 binding）。
    const text = '<root><Panel hittestchildren="{d:x}" /></root>';
    expect(hudIds(text)).toEqual(['hud.attributeNotAllowed', 'hud.binding']);
    expect(hudSpans(text)).toEqual(['hittestchildren', '{d:']);
  });
});

// ===========================================================================
// 8. 编辑中途：Ruling 19 家族的第五、第六次应用
// ===========================================================================

describe('§10.3 · 信息不完整时不下结论（Ruling 19 / 22）', () => {
  it('未闭合元素的标签名不报 hud.*——那一刻由 vxml.syntax 独家负责', () => {
    // 用户敲到 `<root><Panel><TextButt` 的中途：`TextButt` 是个半截标签名，
    // 此刻断言「TextButt 不是允许的面板类型」是纯噪音（Ruling 19 对
    // vxml.unknownTag 的裁决，同一条原则）。
    //
    // **这里还有一层去重带来的额外理由，是 brief 没写的**：hud.panelNotAllowed
    // 的区间与 vxml.syntax 的「开始标签缺 >」完全重合，去重规则让 §10.3 优先，
    // 于是不加这个守卫的话，用户看到的会是「TextButt 不是允许的面板类型」而不是
    // 「开始标签 <TextButt> 缺少 >」——后者才是他此刻要改的。
    // tamper：去掉 H-T1 守卫，这条红（多出 hud.panelNotAllowed、且 vxml.syntax
    // 被去重吃掉，断言的数组从 ['vxml.syntax'] 变成 ['hud.panelNotAllowed']）。
    const text = '<root><Panel><TextButt';
    expect(strict(text).map((d) => d.ruleId)).toEqual(['vxml.syntax']);
  });

  it('Ruling 24：属性值缺引号时，§10.3 不对这个属性下结论（由 vxml.syntax 独家负责）', () => {
    // 交付时的行为：`hud.attributeNotAllowed` 与 `vxml.syntax` 区间完全重合
    // （都落在属性名上），去重让 §10.3 优先，于是**「少了引号」这句提示消失了**。
    // 这是 Ruling 23（未闭合的开始标签）的同型第二例，控制者据此把它推广成通则：
    // **hud.* 不得对语法本身有问题的构造下结论**——`<Panel width=10 />` 里 width
    // 到底算不算一个属性都还没定，就断言「这个属性不在白名单里」是越界的。
    //
    // tamper：把调用点的 judgeableAttributes(text, el) 换回只按 Ruling 22 过滤，
    // 这条红（变成 ['hud.attributeNotAllowed']，两条 §10.1/§10.2 全被去重吃掉）。
    const text = '<root><Panel width=10 /></root>';
    expect(hudIds(text)).toEqual([]);
    // 严格模式下的输出与普通模式**逐条相同**——这正是「那些位置由 vxml.syntax
    // 独家负责」的可观测含义。
    //
    // **这一行交付时断的是 ['vxml.syntax', 'vxml.unknownAttribute']**，台账把那个
    // 双报记成了预期结果。最终评审 M-1 指出那是判断失误：当时论证的是「严格模式要
    // 与 full 模式逐条相同」这个对称性，没有人回头问「full 模式自己该不该在一个
    // token 上报两条」——而 Ruling 24 的原话（`width` 算不算一个属性都还没定）
    // 换成 `vxml.unknownAttribute` 一个字都不用改。守卫收进 judgeableAttributes
    // 之后两侧同时只剩 vxml.syntax，对称性照旧成立。
    expect(strict(text).map((d) => d.ruleId)).toEqual(['vxml.syntax']);
    expect(strict(text)).toEqual(full(text));
  });

  it('Ruling 24 是**逐属性**的：坏的那个跳过，同一元素上写好的照判', () => {
    // 与 Ruling 22「只跳过最后一个」同样的粒度取舍——坏的是哪个构造就跳哪个，
    // 不牵连整个元素。hittestchildren 的右引号缺失（扫描到行尾为止），tabindex
    // 写得好好的；两个都是 panels.json 里合法的 Panel 属性、都不在 §6.2 白名单里。
    // tamper：把守卫写成「元素里只要有一个属性坏了就整个元素不判」，这条红
    // （tabindex 那条 error 会消失）。
    const text = '<root><Panel hittestchildren="foo\n tabindex="2" /></root>';
    expect(hudIds(text)).toEqual(['hud.attributeNotAllowed']);
    expect(hudSpans(text)).toEqual(['tabindex']);
    expect(strict(text).map((d) => d.ruleId)).toContain('vxml.syntax');
  });

  it('**不**推广到「缺闭合标签」：那里 §10.3 照旧优先（Ruling 24 的边界）', () => {
    // 边界写在这里，防止后来者把 Ruling 24 读成「元素只要有任何语法毛病就整个
    // 不判」。缺闭合标签与前两例的区别是**构造的身份已经确定**：`<Frame>` 就是
    // 一个 Frame 元素，没有任何未定的余地，「Frame 在自定义 HUD 里不可用」这个
    // 结论不建在沙子上。
    //
    // 反过来推广的代价是实测过的：自上而下新写一个文件时，**每一层祖先**都处在
    // 「还没有闭合标签」的状态，推广之后整份文件在写完最后一个 </…> 之前一条
    // hud.* 都不会报——把 error 级的白名单规则做成了「写完才生效」。
    const closed = '<root><Panel><Frame></Panel></root>';   // 忘了 </Frame>
    const typing = '<root><Panel><Frame>';                   // 自上而下敲到一半
    for (const text of [closed, typing]) {
      expect(hudIds(text)).toEqual(['hud.snippetsOrFrame']);
      // vxml.syntax 与它区间重合，按规格 §10.3「范围重叠时保留 10.3」被去重删掉
      expect(strict(text).map((d) => d.ruleId)).toEqual(['hud.snippetsOrFrame']);
      expect(full(text).map((d) => d.ruleId)).toEqual(['vxml.syntax']);
    }
  });

  it('未闭合元素只跳过最后一个属性，前面写完的照判（Ruling 22）', () => {
    // hittestchildren / tabindex 都是 panels.json 里合法的 Panel 属性（所以
    // vxml.unknownAttribute 不会掺进来），但都不在 §6.2 的白名单里 —— 它们已经
    // 写完整了，判定有依据；正在被敲的只有末尾那个 `hittes`。
    // tamper：去掉 H-A0 守卫，这条红（多出一条落在 `hittes` 上的 error）。
    const text = '<root><Panel><Panel hittestchildren="1" tabindex="2" hittes';
    expect(hudIds(text)).toEqual(['hud.attributeNotAllowed', 'hud.attributeNotAllowed']);
    expect(hudSpans(text)).toEqual(['hittestchildren', 'tabindex']);
    expect(panels.hasAttribute('Panel', 'tabindex')).toBe(true);
  });
});

// ===========================================================================
// 9. 作用域仅限 VXML —— 规格 §6.2「CustomHudLayout 对样式没有任何限制」
// ===========================================================================

describe('§6.2 · custom_game/ 下的 .css 与别处完全同等对待', () => {
  it('custom_game/ 下的样式表不产出任何 hud.*，而 §10.1 照常工作', () => {
    // 这份 CSS 里有一条 §10.1 的真命中（visibility: hidden），断言里带上它，
    // 这条用例才不是「拿一份根本没被诊断过的文档断言没有 hud.*」——那是本项目
    // 十二次空转前科里的典型形态。
    const css = '.a { visibility: hidden; }';
    const uri = '/p/panorama/layout/custom_game/hud.css';
    const ids = diagnoseVcss(parseVcss(css), { uri, props, msg: ZH }).map((d) => d.ruleId);
    expect(ids).toEqual(['vcss.visibilityHidden']);
    expect(ids.filter((id) => id.startsWith('hud.'))).toEqual([]);
    // 与同一份内容在普通路径下的结果逐条相同——「同等对待」的字面含义
    expect(diagnoseVcss(parseVcss(css), { uri: '/p/panorama/styles/a.css', props, msg: ZH })).toEqual(
      diagnoseVcss(parseVcss(css), { uri, props, msg: ZH }),
    );
  });

  it('严格模式下的 VXML 里，样式类的写法只由 §10.3 的 inlineStyle 管，不牵连 class', () => {
    // 反过来钉一次：class= 是白名单成员，严格模式下写多少个都不该报。
    expect(hudIds('<root><Panel class="a b c"><Label class="d" text="x" /></Panel></root>')).toEqual(
      [],
    );
  });
});
