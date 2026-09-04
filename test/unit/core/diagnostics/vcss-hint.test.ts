import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { diagnoseVcss } from '../../../../src/core/diagnostics';
import { PropertyRegistry } from '../../../../src/core/data/properties';

const props = PropertyRegistry.load('zh-cn');

const A = '/p/panorama/styles/a.css';

/** 与 cross-file.test.ts 的 buildIndex 同一种构建方式：目录存在性用路径前缀模拟 */
function buildIndex(files: Record<string, string>): WorkspaceIndex {
  const known = new Set(Object.keys(files));
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));
  const idx = new WorkspaceIndex({ exists });
  for (const [uri, text] of Object.entries(files)) idx.update(symbolsOfVcss(uri, parseVcss(text)));
  return idx;
}

/** 只含占位内容的桩索引——测「取值不是任何 @define 的名字」这一侧时够用 */
const stubIndex = () => buildIndex({ [A]: '.a\n{\n\twidth: 1px;\n}' });

const run = (text: string, index?: WorkspaceIndex) =>
  diagnoseVcss(parseVcss(text), { uri: A, props, index, msg: ZH });
const ids = (text: string, index?: WorkspaceIndex) => run(text, index).map((d) => d.ruleId);

/** 带索引跑，专供 vcss.unknownValue —— 这条规则没有索引时整体跳过 */
const uv = (text: string, index: WorkspaceIndex = stubIndex()) => ids(text, index);

// ===========================================================================
// vcss.unknownProperty（规格 §10.2 第 1 条，hint）
// ===========================================================================

