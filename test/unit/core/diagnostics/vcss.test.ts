import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { diagnoseVcss } from '../../../../src/core/diagnostics';

const props = PropertyRegistry.load('zh-cn');
const run = (text: string) => diagnoseVcss(parseVcss(text), { uri: '/p/a.css', props, msg: ZH });
const ids = (text: string) => run(text).map((d) => d.ruleId);

/**
 * 每条规则实际画出来的波浪线。
 *
 * **这份文件此前 9 个 describe 块里只有 1 处区间断言**（「区间只覆盖属性名本身」），
 * 于是把这 9 条里另外 8 条的 `start`/`end` 各偏 1 个字符，全量 718 条测试仍然全绿
 * ——最终评审 I-1 用 28 条逐规则 tamper 实测过，绿的恰好就是没有区间断言的那 7 条
 * （第 8 条 `visibilityHidden` 当时靠适配层那条「偏移换算成行列」的用例夹具偶然守住，
 * 换个夹具就裸奔，所以一并补上）。
 *
 * **今天的区间是对的，坏的是没人拦得住它变坏。** 补断言时逐条挑的位置都满足
 * 「前后是不同种字符」——断在一段同种字符中间的话，偏一格照样通过，那正是本项目
 * 已经栽过十三次的空转测试形态。每条补完都实测过 ±1 偏移必然变红。
 */
const spans = (text: string) => run(text).map((d) => text.slice(d.start, d.end));

describe('diagnoseVcss · Web 独有属性', () => {
  it('display 报错并给出替代写法', () => {
    const [d] = run('.a\n{\n\tdisplay: flex;\n}');
    expect(d.ruleId).toBe('vcss.webOnlyProperty');
    expect(d.fix).toContain('flow-children');
  });

  it('区间只覆盖属性名本身', () => {
    const text = '.a\n{\n\tdisplay: flex;\n}';
    const [d] = run(text);
    expect(text.slice(d.start, d.end)).toBe('display');
  });

  it('webOnly 段没收录的 flex- / grid- 变体也报', () => {
    expect(ids('.a\n{\n\tflex-shrink: 1;\n}')).toEqual(['vcss.webOnlyProperty']);
    expect(ids('.a\n{\n\tgrid-area: x;\n}')).toEqual(['vcss.webOnlyProperty']);
  });

  it('类名里含 grid 不报——语料里 155 处 grid 全是类名', () => {
    expect(ids('.loadout-grid\n{\n\twidth: 10px;\n}')).toEqual([]);
  });

  it('transition 简写是 warning，而不是 hint —— 级别跟着数据源可靠性走', () => {
    // **用户直接确认 Panorama 不做多属性简写展开**，所以这条由「我们没见过这个
    // 属性」（vcss.unknownProperty，hint）升成「我们知道它不 work」
    // （vcss.webOnlyProperty，warning）——规格 §10 的分级原则是「级别跟着数据源的
    // 可靠性走」。生产工作区实跑时唯一那条诊断就是它：main.css:348 的
    // transition: width 0.5s ease-out 0s 在游戏里整条静默失效，进度条那 0.5 秒缓动
    // 实际是瞬间跳变。
    //
    // **语料侧不是这条升级的依据**：Valve 两构建 900 个样式表里该简写 0 处、长写法
    // 2389 处，按 Ruling 14 的判据「语料里没出现过」不构成排除证据。
    const [d] = run('.a\n{\n\ttransition: width 0.5s ease-out 0s;\n}');
    expect(d.ruleId).toBe('vcss.webOnlyProperty');
    expect(d.severity).toBe('warning');
    expect(d.fix).toContain('transition-property');
  });

  it('拆开写的长写法一条都不报', () => {
    expect(ids('.a\n{\n\ttransition-property: width;\n}')).toEqual([]);
    expect(ids('.a\n{\n\ttransition-duration: 0.5s;\n}')).toEqual([]);
  });

  it('animation / background / font 三个同族简写**维持 hint** —— 用户明确表示不确定', () => {
    // 同样是「Valve 900 个样式表里零命中」，但只有 transition 拿到了权威确认。
    // 证据强度不变，级别就不该变——hint 的全部意义就是把不确定的东西提出来给人看、
    // 不替人做主。这条守的是**没有顺手推广**：把这三个也塞进 webOnly 会让它变红。
    for (const p of ['animation: fade 1s', 'background: red', 'font: 12px arial']) {
      const [d] = run('.a\n{\n\t' + p + ';\n}');
      expect(d.ruleId, p).toBe('vcss.unknownProperty');
      expect(d.severity, p).toBe('hint');
    }
  });
});

