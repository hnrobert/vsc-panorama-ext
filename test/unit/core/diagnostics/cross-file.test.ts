import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { diagnoseVcss, diagnoseVxml } from '../../../../src/core/diagnostics';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';

const props = PropertyRegistry.load('zh-cn');
// Task 7 起 VxmlDiagCtx 必填这两项（vxml.unknownTag / vxml.unknownAttribute 的数据源）
const panels = PanelRegistry.load('zh-cn');
const observed = ObservedAttributes.load();

/**
 * 与 test/unit/core/index/workspace-index.test.ts 里的 build() 同一种构建
 * 方式：目录存在性用「是不是某个文件的路径前缀」模拟，不需要真实文件系统。
 */
function buildIndex(files: Record<string, string>): WorkspaceIndex {
  const known = new Set(Object.keys(files));
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));
  const idx = new WorkspaceIndex({ exists });
  for (const [uri, text] of Object.entries(files)) {
    idx.update(
      uri.endsWith('.xml') ? symbolsOfVxml(uri, parseVxml(text)) : symbolsOfVcss(uri, parseVcss(text)),
    );
  }
  return idx;
}

const A = '/p/panorama/styles/a.css';
const B = '/p/panorama/styles/b.css';
const LAYOUT = '/p/panorama/layout/a.xml';

/** 用一个只含占位内容的桩文件建索引——测试跨文件解析以外的判据时，index 只是「存在」这一事实本身要紧 */
const stubIndex = () => buildIndex({ [A]: '.a\n{\n\twidth: 1px;\n}' });

const vcssIds = (text: string, index?: WorkspaceIndex, uri = A) =>
  diagnoseVcss(parseVcss(text), { uri, props, index, msg: ZH }).map((d) => d.ruleId);

const vxmlIds = (text: string, index?: WorkspaceIndex) =>
  diagnoseVxml(parseVxml(text), { uri: LAYOUT, mode: 'full', panels, observed, index, msg: ZH }).map((d) => d.ruleId);

