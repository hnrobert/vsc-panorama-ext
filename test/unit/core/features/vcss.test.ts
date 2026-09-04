import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { ObservedValues } from '../../../../src/core/data/observed-values';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { contextAt, hoverTargetAt } from '../../../../src/core/vcss/context';
import { completeVcss, hoverVcss, symbolsVcss } from '../../../../src/core/features/vcss';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { symbolsOfVcss, symbolsOfVxml } from '../../../../src/core/index/symbols';
import { parseVxml } from '../../../../src/core/vxml/parser';

const props = PropertyRegistry.load('zh-cn');
const observed = ObservedValues.load();
const panels = PanelRegistry.load('zh-cn');

function at(marked: string) {
  const offset = marked.indexOf('|');
  const doc = parseVcss(marked.replace('|', ''));
  return { doc, offset };
}
const complete = (marked: string) => {
  const { doc, offset } = at(marked);
  return completeVcss(contextAt(doc, offset), doc, props, observed, panels, ZH);
};
const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('completeVcss · 属性名', () => {
  it('补全属性名', () => {
    expect(labels(complete('.x\n{\n\tflow-|\n}'))).toContain('flow-children');
  });

  it('Panorama 专属属性排在标准属性前面', () => {
    const items = complete('.x\n{\n\t|\n}');
    const wash = items.find((i) => i.label === 'wash-color')!;
    const margin = items.find((i) => i.label === 'margin')!;
    expect(wash.sortText! < margin.sortText!).toBe(true);
  });
});

describe('completeVcss · 属性值', () => {
  it('人工整理的取值进入候选', () => {
    expect(labels(complete('.x\n{\n\tflow-children: |\n}'))).toContain('down-wrap-left');
  });

  it('挖掘来的取值排序权重低于人工整理的取值', () => {
    // flow-children 的全部 7 个观测值都是 curated 10 个值的子集，会被 seen 去重滤掉，
    // 永远产生不出带「语料」标记的候选——换用 background-color：curated 只有 2 个
    // （none / transparent），observed 的 14 个里有 12 个不在 curated 内，必然有挖掘值。
    const items = complete('.x\n{\n\tbackground-color: |\n}');
    const curated = items.find((i) => i.label === 'none')!;
    const mined = items.find((i) => i.detail?.includes('语料'));
    expect(mined, '夹具属性必须存在纯挖掘值，否则本用例失去意义').toBeDefined();
    expect(curated.sortText! < mined!.sortText!).toBe(true);
  });

  it('取值补全三档排序完整成立：人工整理 < 同文件符号 < 语料挖掘', () => {
    const items = complete('@define myColor: #123456;\n.x\n{\n\tbackground-color: |\n}');
    const curated = items.find((i) => i.label === 'none')!;
    const defineSymbol = items.find((i) => i.label === 'myColor')!;
    const mined = items.find((i) => i.detail?.includes('语料'));
    expect(curated, 'curated 候选缺失').toBeDefined();
    expect(defineSymbol, '同文件 @define 候选缺失').toBeDefined();
    expect(mined, '夹具属性必须存在纯挖掘值，否则本用例失去意义').toBeDefined();
    expect(curated.sortText! < defineSymbol.sortText!).toBe(true);
    expect(defineSymbol.sortText! < mined!.sortText!).toBe(true);
  });

  it('同文件内的 @define 名字可作为取值补全', () => {
    const l = labels(complete('@define blueColor: #3281AC;\n.x\n{\n\tbackground-color: |\n}'));
    expect(l).toContain('blueColor');
  });

  it('animation-name 补全同文件的 @keyframes 名，插入的是不带引号的名字', () => {
    // `@keyframes` **声明**要引号（`@keyframes 'fade' { }`）是 Panorama 的
    // 真实怪癖；但 `animation-name` **引用**不要——Valve 两个构建 516 处
    // animation-name 声明零例外全部不带引号（Ruling 11 的实测依据）。
    // 两者一度被混为一谈，这条测试当初还把带引号的错误行为钉死着。
    //
    // 引号还顺带制造第二个问题：label 以 `'` 开头时，用户敲 `fa` 触发补全，
    // VSCode 的前缀过滤匹配不上 `'fade'`，候选被整个过滤掉——与 M3 最终评审
    // 抓出的两个 Critical 同一个根因家族（wordPattern 与 label 不一致）。
    const l = labels(
      complete("@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}\n.x\n{\n\tanimation-name: |\n}"),
    );
    // labels 是 string[]，toContain 在数组上是**元素严格相等**而不是子串包含：
    // 候选是 `'fade'`（带引号）时下面这行就不成立，因此这一行本身就有区分力。
    expect(l).toContain('fade');
    // 再显式钉住反面，免得将来有人改回带引号后只看到「多了一个候选」。
    expect(l).not.toContain("'fade'");
  });

  it('animation-name 补全其它样式表的 @keyframes 名，插入的同样不带引号', () => {
    // 跨文件那条分支（features/vcss.ts 的 cross 块）此前没有任何测试覆盖，
    // 引号缺陷在两条分支上是一样的，这里一并钉住。
    const other = '/p/panorama/styles/other.css';
    const self = '/p/panorama/styles/self.css';
    const index = new WorkspaceIndex({ exists: (p) => p === other || p === self });
    index.update(
      symbolsOfVcss(other, parseVcss("@keyframes 'crossFade'\n{\n\tfrom { opacity: 0; }\n}")),
    );
    const { doc, offset } = at('.x\n{\n\tanimation-name: |\n}');
    const l = labels(
      completeVcss(contextAt(doc, offset), doc, props, observed, panels, ZH, { index, uri: self }),
    );
    expect(l).toContain('crossFade');
    expect(l).not.toContain("'crossFade'");
  });
});