describe('diagnoseVcss · vcss.unknownProperty（10.2，hint）', () => {
  it('属性名不在人工清单里 → 报 hint，区间精确覆盖属性名本身', () => {
    const text = '.a\n{\n\tcolr: #fff;\n}';
    const diags = run(text);
    expect(diags.map((d) => d.ruleId)).toEqual(['vcss.unknownProperty']);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('colr');
    expect(diags[0].severity).toBe('hint');
    // 规格 §10.2 是「只是没见过」，提示必须把这层不确定性说出来，不能写成断言口气
    expect(diags[0].fix).toContain('人工整理');
  });

  it('清单里的属性不报', () => {
    expect(ids('.a\n{\n\twidth: 10px;\n\tflow-children: down;\n}')).toEqual([]);
  });

  it('属性名大小写变体不报——CSS 属性名大小写不敏感，语料里 26 处这么写', () => {
    // 两个构建合计实测：Width 6、Padding 6、Brightness 6、Margin-left 4、
    // Opacity 2、Height 2，全部是 Valve 自己出货的样式表里的真实声明。
    // 这一层（resolveProperty 的 toLowerCase 回退）是唯一保住它们的东西：
    // 去掉回退后每一行都会各报一条 hint。
    expect(ids('.a\n{\n\tWidth: 100%;\n}')).toEqual([]);
    expect(ids('.a\n{\n\tPadding: 32px;\n}')).toEqual([]);
    expect(ids('.a\n{\n\tMargin-left: 24px;\n}')).toEqual([]);
  });

  it('面板类型选择器后跟伪类不报（顶层）—— RadioButton:hover 不是一条属性名为 RadioButton 的声明', () => {
    // 本任务的头号陷阱。用 /^\s*([a-zA-Z-]+)\s*:/ 这类正则去认声明，会把
    // 「面板类型 + 伪类」的选择器整个误读成一条声明；写计划时的粗扫正是这么
    // 误报的（单构建 RadioButton 9 次、DropDown 8 次、ToggleButton 5 次）。
    // 走 AST 天然不会踩——顶层选择器扫到 '{' 才停，冒号不是停止符——但这条
    // 测试必须在，因为任何图省事改回正则的改法都会让它变红。
    expect(ids('RadioButton:hover\n{\n\tcolor: #fff;\n}')).toEqual([]);
    // 逗号分隔的多个面板类型选择器（语料 mainmenu_watch_eventsched.css:652 原样）
    expect(ids('Button:hover,ToggleButton:hover,RadioButton:hover\n{\n\tcolor: #fff;\n}')).toEqual(
      [],
    );
    // 后代选择器里的面板类型（语料 friendslist.css:120 原样）
    expect(ids('.friendslist-navbar-btn RadioButton:enabled:hover\n{\n\tcolor: #fff;\n}')).toEqual(
      [],
    );
  });

  it('面板类型选择器后跟伪类不报（嵌套位置）—— 上一个块少一个 } 时的解析恢复产物', () => {
    // 顶层那条走不到这里：解析器在**块内部**认声明时，停止符集合含 ':'，
    // 于是 `RadioButton:hover {` 会被切成 property=RadioButton、
    // value=`hover { color: #fff`（已实测）。触发条件是上一个块少一个 '}'
    // ——CSS 里最常见的手误，也正是规格给解析器定的「光标永远处在语法不
    // 完整的位置」这条硬约束要覆盖的场景。
    //
    // 判据是「取值里有未被引号包住的 '{'」：合法 VCSS 的声明取值不可能出现
    // 裸的左花括号，出现了就说明解析器在从未闭合块里恢复，此处的
    // property 其实是个选择器，不该拿去查属性清单。
    const text = '.outer\n{\n\twidth: 1px;\nRadioButton:hover\n{\n\tcolor: #fff;\n}\n';
    expect(ids(text)).toEqual([]);
  });

  it('取值里带引号的 { 照常判定——不能把 url("…{resources}…") 一起误当解析产物', () => {
    // 语料里 52 处 background-image: url("file://{resources}/videos/…")，取值
    // 里确实有 '{'，但它在引号内部。守卫必须跳过引号内容，否则这一层会把
    // 合法声明也一并放过（放过本身无害，但会掩盖真正的属性名拼写错误）。
    expect(ids('.a\n{\n\tbackgroun-image: url("file://{resources}/videos/x.webm");\n}')).toEqual([
      'vcss.unknownProperty',
    ]);
    expect(ids('.a\n{\n\tbackground-image: url("file://{resources}/videos/x.webm");\n}')).toEqual(
      [],
    );
  });

  it('Web 独有属性只报 webOnlyProperty，不叠加 unknownProperty——同一区间不挂两条', () => {
    // display / float / flex* / grid* 都不在 properties 段里，朴素实现会让
    // §10.1 的 warning 与本条 hint 同时落在同一个属性名区间上，说的却是同一
    // 个根因。§10.1 的那条有替代写法、级别也更高，本条让位。
    expect(ids('.a\n{\n\tdisplay: flex;\n}')).toEqual(['vcss.webOnlyProperty']);
    expect(ids('.a\n{\n\tfloat: left;\n}')).toEqual(['vcss.webOnlyProperty']);
    // webOnly 段没收录、靠前缀兜底的变体同样只报一条
    expect(ids('.a\n{\n\tgrid-area: x;\n}')).toEqual(['vcss.webOnlyProperty']);
    expect(ids('.a\n{\n\tflex-shrink: 1;\n}')).toEqual(['vcss.webOnlyProperty']);
  });

  it('CSS 自定义属性只报 customProperty，不叠加 unknownProperty', () => {
    expect(ids('.a\n{\n\t--x: 1px;\n}')).toEqual(['vcss.customProperty']);
  });

  it('补进数据文件的四个圆角长写法与四个边框宽度不报', () => {
    const text =
      '.a\n{\n' +
      '\tborder-top-left-radius: 4px;\n' +
      '\tborder-top-right-radius: 4px;\n' +
      '\tborder-bottom-right-radius: 3px;\n' +
      '\tborder-bottom-left-radius: 3px;\n' +
      '\tborder-top-width: 1px;\n' +
      '\tborder-right-width: 1px;\n' +
      '\tborder-bottom-width: 1px;\n' +
      '\tborder-left-width: 1px;\n' +
      '}';
    expect(ids(text)).toEqual([]);
  });

  it('@keyframes 的内层块里的声明同样判定', () => {
    expect(ids("@keyframes 'x'\n{\n\t0%\n\t{\n\t\tbrightnes: 2;\n\t}\n}")).toEqual([
      'vcss.unknownProperty',
    ]);
    // 同一位置的合法（大小写变体）写法不报——语料 playerstats_matchlister.css 原样
    expect(ids("@keyframes 'x'\n{\n\t0%\n\t{\n\t\tBrightness: 2;\n\t}\n}")).toEqual([]);
  });

  it('无索引也照常产出——这条不依赖工作区索引', () => {
    expect(ids('.a\n{\n\tcolr: #fff;\n}')).toEqual(['vcss.unknownProperty']);
  });
});