describe('diagnoseVcss · vcss.unknownDefine（跨文件）', () => {
  it('定义在 A 文件、引用在 B 文件 → 不报（跨文件解析正确）', () => {
    const bText = '.a\n{\n\tcolor: brandColor;\n}';
    const index = buildIndex({
      [A]: '@define brandColor: #ff0000;',
      [B]: bText,
    });
    expect(vcssIds(bText, index, B)).toEqual([]);
  });

  it('谁都没定义的常量 → 报', () => {
    expect(vcssIds('.a\n{\n\tcolor: totallyUndefinedConst;\n}', stubIndex())).toEqual([
      'vcss.unknownDefine',
    ]);
  });

  it('诊断区间精确覆盖常量名本身，级别为 warning', () => {
    const text = '.a\n{\n\tcolor: totallyUndefinedConst;\n}';
    const [d] = diagnoseVcss(parseVcss(text), { uri: A, props, index: stubIndex(), msg: ZH });
    expect(text.slice(d.start, d.end)).toBe('totallyUndefinedConst');
    expect(d.severity).toBe('warning');
  });

  it('flow-children: right 不报——候选桶的噪音不能变成诊断', () => {
    expect(vcssIds('.a\n{\n\tflow-children: right;\n}', stubIndex())).toEqual([]);
    // right 恰好也在方位关键字词表里（background-position 需要它），因此
    // 单独一个 right 用例不足以证明「按属性查已知取值表」这条路径本身在
    // 起作用——tamper 实测过（见 task-4-report.md）：只关掉 right 命中的这
    // 那条全局词表，上面这行依然通过。down-wrap 不在任何全局词表里，只有
    // flow-children 自己的取值表能保住它，是这条路径唯一没有旁路的钉子。
    expect(vcssIds('.a\n{\n\tflow-children: down-wrap;\n}', stubIndex())).toEqual([]);
    // 对称的另一侧：center 在方位关键字词表里、不在 flow-children 自己的
    // 取值表里（["none","down","right","left","up",…] 没有 center），因此
    // 只有 GLOBAL_VALUE_KEYWORDS 能保住它。两行合起来，无论砍掉哪一侧的
    // 排除，这条测试都必然变红——单靠 right 时两侧互为旁路，砍任一侧都恒绿
    // （Task 4 评审 I-1 实测）。
    expect(vcssIds('.a\n{\n\tflow-children: center;\n}', stubIndex())).toEqual([]);
  });

  it('只被全局关键字词表保护的真实语料写法不报（GLOBAL_VALUE_KEYWORDS 这一层的唯一钉子）', () => {
    // 这两条取值在 data/vcss-properties.json 里对应属性的 values 都是空数组，
    // 也都不是 CSS 具名颜色，因此四层排除里只有 GLOBAL_VALUE_KEYWORDS 拦得住
    // 它们——删掉那张词表，本条立刻变红。
    //
    // 取值来自两个构建 990 个文件的真实语料（Task 4 评审把词表删掉后打出的
    // 100 条误报，按 (属性, 取值) 归并）：
    // - wash-color: none        40 处   → 全局值关键字子词表
    // - background-position: center  36 处 → 方位关键字子词表
    // 两条分别覆盖 GLOBAL_VALUE_KEYWORDS 的两个子词表。
    expect(vcssIds('.a\n{\n\twash-color: none;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\tbackground-position: center;\n}', stubIndex())).toEqual([]);
  });

  it('属性不在注册表里时，不对它的取值下 warning 级的「未定义常量」结论', () => {
    // 属性名打错（colr）或属性尚未被 data/vcss-properties.json 收录时，
    // props.valuesOf() 返回空数组，「按属性查已知取值表」那一层排除随之失效，
    // 取值就会拿到一条 warning。但我们对属性本身都不确定（Task 5 的
    // vcss.unknownProperty 只会给 hint），却对它的取值给了更高的级别，与规格
    // §10「分级看数据源可靠性」相悖。语料实测零命中，纯属防御。
    //
    // Task 5 之后这一行的结果从 [] 变成 ['vcss.unknownProperty']：本条守卫
    // 要挡的 vcss.unknownDefine 依旧不出现（这才是本测试的判据），多出来的
    // 那条是新接入的 §10.2 hint —— 它正是这条守卫注释里预告的那条规则，
    // 「属性没见过」这一个根因只由它报，只有一条。
    expect(vcssIds('.a\n{\n\tcolr: totallyUndefinedConst;\n}', stubIndex())).toEqual([
      'vcss.unknownProperty',
    ]);
    // 对照：属性认识时，同样的取值照报不误——这行保证上面的守卫不是把整条
    // 规则关掉了。
    expect(vcssIds('.a\n{\n\tcolor: totallyUndefinedConst;\n}', stubIndex())).toEqual([
      'vcss.unknownDefine',
    ]);
  });

  it('属性的合法关键字取值不报（从 data/vcss-properties.json 抽真实样本）', () => {
    expect(vcssIds('.a\n{\n\toverflow: squish;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\ttext-overflow: ellipsis;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\tvisibility: collapse;\n}', stubIndex())).toEqual([]);
  });

  it('CSS 具名颜色不报——color / background-color 的合法取值天然包含整个具名颜色词表', () => {
    expect(vcssIds('.a\n{\n\tcolor: white;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\tbackground-color: crimson;\n}', stubIndex())).toEqual([]);
  });

  it('font-family 的任意字体名不报——取值域本质开放，不存在可穷举的已知取值', () => {
    expect(vcssIds('.a\n{\n\tfont-family: Verdana;\n}', stubIndex())).toEqual([]);
  });

  it('“行为模式选择器”属性的未登记关键字不报——不是常量引用，是 vcss.unknownValue 的职责', () => {
    // 本条钉的是「这个位置不产出 vcss.unknownDefine」——font-style 在
    // KEYWORD_ONLY_PROPERTIES 里，它的裸标识符取值从来不是 @define 引用。
    //
    // 取值原本用的是 font-weight: lighter，Ruling 14 把 lighter 收进了人工表，
    // 它不再是「未登记关键字」，测不出这条分工了。换成 font-style: italics
    // ——同样是语料里真实存在的写法（两构建 14 处），且经 Ruling 14 复核后
    // 明确判定为 Valve 笔误、不进人工表，是这条测试稳定的落点。
    expect(vcssIds('.a\n{\n\tfont-style: italics;\n}', stubIndex())).toEqual([
      'vcss.unknownValue',
    ]);
  });

  it('animation-name 的取值不参与 unknownDefine——由 unknownKeyframes 单独处理', () => {
    expect(vcssIds('.a\n{\n\tanimation-name: totallyUndefinedAnim;\n}', stubIndex())).toEqual([
      'vcss.unknownKeyframes',
    ]);
  });

  it('§10.1 的值级 warning 已占用的取值区间不再叠加 unknownDefine（评审 I-2 / Ruling 15）', () => {
    // visibility / position 的 values 里都没有这些 Web 关键字，两者也都不在
    // KEYWORD_ONLY_PROPERTIES 里，于是 isDefineReferenceCandidate 对它们返回
    // true，unknownDefine 会在**同一个取值区间**上再挂一条 warning，文案是
    // 「hidden 不是工作区中已定义的 @define 常量」——对规格 §10.1 亲自点名的
    // 标准 Web 写法说这句话是假阳性，而 §10.1 的定位是「能证明是错的」。
    //
    // 这两处是用户从 Web 习惯直接带过来最常写的两个违规，语料里各 0 处，
    // 闸门抓不到，只能靠单元测试钉住。
    expect(vcssIds('.a\n{\n\tvisibility: hidden;\n}', stubIndex())).toEqual([
      'vcss.visibilityHidden',
    ]);
    expect(vcssIds('.a\n{\n\tposition: absolute;\n}', stubIndex())).toEqual([
      'vcss.positionKeyword',
    ]);
    // 对照：同属性的合法写法与「取值区间没有被 §10.1 占用」的写法照旧
    expect(vcssIds('.a\n{\n\tvisibility: collapse;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\tcolor: totallyUndefinedConst;\n}', stubIndex())).toEqual([
      'vcss.unknownDefine',
    ]);
  });

  it('无索引时一条都不产出——「找不到定义」在没有索引时不成立', () => {
    expect(vcssIds('.a\n{\n\tcolor: totallyUndefinedConst;\n}')).toEqual([]);
  });
});