describe('diagnoseVcss · position 取值', () => {
  it('position: absolute 报错', () => {
    expect(ids('.a\n{\n\tposition: absolute;\n}')).toEqual(['vcss.positionKeyword']);
  });

  it('layout-position: fixed 不报——属性名必须精确相等', () => {
    expect(ids('.a\n{\n\tlayout-position: fixed;\n}')).toEqual([]);
  });

  it('Panorama 的 position: 0px 0px 0px 不报', () => {
    expect(ids('.a\n{\n\tposition: 0px 0px 0px;\n}')).toEqual([]);
  });

  it('区间只覆盖取值，不含前面的空格与结尾的分号', () => {
    // 取值两侧分别是空格与分号，都不是标识符字符——偏一格必然切出别的东西。
    expect(spans('.a\n{\n\tposition: absolute;\n}')).toEqual(['absolute']);
  });
});

describe('diagnoseVcss · Web 单位', () => {
  it('vw / vh / em / rem 各报一条', () => {
    expect(ids('.a\n{\n\twidth: 50vw;\n}')).toEqual(['vcss.webUnit']);
    expect(ids('.a\n{\n\theight: 50vh;\n}')).toEqual(['vcss.webUnit']);
    expect(ids('.a\n{\n\twidth: 2em;\n}')).toEqual(['vcss.webUnit']);
    expect(ids('.a\n{\n\twidth: 1.5rem;\n}')).toEqual(['vcss.webUnit']);
  });

  it('px / % / vmin 不报', () => {
    expect(ids('.a\n{\n\twidth: 50px;\n\theight: 10%;\n}')).toEqual([]);
    expect(ids('.a\n{\n\twidth: 50vmin;\n}')).toEqual([]);
  });

  it('标识符里含 em 不报', () => {
    expect(ids('.a\n{\n\tfont-family: emoji;\n}')).toEqual([]);
  });

  it('区间只覆盖「数字+单位」，不含捕获组里的前导分隔符', () => {
    // 第二例是这条断言的重点：`translateX(2em)` 里正则的捕获组 1 是那个左括号，
    // 区间起点得是 `m.index + m[1].length` 而不是 `m.index`。漏掉 m[1].length
    // 会切出 `(2e`——这类「正则算术偏一位」正是本条规则最容易坏的地方，而它此前
    // 一条断言都没有。第一例的 m[1] 是空格，两例合起来两种分隔符各覆盖一次。
    const text = '.a\n{\n\twidth: 50vw;\n\ttransform: translateX(2em);\n}';
    expect(ids(text)).toEqual(['vcss.webUnit', 'vcss.webUnit']);
    expect(spans(text)).toEqual(['50vw', '2em']);
  });
});

describe('diagnoseVcss · 伪元素', () => {
  it('::before 报错', () => {
    expect(ids('.a::before\n{\n\twidth: 1px;\n}')).toEqual(['vcss.pseudoElement']);
  });

  it('单冒号伪类不报', () => {
    expect(ids('.a:hover\n{\n\twidth: 1px;\n}')).toEqual([]);
  });

  it('区间只覆盖 ::伪元素 本身，selectorStart 与 m.index 都得算对', () => {
    // 规则用的是 `rule.selectorStart + m.index`：选择器**不在文件开头**（前面有
    // 一个换行）钉住 selectorStart，伪元素**不在选择器开头**（前面有 `.a .b`）
    // 钉住 m.index——只钉一个的话另一个算错了照样绿。
    const text = '\n.a .b::before\n{\n\twidth: 1px;\n}';
    expect(spans(text)).toEqual(['::before']);
  });
});

describe('diagnoseVcss · visibility', () => {
  it('hidden 报错并指向 collapse', () => {
    const [d] = run('.a\n{\n\tvisibility: hidden;\n}');
    expect(d.ruleId).toBe('vcss.visibilityHidden');
    expect(d.fix).toContain('collapse');
  });

  it('visibility: collapse 不报', () => {
    expect(ids('.a\n{\n\tvisibility: collapse;\n}')).toEqual([]);
  });

  it('区间只覆盖取值 hidden，不含属性名', () => {
    // 这条规则此前唯一的区间防线在 test/unit/vscode/diagnostics-host.test.ts
    // 那条「偏移换算成行列」的用例里——它拿 visibility: hidden 当夹具，于是**顺带**
    // 钉住了这条的区间。那份防线是偶然的：换个夹具属性这条立刻裸奔。核心层自己
    // 得有一条。
    expect(spans('.a\n{\n\tvisibility: hidden;\n}')).toEqual(['hidden']);
  });
});