// ===========================================================================
// vcss.unknownValue（规格 §10.2 第 2 条，hint，需要索引）
//
// 判定顺序（每一层下面都有一条只被这一层保住的用例；顺序本身是承重的，
// 靠前的层会遮蔽靠后的层的用例）：
//
//   前置 B  整个取值恰好是一个裸标识符
//   （属性名在进入这一串之前已由遍历层的 withCanonicalProperty 归一成规范拼写）
//   前置 A/C  该属性在人工表里有非空取值枚举 → 未收录的属性归 vcss.unknownProperty
//                                          （Ruling 13）；没有「已知集合」就无从判断
//   前置 D  transition-property 取值域是属性名，不是关键字集合
//   L1      取值命中人工取值表（大小写不敏感）
//   L2      该位置由 §10.1 的值级规则专管      → 去重
//   L3      该位置由 vcss.unknownDefine 专管   → 去重
//   L4      CSS 具名颜色
//   L5      全局关键字词表
//   L6      工作区里存在同名 @define
// ===========================================================================

describe('diagnoseVcss · vcss.unknownValue（10.2，hint，需要索引）', () => {
  it('封闭关键字域属性上的未知取值 → 报 hint，区间精确覆盖取值本身', () => {
    const text = '.a\n{\n\tfont-weight: bogusWeight;\n}';
    const diags = run(text, stubIndex());
    expect(diags.map((d) => d.ruleId)).toEqual(['vcss.unknownValue']);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('bogusWeight');
    expect(diags[0].severity).toBe('hint');
    // 提示里要带上已知取值，并说清这份清单可能不全
    expect(diags[0].fix).toContain('bold');
    expect(diags[0].fix).toContain('人工整理');
  });

  it('语料实测的两种真实命中——闸门上 vcss.unknownValue 的全部 72 处都是这两种', () => {
    // 两个构建合计：horizontal-align: middle 58、font-style: italics 14。
    // 两者都与权威文档**正面冲突**，判定为 Valve 自己的笔误：
    // - horizontal-align 的枚举 left | center | right 在两份来源文档里各正面
    //   写了一次（VCSS-Panorama专属.md 与 CSS属性清单.md），是枚举而不是沉默；
    //   而「center 与 middle 同义」这句注解文档只挂在 vertical-align 那一行。
    //   作者注意到了这个同义关系、却没写在 horizontal 上。middle 是同族属性的
    //   合法值，复制粘贴改属性名就会产生它。
    // - font-style: italics 连 CSS 规范里都没有（合法值是 italic / oblique），
    //   与 italic 精确一字之差，同一份语料里 italic 与 italics 并存。
    expect(uv('.a\n{\n\thorizontal-align: middle;\n}')).toEqual(['vcss.unknownValue']);
    expect(uv('.a\n{\n\tfont-style: italics;\n}')).toEqual(['vcss.unknownValue']);
    // 对照：同一属性的合法取值不报——保证上面不是把整条属性判成了错
    expect(uv('.a\n{\n\thorizontal-align: center;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tfont-style: italic;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tvertical-align: middle;\n}')).toEqual([]);
  });

  it('Ruling 14 的准入判据：center_nopixelsnap 进表不报，middle 不进表照报', () => {
    // 这两行必须挨在一起看——它们钉的是「凭什么一个进人工表、另一个不进」，
    // 比写在注释里结实：把任何一侧的结论改掉，这条测试立刻变红。
    //
    // center_nopixelsnap **进表**，依据不是频次，是分布形态：它在
    // horizontal-align(44) / vertical-align(36) / text-align(2) 三个同族对齐
    // 属性上系统性出现。笔误不会这样跨三个属性传播；而 _nopixelsnap 是有
    // 明确引擎语义的复合词（不吸附像素网格），Web CSS 里没有对应概念，写得
    // 出它的人必然知道引擎认这个值。
    //
    // middle **不进表**：它只出现在 horizontal-align 一个属性上，而文档对这个
    // 属性的枚举是正面写死的三个值，且同义注解只挂在 vertical-align 上。
    expect(uv('.a\n{\n\thorizontal-align: center_nopixelsnap;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tvertical-align: center_nopixelsnap;\n}')).toEqual([]);
    expect(uv('.a\n{\n\ttext-align: center_nopixelsnap;\n}')).toEqual([]);
    expect(uv('.a\n{\n\thorizontal-align: middle;\n}')).toEqual(['vcss.unknownValue']);
  });

  it('Ruling 14 的另一半：font-weight 的 lighter / bolder 进表——同一张表的准入标准不能自相矛盾', () => {
    // font-weight 是**唯一**一个来源文档只写了「字重」二字、没给任何取值枚举的
    // 属性，表里那 6 个值本身就是 M1 从语料统计派生的。单构建（20260829、
    // 225 个样式表）按声明计数的分布：bold 201(+Bold 3) / medium 118(+Medium 2) /
    // normal 64 / lighter 31 / light 24 / black 23 / bolder 4 / thin 1，合计 471
    // ——与 data/vcss-properties.json 里 font-weight.frequency 的 471 精确吻合。
    // lighter(31) 比表内已收的 light(24) / black(23) / thin(1) 都更频繁——用什么
    // 标准放进了 thin，就得用同一标准放进 lighter。且两者都是 CSS 规范里的
    // 相对字重关键字，不是凭空冒出来的词。
    expect(uv('.a\n{\n\tfont-weight: lighter;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tfont-weight: bolder;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tfont-weight: thin;\n}')).toEqual([]);
    // 对照：确实没见过的字重照报——保证上面不是把整条属性的取值判定关掉了
    expect(uv('.a\n{\n\tfont-weight: bogusWeight;\n}')).toEqual(['vcss.unknownValue']);
  });

  it('前置 A：属性不在人工清单里时只报 unknownProperty，不再对它的取值下第二条结论', () => {
    // Ruling 13。与 isDefineReferenceCandidate 里的同型守卫保持一致：对属性
    // 本身都不确定，却对它的取值另下一条结论，与规格 §10「分级看数据源可
    // 靠性」相悖，且两条诊断说的是同一个根因。
    expect(uv('.a\n{\n\tcolr: someval;\n}')).toEqual(['vcss.unknownProperty']);
  });

  it('前置 A/C：属性名大小写变体照常查它的取值表', () => {
    // 归一提到遍历层之后，这一条钉的是「归一确实贯穿到了取值判定」：属性名
    // 只有大小写不同时，取值必须照常参与判定，不能因为 props.has('Font-weight')
    // 为假就整条跳过。
    //
    // 落点必须选一个**在 KEYWORD_ONLY_PROPERTIES 里**的属性。原来用的是
    // Overflow: bogusKeyword，那是错的：overflow 不在该集合里，归一贯穿全部
    // 层之后它会与小写的 overflow 一样归 vcss.unknownDefine（§10.1 warning）；
    // 而当时的实现只把归一带到了前置 C/D、L1、L2b，L2a 与 L3 仍拿原始 decl，
    // 于是 Overflow 漏到了 hint —— 那条断言把这个 warning/hint 翻转钉成了预期
    // 行为（评审 I-1）。font-weight / font-style 在 KEYWORD_ONLY_PROPERTIES 里，
    // L3 对它们恒假，大小写两种写法都该是 vcss.unknownValue，不存在翻转。
    expect(uv('.a\n{\n\tFont-weight: bogusWeight;\n}')).toEqual(['vcss.unknownValue']);
    expect(uv('.a\n{\n\tFont-style: italics;\n}')).toEqual(['vcss.unknownValue']);
    // 对照：大小写变体的合法取值同样不报——保证上面不是把整条属性判成了错
    expect(uv('.a\n{\n\tFont-weight: bold;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tOverflow: squish;\n}')).toEqual([]);
  });

  it('前置 B：取值不是单个裸标识符时不判——测量值 / 多 token / 函数调用都不是「关键字」', () => {
    expect(uv('.a\n{\n\twidth: 50px;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tbox-shadow: #00000080 3px 1px 4px 0px;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tbackground-size: 100% 100%;\n}')).toEqual([]);
  });

  it('前置 C：人工表里没有取值枚举的属性整条跳过——没有「已知集合」就无从判断', () => {
    // font-family 的取值域本质开放（任意字体名），data/vcss-properties.json
    // 给它的 values 是空数组。这一条只被前置 C 保住：L3 对 font-family 恒假
    // （它在 OPEN_ENDED_VALUE_PROPERTIES 里），L4/L5/L6 都拦不住一个字体名。
    expect(uv('.a\n{\n\tfont-family: Verdana;\n}')).toEqual([]);
  });

  it('前置 D：transition-property 的取值是属性名、不是关键字，整条跳过', () => {
    // 两个构建合计 2362 条 transition-property 声明、4112 个 token，取值域是
    // 「另一个 CSS 属性名（可逗号分隔、可带 !immediate 修饰）」，与「关键字
    // 不在已知集合里」是两回事。它的 values 是 ["none"]，非空，因此前置 C
    // 拦不住它——这一层是唯一的拦截点，删掉会立刻多出 1100+ 处误报。
    expect(uv('.a\n{\n\ttransition-property: opacity;\n}')).toEqual([]);
    expect(uv('.a\n{\n\ttransition-property: background-color;\n}')).toEqual([]);
  });

  it('L1：取值命中人工取值表就不报，比较大小写不敏感', () => {
    // -s2-mix-blend-mode 的三个取值在语料里合计 206 处（additive 104 /
    // screen 68 / normal 34），已经登记在 data/vcss-properties.json 里。
    // 这一条只被 L1 保住：L3 对它恒假（valuesOf 命中即返回 false），L4/L5/L6
    // 都不认识 additive。
    expect(uv('.a\n{\n\t-s2-mix-blend-mode: additive;\n}')).toEqual([]);
    // 补进数据文件的 background-size: cover（docs/CSS属性清单.md 明列
    // `contain`/`cover`/尺寸），语料 37 处
    expect(uv('.a\n{\n\tbackground-size: cover;\n}')).toEqual([]);
    // 大小写不敏感：语料里 font-weight: Bold 3 处、Medium 2 处（每构建）。
    // Bold 不在任何全局词表里，是「比较必须大小写不敏感」唯一没有旁路的钉子
    // （Left / Bottom 这类会被方位关键字词表兜住，测不出这一层）。
    expect(uv('.a\n{\n\tfont-weight: Bold;\n}')).toEqual([]);
  });

  it('L2：§10.1 的值级 warning 专管的位置不叠加 hint', () => {
    // background-size: clip_then_cover 已由 vcss.clipThenCover（warning，
    // 语料 10 处）覆盖，文案是「不是引擎关键字，是反编译器给某个背景缩放枚举
    // 值起的标签」。同一处不能再挂一条 unknownValue。
    //
    // 这一条只被 L2 保住：background-size 在 KEYWORD_ONLY_PROPERTIES 里，
    // L3 对它恒假；clip_then_cover 不是颜色、不是全局关键字、也不是 @define。
    expect(uv('.a\n{\n\tbackground-size: clip_then_cover;\n}')).toEqual(['vcss.clipThenCover']);
  });

  it('L2：animation-name 的取值由 vcss.unknownKeyframes 专管', () => {
    // animation-name 的 values 是 ["none"]，非空，前置 C 拦不住；
    // L3 对 animation-name 恒假（Task 4 已显式排除）。删掉这一支会让每个
    // 引用关键帧的地方同时挂 unknownKeyframes 与 unknownValue 两条。
    expect(uv('.a\n{\n\tanimation-name: someAnim;\n}')).toEqual(['vcss.unknownKeyframes']);
  });

  it('L3：vcss.unknownDefine 专管的位置不叠加 hint', () => {
    // box-shadow 的 values 非空（none/inset/fill/hollow），取值是裸标识符、
    // 不是颜色、不是全局关键字、索引里也查不到同名 @define——L4/L5/L6 全都
    // 拦不住。只有「这个位置是 @define 引用候选，归 §10.1 的 unknownDefine」
    // 这一层能保住它不变成第二条诊断。
    expect(uv('.a\n{\n\tbox-shadow: notDefinedAnywhere;\n}')).toEqual(['vcss.unknownDefine']);
  });

  it('L4：CSS 具名颜色不报', () => {
    // background-color 的 values 是 ["none","transparent"]，非空，前置 C 拦
    // 不住；L3 对具名颜色恒假（它自己就把具名颜色排除掉了），因此这一条只被
    // L4 保住。语料实测 290 处（white 145 / black 85 / red 20 / …）。
    expect(uv('.a\n{\n\tbackground-color: white;\n}')).toEqual([]);
    expect(uv('.a\n{\n\tbackground-color: crimson;\n}')).toEqual([]);
  });

  it('L5：跨属性通用的全局关键字不报', () => {
    // center 不在 flow-children 的取值表里（none/down/right/left/up/…-wrap），
    // 不是具名颜色，也不是 @define；L3 对它恒假（GLOBAL_VALUE_KEYWORDS 命中
    // 即返回 false）。只有 L5 拦得住。
    expect(uv('.a\n{\n\tflow-children: center;\n}')).toEqual([]);
    expect(uv('.a\n{\n\toverflow: inherit;\n}')).toEqual([]);
  });

  it('L6：取值是工作区里某个 @define 的名字就不报（跨文件事实）', () => {
    // 语料实测这一层在闸门上消掉 72 处，全部是
    // `background-size: backgroundDotsSize`——background-size 在
    // KEYWORD_ONLY_PROPERTIES 里，L3 对它恒假，因此这一层是唯一的拦截点。
    const index = buildIndex({
      '/p/panorama/styles/consts.css': '@define backgroundDotsSize: 32px 32px;',
      [A]: '.a\n{\n\tbackground-size: backgroundDotsSize;\n}',
    });
    expect(uv('.a\n{\n\tbackground-size: backgroundDotsSize;\n}', index)).toEqual([]);
    // 对照：同样的写法、工作区里没有这个常量时照报不误——保证上面不是把
    // 整条规则关掉了
    expect(uv('.a\n{\n\tbackground-size: backgroundDotsSize;\n}')).toEqual(['vcss.unknownValue']);
  });

  it('无索引时一条都不产出——@define 名字豁免这一层不成立时整条规则跳过', () => {
    // 没有工作区索引就查不到「取值是不是某个 @define 的名字」，那一层排除
    // 失效，语料实测会多出 72 处误报。与 unknownDefine / unknownKeyframes
    // 一致：判断的前提不成立时整条跳过，不是降级硬报。
    expect(ids('.a\n{\n\tfont-weight: bogusWeight;\n}')).toEqual([]);
    expect(ids('.a\n{\n\thorizontal-align: middle;\n}')).toEqual([]);
    // 对照：同一份文本给了索引就报——保证上面不是因为别的原因不报
    expect(uv('.a\n{\n\tfont-weight: bogusWeight;\n}')).toEqual(['vcss.unknownValue']);
  });
});