describe('completeVcss · 选择器与 at-rule', () => {
  it('裸标识符位置补全面板类型名', () => {
    expect(labels(complete('CSCol|'))).toContain('CSColorPicker');
  });

  it('冒号后补全伪类', () => {
    expect(labels(complete('.btn:|'))).toContain(':hover');
  });

  it('伪类候选项的 insertText 是完整带冒号的 label，接受后是 .btn:hover 而不是 .btn::hover（Finding 7 → Task 9 起改用显式区间）', () => {
    // Finding 7 时期没有显式替换区间，只能去掉 insertText 里的前导冒号来
    // 避免和用户已敲的冒号重复。Task 9 起 completeVcss 显式给出
    // replaceStart/replaceEnd（从触发补全的那个冒号开始），区间本身就会把
    // 那个冒号纳入替换范围，所以 insertText 换回完整的 label（':hover'）。
    // 两者是配套的一次改动，见下面「替换区间与 insertText 自洽」那条测试。
    const items = complete('.btn:|');
    const item = items.find((i) => i.label === ':hover')!;
    expect(item).toBeDefined();
    expect(item.insertText).toBe(':hover');
  });

  it('@ 后补全三种 at-rule', () => {
    const l = labels(complete('@|'));
    expect(l.sort()).toEqual(['@define', '@import', '@keyframes']);
  });
});

describe('completeVcss · 伪类的替换区间（Task 9：改用显式 Range 锚定）', () => {
  it('伪类候选显式给出替换区间，从冒号起', () => {
    const text = '.btn:hov';
    const doc = parseVcss(text);
    const items = completeVcss(contextAt(doc, text.length), doc, props, observed, panels, ZH);
    const hover = items.find((i) => i.label === ':hover')!;
    expect(text.slice(hover.replaceStart!, hover.replaceEnd!)).toBe(':hov');
  });

  // 上面那条只验证「区间切出来的原文是 :hov」，验证不了「区间和 insertText
  // 是否配套」——如果有人把 insertText 改回 Finding 7 时期的
  // label.replace(/^:+/, '') 但保留了新加的区间，上面的断言仍然全绿（它压根
  // 不看 insertText），可实际接受补全后会把用户敲的冒号弄丢，变成
  // '.btn hover' 而不是 '.btn:hover'。这条断言把区间真的用来做一次替换，
  // 拼上 insertText，钉住两者的组合结果，而不是分别检查两个孤立的值。
  // tamper check（task-9-report.md 记录了真实的 RED 报错文本）：把
  // src/core/features/vcss.ts 的 insertText 改回
  // label.replace(/^:+/, '')、保留 replaceStart/replaceEnd 不动——这条会红；
  // 改回 insertText: label——变绿。
  it('替换区间与 insertText 自洽：按区间替换后必须得到合法的 .btn:hover', () => {
    const text = '.btn:hov';
    const doc = parseVcss(text);
    const items = completeVcss(contextAt(doc, text.length), doc, props, observed, panels, ZH);
    const hover = items.find((i) => i.label === ':hover')!;
    const insertText = hover.insertText ?? hover.label;
    const after = text.slice(0, hover.replaceStart!) + insertText + text.slice(hover.replaceEnd!);
    expect(after).toBe('.btn:hover');
  });
});