describe('diagnoseVcss · CSS 自定义属性', () => {
  it('声明 --x 报错并指向 @define', () => {
    const [d] = run('.a\n{\n\t--x: 1px;\n}');
    expect(d.ruleId).toBe('vcss.customProperty');
    expect(d.fix).toContain('@define');
  });

  it('var(--x) 报错', () => {
    expect(ids('.a\n{\n\twidth: var(--x);\n}')).toEqual(['vcss.customProperty']);
  });

  it('BEM 风格类名不报——语料里 4 处 -- 全是类名', () => {
    expect(ids('.HUD--has-c4--on-pickup\n{\n\twidth: 1px;\n}')).toEqual([]);
    expect(ids('.bracket2--teamPickem\n{\n\twidth: 1px;\n}')).toEqual([]);
  });

  it('声明侧的区间只覆盖属性名 --x', () => {
    expect(spans('.a\n{\n\t--x: 1px;\n}')).toEqual(['--x']);
  });

  it('引用侧的区间覆盖整个 var(…)，含右括号，且不含它前面的取值', () => {
    // 取值里 var() **不在开头**（前面还有一个 `0px `），钉住 `valueStart + m.index`；
    // 终点走的是 findMatchingParen，右括号必须被包进去（少一个就是 `var(--x`）。
    expect(spans('.a\n{\n\tmargin: 0px var(--x);\n}')).toEqual(['var(--x)']);
  });
});

describe('diagnoseVcss · @keyframes 引号', () => {
  it('不带引号报错', () => {
    const [d] = run('@keyframes fade\n{\n\tfrom\n\t{\n\t\topacity: 0;\n\t}\n}');
    expect(d.ruleId).toBe('vcss.keyframesUnquoted');
    expect(d.fix).toContain("'fade'");
  });

  it('带引号不报——语料里 226 个 keyframes 全部带引号', () => {
    expect(ids("@keyframes 'fade'\n{\n\tfrom\n\t{\n\t\topacity: 0;\n\t}\n}")).toEqual([]);
  });

  it('区间只覆盖名字，不含 @keyframes 后面的空格与随后的换行', () => {
    expect(spans('@keyframes fade\n{\n\tfrom\n\t{\n\t\topacity: 0;\n\t}\n}')).toEqual(['fade']);
  });
});

describe('diagnoseVcss · box-shadow 颜色在前', () => {
  it('Web 顺序（长度值打头）报错', () => {
    const [d] = run('.a\n{\n\tbox-shadow: 0px 0px 16px 0px #00000041;\n}');
    expect(d.ruleId).toBe('vcss.boxShadowColorFirst');
    expect(d.fix).toContain('颜色');
  });

  it('关键字后跟长度值仍报——inset 4px 是 Web 写法', () => {
    expect(ids('.a\n{\n\tbox-shadow: inset 4px 4px 0.5px 7px #fff;\n}')).toEqual([
      'vcss.boxShadowColorFirst',
    ]);
  });

  it('颜色在前不报', () => {
    expect(ids('.a\n{\n\tbox-shadow: #00000080 3px 1px 4px 0px;\n}')).toEqual([]);
    expect(ids('.a\n{\n\tbox-shadow: hollow rgba(14, 209, 95, 0.082) 0px 0px 15px 1px;\n}')).toEqual([]);
  });

  it('@define 名打头不报——语料里 63 处首 token 是常量名', () => {
    expect(ids('.a\n{\n\tbox-shadow: shadowOffset;\n}')).toEqual([]);
    expect(ids('.a\n{\n\tbox-shadow: box_shadow_on_color -4.5px -4.5px 18px 9px;\n}')).toEqual([]);
  });

  it('none 不报', () => {
    expect(ids('.a\n{\n\tbox-shadow: none;\n}')).toEqual([]);
  });

  it('区间覆盖整条取值，不含属性名与冒号', () => {
    // 这条同时咬住最终评审实测的那个「更粗的坏法」：把区间从取值拓宽成
    // 「属性名 → 取值末尾」（波浪线从 `1px 1px 2px #fff` 变成整条声明），
    // 它在 PINNED 里有 44 处命中却照样全绿——因为闸门只钉 file:line。
    expect(spans('.a\n{\n\tbox-shadow: 0px 0px 16px 0px #00000041;\n}')).toEqual([
      '0px 0px 16px 0px #00000041',
    ]);
  });
});

describe('diagnoseVcss · clip_then_cover', () => {
  it('报错并说明它是反编译器产物', () => {
    const [d] = run('.a\n{\n\tbackground-size: clip_then_cover;\n}');
    expect(d.ruleId).toBe('vcss.clipThenCover');
    expect(d.message).toContain('反编译');
  });

  it('cover / contain 不报', () => {
    expect(ids('.a\n{\n\tbackground-size: cover;\n}')).toEqual([]);
  });

  it('区间只覆盖 clip_then_cover 这个词，不是整条取值', () => {
    // 关键词**不在取值开头**（前面有 `100% `），所以 `valueStart + m.index` 里的
    // m.index 必须真的被加上；写成 valueStart 会切出 `100% clip_then_c`。
    expect(spans('.a\n{\n\tbackground-size: 100% clip_then_cover;\n}')).toEqual(['clip_then_cover']);
  });
});

describe('diagnoseVcss · 容错', () => {
  it('未闭合的规则块不崩溃', () => {
    expect(() => run('.a\n{\n\tdisplay: fle')).not.toThrow();
  });

  it('裸 { 不崩溃', () => {
    expect(() => run('{')).not.toThrow();
  });
});