// ===========================================================================
// 属性名大小写不改变判定结果（Task 5 修复轮，评审 I-1）
//
// CSS 的属性名是 ASCII 大小写不敏感的，语料里 Valve 自己出货的写法就有 26 处
// 首字母大写（Width / Padding / Brightness / Margin-left / Opacity / Height）。
// Task 5 最初只在自己的两条 §10.2 规则内部做归一，而且只贯穿到前置 C/D、L1、
// L2b —— L2a 与 L3 仍拿原始 decl，§10.1 那几条规则更是全程大小写敏感，于是
// 同一条声明只因首字母大小写不同就在 warning ↔ hint 之间翻转（评审实测：
// overflow: bogusKeyword → unknownDefine 而 Overflow: bogusKeyword →
// unknownValue；visibility: hidden → 两条 warning 而 Visibility: hidden →
// 一条 hint）。
//
// 修法是把归一提到**遍历层**做一次，全部规则拿到的都是规范拼写。下面这条
// 表驱动测试钉的就是这个不变量本身——它比逐层各测一遍更结实：任何一条规则
// 将来改回大小写敏感比较，或者归一没有覆盖到某条新规则，都会让它变红。
// ===========================================================================

/** 首字母大写：'background-size' -> 'Background-size' */
const upperFirst = (s: string) => s[0].toUpperCase() + s.slice(1);