describe('completeVcss · 冒号后跟空白不再触发伪类补全（Task 9 Fix round 1 的原始复现场景）', () => {
  // 评审最初就是拿这个输入复现的：.btn: 后跟一个空格、光标停在末尾。此前只有
  // context.test.ts 钉死了 prefixStart 的数值、外加「vcss.ts 的伪类触发条件
  // 没有改」这条静态推导，从没有一条测试真正跑过 completeVcss(contextAt(...), ZH, ZH, ZH, ZH, ZH)
  // 这条完整链路来验证复现场景本身已经修好。这里补上。
  //
  // tamper check（真实报错文本见 task-10-report.md）：把
  // src/core/vcss/context.ts 里 selector 分支的 trimStart() 改回 trim()——
  // 这条会红，产出一整批 :xxx 伪类候选；改回 trimStart()——变绿。
  it('.btn: （冒号后一个空格，光标在末尾）不产出伪类候选', () => {
    expect(complete('.btn: |')).toEqual([]);
  });
});

describe('completeVcss / hoverVcss · 原型链键安全（Finding 3）', () => {
  // PropertyRegistry.valuesOf 与 ObservedValues.valuesOf 直接用 [] 索引不存在
  // 的属性名时，会顺着原型链拿到 Object.prototype 上的同名成员——那些是函数
  // 或 Object.prototype 本身，不是字符串数组，for...of 它们会抛
  // "is not a function or its return value is not iterable"；PropertyRegistry.get
  // 同理会让 hoverVcss 在 info.values.join(...) 处抛异常。
  const POISONED_PROPS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

  for (const prop of POISONED_PROPS) {
    it(`属性名为 ${prop} 时取值补全不抛异常`, () => {
      expect(() => complete(`.x\n{\n\t${prop}: |\n}`)).not.toThrow();
      expect(complete(`.x\n{\n\t${prop}: |\n}`)).toEqual([]);
    });

    it(`悬停在 ${prop} 属性名上不抛异常，且视为未收录属性`, () => {
      const { doc, offset } = at(`.x { ${prop.slice(0, 1)}|${prop.slice(1)}: 1; }`);
      const target = hoverTargetAt(doc, offset);
      expect(target).toMatchObject({ kind: 'property', name: prop });
      expect(() => hoverVcss(target, doc, props, ZH)).not.toThrow();
      expect(hoverVcss(target, doc, props, ZH)).toBeUndefined();
    });
  }
});

describe('hoverVcss', () => {
  it('属性显示说明', () => {
    const { doc, offset } = at('.x { flow-chi|ldren: right; }');
    const info = hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)!;
    expect(info.title).toBe('flow-children');
    expect(info.body).toContain('排列');
  });

  it('Panorama 专属属性带 Web 差异提示', () => {
    const { doc, offset } = at('.x { flow-chi|ldren: right; }');
    const info = hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)!;
    expect(info.body).toContain('flex');
  });

  it('box-shadow 提醒颜色在前', () => {
    const { doc, offset } = at('.x { box-sh|adow: #000 1px 1px 2px 0px; }');
    const info = hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)!;
    expect(info.body).toContain('颜色在前');
  });

  it('@define 引用显示其实际值', () => {
    const { doc, offset } = at('@define blueColor: #3281AC;\n.x { color: blue|Color; }');
    const info = hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)!;
    expect(info.body).toContain('#3281AC');
  });

  it('函数显示签名', () => {
    const { doc, offset } = at('.x { width: fill-parent|-flow(1); }');
    const info = hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)!;
    expect(info.body).toContain('fill-parent-flow(权重)');
  });

  it('未收录的属性不返回悬停信息', () => {
    const { doc, offset } = at('.x { totally-unk|nown: 1; }');
    expect(hoverVcss(hoverTargetAt(doc, offset), doc, props, ZH)).toBeUndefined();
  });
});