describe('diagnoseVcss · vcss.unknownKeyframes（跨文件）', () => {
  it("animation-name: 'nope' 引用不存在的 keyframes → 报", () => {
    expect(vcssIds(".a\n{\n\tanimation-name: 'nope';\n}", stubIndex())).toEqual([
      'vcss.unknownKeyframes',
    ]);
  });

  it('引用存在的 keyframes → 不报（跨文件：定义在 A、引用在 B）', () => {
    const bText = ".a\n{\n\tanimation-name: 'fade';\n}";
    const index = buildIndex({
      [A]: "@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}",
      [B]: bText,
    });
    expect(vcssIds(bText, index, B)).toEqual([]);
  });

  it('animation-name: none 不报——none 是合法关键字，不是关键帧引用', () => {
    expect(vcssIds('.a\n{\n\tanimation-name: none;\n}', stubIndex())).toEqual([]);
    // 大小写不敏感：同一函数域里其余词表比对全部走 toLowerCase()（见
    // isDefineReferenceCandidate 里 horizontal-align: Left 那条注释——大写
    // 变体是语料上实测踩到过的），none 这条不能是唯一的精确相等。
    expect(vcssIds('.a\n{\n\tanimation-name: None;\n}', stubIndex())).toEqual([]);
    expect(vcssIds('.a\n{\n\tanimation-name: NONE;\n}', stubIndex())).toEqual([]);
  });

  it('逗号分隔的多个动画名，每个独立判定', () => {
    const index = buildIndex({ [A]: "@keyframes 'known'\n{\n\tfrom { opacity: 0; }\n}" });
    expect(vcssIds('.a\n{\n\tanimation-name: known, missing;\n}', index)).toEqual([
      'vcss.unknownKeyframes',
    ]);
  });

  it('诊断区间精确覆盖关键帧名字本身（不含引号），级别为 warning', () => {
    // 名字刻意含空格：`'nope'` 这类裸标识符形状的名字测不出「带引号」这条
    // 分支——裸标识符分支会在引号内部匹配到同一个名字、m.index 天然跳过开
    // 引号，算出的区间与带引号分支逐字节相同，于是把 ANIMATION_NAME_TOKEN_RE
    // 换成只剩裸标识符一支时本条依旧全绿（Task 4 评审 I-2 实测）。
    // `my anim` 裸标识符分支解释不了：它会拆成 my 与 anim 两条诊断，第一条
    // 的区间也只覆盖 my。
    const text = ".a\n{\n\tanimation-name: 'my anim';\n}";
    const diags = diagnoseVcss(parseVcss(text), { uri: A, props, index: stubIndex(), msg: ZH });
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('my anim');
    expect(diags[0].severity).toBe('warning');
  });

  it('带引号的非裸标识符关键帧名能跨文件解析 → 不报（带引号分支的正向钉子）', () => {
    // 与上一条互为正反：上一条钉住「带引号取值算出的区间」，这一条钉住
    // 「带引号取值取出的名字被原样拿去查索引」。裸标识符分支会把 'my anim'
    // 拆成 my + anim，两个都查不到定义，于是变成 2 条诊断而不是 0 条。
    const bText = ".a\n{\n\tanimation-name: 'my anim';\n}";
    const index = buildIndex({
      [A]: "@keyframes 'my anim'\n{\n\tfrom { opacity: 0; }\n}",
      [B]: bText,
    });
    expect(vcssIds(bText, index, B)).toEqual([]);
  });

  it('无索引时一条都不产出', () => {
    expect(vcssIds(".a\n{\n\tanimation-name: 'nope';\n}")).toEqual([]);
  });
});