/** 每行：属性名（小写）、取值、小写写法下**期望**产出的 ruleId 列表 */
const CASE_INVARIANCE_CASES: readonly (readonly [string, string, readonly string[]])[] = [
  ['visibility', 'hidden', ['vcss.visibilityHidden']],
  ['position', 'absolute', ['vcss.positionKeyword']],
  ['background-size', 'clip_then_cover', ['vcss.clipThenCover']],
  ['animation-name', 'someAnim', ['vcss.unknownKeyframes']],
  ['box-shadow', '0px 2px 6px #fff', ['vcss.boxShadowColorFirst']],
  ['display', 'flex', ['vcss.webOnlyProperty']],
  ['flex-shrink', '1', ['vcss.webOnlyProperty']],
  ['overflow', 'bogusKeyword', ['vcss.unknownDefine']],
  ['font-weight', 'bogusWeight', ['vcss.unknownValue']],
  ['font-style', 'italics', ['vcss.unknownValue']],
  ['horizontal-align', 'middle', ['vcss.unknownValue']],
  ['width', '50vw', ['vcss.webUnit']],
  ['width', '100%', []],
  ['colr', 'someval', ['vcss.unknownProperty']],
  ['constructor', '1px', ['vcss.unknownProperty']],
];

describe('diagnoseVcss · 属性名大小写不改变判定结果', () => {
  it.each(CASE_INVARIANCE_CASES)('%s: %s —— 大小写两种写法产出完全相同的诊断', (prop, value, want) => {
    const mk = (p: string) => '.a\n{\n\t' + p + ': ' + value + ';\n}';
    // 只有 property 的首字母大小写不同，字符长度完全一致，因此两份文本里
    // 所有偏移逐字节对齐，start/end 可以直接比。
    const lower = run(mk(prop), stubIndex());
    const upper = run(mk(upperFirst(prop)), stubIndex());
    // 先钉住小写那侧的行为本身，否则「两侧都是空数组」也能让不变量成立
    expect(lower.map((d) => d.ruleId)).toEqual(want);
    const shape = (ds: typeof lower) =>
      ds.map((d) => [d.ruleId, d.severity, d.start, d.end]);
    expect(shape(upper)).toEqual(shape(lower));
  });

  it('归一只认得出的拼写才做，认不出的原样保留——原型链成员不会被当成已知属性', () => {
    // canonicalPropertyName 会对 webOnly 段做一次 [] 索引，'constructor' /
    // 'toString' 这类名字会顺着原型链拿到函数对象。守卫（typeof === 'string'
    // 与 props.has 的 Object.hasOwn）必须挡住它们，否则归一会把一个函数当成
    // 已知属性，unknownProperty 反而不报。
    expect(() => run('.a\n{\n\ttoString: 1px;\n}', stubIndex())).not.toThrow();
    expect(ids('.a\n{\n\ttoString: 1px;\n}')).toEqual(['vcss.unknownProperty']);
    expect(ids('.a\n{\n\t__proto__: 1px;\n}')).toEqual(['vcss.unknownProperty']);
  });
});