describe('symbolsVcss', () => {
  it('大纲含规则、@define 与 @keyframes', () => {
    const doc = parseVcss("@define c: #fff;\n@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}\n.row\n{\n\twidth: 1px;\n}");
    const syms = symbolsVcss(doc, ZH);
    expect(syms.map((s) => s.kind)).toEqual(['define', 'keyframes', 'rule']);
    expect(syms.map((s) => s.name)).toEqual(['c', 'fade', '.row']);
  });

  // 三个都是真实的「编辑中途」输入，且都已用 parseVcss 单独验证过确实会产出
  // 空名字的条目。真实 VSCode 的 DocumentSymbol 拒绝空 name，一旦传进去
  // provideDocumentSymbols 会直接抛异常、拖垮整份大纲和面包屑（Finding 2）。
  it('没写名字的 @keyframes 不出现在大纲里', () => {
    const doc = parseVcss('@keyframes\n{\n\tfrom { opacity: 0; }\n}');
    expect(doc.keyframes[0].name).toBe(''); // 确认夹具真的会产出空名字
    expect(symbolsVcss(doc, ZH).some((s) => s.name === '')).toBe(false);
  });

  it('@define 漏了名字（@define : #fff;）不出现在大纲里', () => {
    const doc = parseVcss('@define : #fff;');
    expect(symbolsVcss(doc, ZH).some((s) => s.name === '')).toBe(false);
  });

  it('没有选择器的裸 { 不出现在大纲里', () => {
    const doc = parseVcss('{\n\twidth: 1px;\n}');
    expect(doc.rules[0].selector).toBe(''); // 确认夹具真的会产出空选择器
    expect(symbolsVcss(doc, ZH).some((s) => s.name === '')).toBe(false);
  });
});