describe('diagnoseVxml · vxml.unknownClass（跨文件）', () => {
  it('跨文件正向：类名定义在样式表、class= 引用它 → 不报', () => {
    const index = buildIndex({ [A]: '.shared-btn\n{\n\twidth: 1px;\n}' });
    expect(vxmlIds('<root><Panel class="shared-btn" /></root>', index)).toEqual([]);
  });

  it('class 在索引里找不到定义 → 报（跨文件反向）', () => {
    const index = buildIndex({ [A]: '.other\n{\n\twidth: 1px;\n}' });
    expect(vxmlIds('<root><Panel class="totallyUndefinedClass" /></root>', index)).toEqual([
      'vxml.unknownClass',
    ]);
  });

  it('多个类名混合已定义/未定义，只报未定义的那个，区间精确覆盖，级别为 hint', () => {
    const index = buildIndex({ [A]: '.known\n{\n\twidth: 1px;\n}' });
    const text = '<root><Panel class="known missing" /></root>';
    const diags = diagnoseVxml(parseVxml(text), { uri: LAYOUT, mode: 'full', panels, observed, index, msg: ZH });
    expect(diags).toHaveLength(1);
    expect(text.slice(diags[0].start, diags[0].end)).toBe('missing');
    expect(diags[0].severity).toBe('hint');
  });

  it('无索引时一条都不产出', () => {
    expect(vxmlIds('<root><Panel class="totallyUndefinedClass" /></root>')).toEqual([]);
  });
});

describe('诊断 · 无索引时跨文件规则整体跳过，单文件规则不受影响', () => {
  it('VCSS：跨文件两条一起消失，单文件的 9 条 warning 照常触发', () => {
    const text = ".a\n{\n\tdisplay: flex;\n\tcolor: totallyUndefinedConst;\n\tanimation-name: 'nope';\n}";
    expect(vcssIds(text)).toEqual(['vcss.webOnlyProperty']);
  });

  it('VXML：无索引时 unknownClass 消失，单文件的标签/属性两条照常触发', () => {
    // Task 7 之前 VXML 侧只有 unknownClass 一条规则，这里断言的是「返回空数组」。
    // 现在 vxml.unknownTag / vxml.unknownAttribute 是不依赖索引的单文件规则，
    // 断言相应改成与上面 VCSS 那条同一形状：跨文件的那条消失、单文件的照常。
    // 两个面板套在一层 <Panel> 里（Task 8 之后）：并排挂在 <root> 下就是两个
    // 根面板，会正确地触发一条 vxml.structure，与本用例要测的「有没有索引」无关。
    expect(vxmlIds('<root><Panel><NopePanel /><Label class="a b c" bogusattr="x" /></Panel></root>')).toEqual([
      'vxml.unknownTag',
      'vxml.unknownAttribute',
    ]);
  });
});