describe('completeVcss · 跨文件', () => {
  const STYLE = '/p/panorama/styles/a.css';
  const OTHER = '/p/panorama/styles/b.css';
  const LAYOUT = '/p/panorama/layout/a.xml';

  function cross() {
    const files = new Set([STYLE, OTHER, LAYOUT, '/p/panorama/layout', '/p/panorama/styles']);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    index.update(symbolsOfVcss(OTHER, parseVcss('@define sharedBlue: #333;\n.shared-btn\n{\n\ta: b;\n}')));
    index.update(symbolsOfVxml(LAYOUT, parseVxml('<root><Panel id="RootPanel" /></root>')));
    return { index, uri: STYLE };
  }

  const completeAt = (marked: string) => {
    const offset = marked.indexOf('|');
    const text = marked.replace('|', '');
    const doc = parseVcss(text);
    return completeVcss(contextAt(doc, offset), doc, props, observed, panels, ZH, cross());
  };

  it('. 后补出工作区里其它文件定义的类名', () => {
    expect(completeAt('.shared|').map((i) => i.label)).toContain('.shared-btn');
  });

  it('# 后补出 VXML 里定义的 id', () => {
    expect(completeAt('#Root|').map((i) => i.label)).toContain('#RootPanel');
  });

  // 最终评审 Critical 1：这两支此前不给显式区间，替换范围退回 wordPattern
  // 推导——而 VCSS 的 wordPattern 把前导 '.' / '#' 算进当前词（'.shared'），
  // 裸名 label（'shared-btn'）与它模糊匹配恒失败，候选在真实编辑器里被整批
  // 滤掉，用户敲完 '.' 之后什么都看不到。下面三条把区间、label、insertText
  // 三者的配套关系钉死：区间要盖住含前导 sigil 的整段 token，label 与
  // insertText 要带回那个 sigil，且替换后必须是合法选择器。
  //
  // 这里用 replaceStart/replaceEnd 手工合成「接受之后的文本」下断言——这正是
  // 真实编辑器做的事；真走 triggerSuggest + acceptSelectedSuggestion 的那条
  // 在 test/e2e/suite/extension.test.ts。
  const applyFirst = (marked: string, label: string) => {
    const offset = marked.indexOf('|');
    const text = marked.replace('|', '');
    const doc = parseVcss(text);
    const item = completeVcss(contextAt(doc, offset), doc, props, observed, panels, ZH, cross()).find(
      (i) => i.label === label,
    );
    expect(item, `候选里没有 ${label}`).toBeDefined();
    expect(item!.replaceStart, `${label} 缺显式 replaceStart`).toBeTypeOf('number');
    expect(item!.replaceEnd, `${label} 缺显式 replaceEnd`).toBeTypeOf('number');
    return text.slice(0, item!.replaceStart) + item!.insertText + text.slice(item!.replaceEnd);
  };

  it('. 类名候选的区间覆盖含前导点的整段 token，接受后是合法选择器', () => {
    expect(applyFirst('.shared|\n{\n\ta: b;\n}', '.shared-btn')).toBe(
      '.shared-btn\n{\n\ta: b;\n}',
    );
  });

  it('# id 候选同理，接受后不会丢掉那个井号', () => {
    expect(applyFirst('#Root|\n{\n\ta: b;\n}', '#RootPanel')).toBe('#RootPanel\n{\n\ta: b;\n}');
  });

  it('只敲了一个点（还没输入任何字符）时，区间只覆盖那个点', () => {
    expect(applyFirst('.|', '.shared-btn')).toBe('.shared-btn');
  });

  it('后代组合子里只替换光标所在的那一段，前面的选择器原样保留', () => {
    // 区间起点取的是 prefix 里最后一个 sigil——'.a ' 这一段不能被吃掉。
    expect(applyFirst('.a .shared|', '.shared-btn')).toBe('.a .shared-btn');
  });

  // Task 9 Fix round 1：评审要求核实 prefixStart 公式改成只削前导空白
  // （trimStart）之后，同样读 ctx.prefix 的 . / # 跨文件分支是否还正确。
  // 这两支现在也消费 prefixStart 了（Critical 1 起给出显式区间），上面四条
  // 直接钉死了区间数值；下面两条继续守触发门槛（正则是否匹配 ctx.prefix）。
  it('后代组合子 .a .shared 中，光标紧跟类名时仍正确补出类名（内部空白不受影响）', () => {
    // '.a .shared' 中间那个空格是选择器内部的组合子，不在 prefix 末尾，
    // 无论 trim 还是 trimStart 都不会动它——这条确认组合子场景本身没有
    // 被这次修复连带破坏。
    expect(completeAt('.a .shared|').map((i) => i.label)).toContain('.shared-btn');
  });

  it('类名后面多打了一个空格（光标停在空格后）：不应该再补出类名候选', () => {
    // 光标已经越过 .shared 这个 token、停在它后面的空格之后——这个位置本就
    // 不该把 "shared" 当成还在输入中的类名前缀去补全。
    //
    // 这是 Fix round 1 之前就存在、但被同一个 bug 掩盖的次生问题：旧公式用
    // sel.trim() 计算 prefix，会把这里的尾随空格一起削掉，prefix 变回
    // '.a .shared'，/\.[\w-]*$/ 依然误判成"正在输入 shared"而错误触发补全。
    // 换成 trimStart 后 prefix 保留尾随空格（'.a .shared '），正则不再匹配，
    // 门槛自然收紧到位——不需要另外改 vcss.ts 的判断逻辑。
    expect(completeAt('.a .shared |')).toEqual([]);
  });

  it('id 同理：# 后的类型的尾随空白也不应该再触发补全', () => {
    expect(completeAt('#Root |')).toEqual([]);
  });

  it('取值位置补出其它文件的 @define 名', () => {
    expect(completeAt('.x\n{\n\tcolor: |\n}').map((i) => i.label)).toContain('sharedBlue');
  });

  it('同文件的 @define 排在其它文件的前面', () => {
    // brief 原版夹具用 localBlue/sharedBlue：字母序 l < s 恰好与期望排序重合，
    // 无论排序前缀算对、恒为本地、恒为跨文件、还是干脆不带前缀，断言都恒真
    // （本项目已因同型问题在 Task 5 返工一轮）。这里把本地常量改名为
    // zLocalBlue——字母序排在 sharedBlue 之后——使「本地优先」的排序前缀
    // 成为下面第一条断言成立的唯一原因；见 task-6-report.md 的 tamper check。
    const marked = '@define zLocalBlue: #111;\n.x\n{\n\tcolor: |\n}';
    const offset = marked.indexOf('|');
    const text = marked.replace('|', '');
    const doc = parseVcss(text);
    const items = completeVcss(contextAt(doc, offset), doc, props, observed, panels, ZH, cross());
    const local = items.find((i) => i.label === 'zLocalBlue')!;
    const shared = items.find((i) => i.label === 'sharedBlue')!;
    expect(local, 'zLocalBlue 候选项缺失').toBeDefined();
    expect(shared, 'sharedBlue 候选项缺失').toBeDefined();
    expect(local.sortText! < shared.sortText!).toBe(true);
    // detail 的正负两条：本地项必须明确标注「来自当前文件」，跨文件项不能带
    // 这个字样——只查正面会漏掉「两项 detail 被搞反」这类 bug（认错对象等于没查）。
    expect(local.detail).toContain('当前文件');
    expect(shared.detail).not.toContain('当前文件');
  });

  it('没有索引时行为与 M2 一致，不抛异常', () => {
    const text = '.shared';
    const doc = parseVcss(text);
    expect(() =>
      completeVcss(contextAt(doc, text.length), doc, props, observed, panels, ZH),
    ).not.toThrow();
  });
});
