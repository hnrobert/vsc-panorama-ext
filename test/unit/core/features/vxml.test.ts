import { describe, it, expect } from 'vitest';
import { ZH } from '../../../helpers/i18n';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { contextAt, hoverTargetAt } from '../../../../src/core/vxml/context';
import { completeVxml, hoverVxml, symbolsVxml } from '../../../../src/core/features/vxml';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { symbolsOfVcss, symbolsOfVxml } from '../../../../src/core/index/symbols';
import { parseVcss } from '../../../../src/core/vcss/parser';

const panels = PanelRegistry.load('zh-cn');

function at(marked: string) {
  const offset = marked.indexOf('|');
  const doc = parseVxml(marked.replace('|', ''));
  return { doc, offset };
}
const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('completeVxml · 完整语言模式', () => {
  it('嵌套位置给 202 种可作子元素的类型，不含仅根类型', () => {
    const { doc, offset } = at('<root><Panel><|</Panel></root>');
    const items = completeVxml(contextAt(doc, offset), 'full', panels, ZH);
    const l = labels(items);
    expect(l).toContain('Label');
    expect(l).not.toContain('PopupCustomLayout'); // rootOnly
  });

  it('根面板位置给全部 245 种，含仅根类型与结构元素', () => {
    const { doc, offset } = at('<root><|</root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).toContain('Panel');
    expect(l).toContain('PopupCustomLayout');
    expect(l).toContain('styles');
  });

  it('属性补全含继承来的属性，并剔除已写过的', () => {
    const { doc, offset } = at('<root><Panel><Label class="a" |/></Panel></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).toContain('text'); // from Label
    expect(l).toContain('id'); // from Panel，继承
    expect(l).not.toContain('class'); // 已写过
  });

  it('根面板的属性候选里没有 id', () => {
    const { doc, offset } = at('<root><Panel |></Panel></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).not.toContain('id');
    expect(l).toContain('class');
  });

  it('属性值内输入 { 时提示四种数据绑定前缀', () => {
    const { doc, offset } = at('<root><Label text="{|" /></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).toEqual(expect.arrayContaining(['{s:}', '{d:}', '{g:}', '{t:}']));
  });

  it('{ 出现在光标之后、光标之前没有 { 时不触发绑定提示（必须按光标位置判断，不能整串找 {）', () => {
    const { doc, offset } = at('<root><Label text="a|{" /></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).toEqual([]);
  });

  it('{ 前面还有其他文字时，光标紧跟在 { 之后仍触发绑定提示', () => {
    const { doc, offset } = at('<root><Label text="Score: {|" /></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH));
    expect(l).toEqual(expect.arrayContaining(['{s:}', '{d:}', '{g:}', '{t:}']));
  });

  it('{s:} 候选项的 insertText 是完整的 {s:}，不是切掉花括号后的 s:（Finding 1）', () => {
    // wordPattern（[a-zA-Z0-9_\-{}:#.]+）把 '{' 算进单词字符，没有显式 range 时
    // VSCode 会把用户刚敲的那个 '{' 一起纳入替换范围。insertText 必须是完整的
    // '{s:}'，否则要么把 { 吃掉变成 's:'，要么变成重复的 '{{s:}'。
    const { doc, offset } = at('<root><Label text="{|" /></root>');
    const items = completeVxml(contextAt(doc, offset), 'full', panels, ZH);
    const item = items.find((i) => i.label === '{s:}')!;
    expect(item).toBeDefined();
    expect(item.insertText ?? item.label).toBe('{s:}');
  });

  it('<root> 之外（文档为空）只提示 root，不与 245 种面板混在一起（Finding 5）', () => {
    // root 不在 panels.json 里（它不是一种"面板"），falls into allPanels()
    // 分支的话完全不会出现在候选列表里。
    const { doc, offset } = at('<|');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'tagName', slot: 'outside' });
    expect(labels(completeVxml(contextAt(doc, offset), 'full', panels, ZH))).toEqual(['root']);
  });

  it('CustomHudLayout 严格模式下，<root> 之外同样只提示 root（Finding 5）', () => {
    const { doc, offset } = at('<|');
    expect(labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH))).toEqual([
      'root',
    ]);
  });
});

describe('completeVxml · 原型链键安全（Finding 3）', () => {
  // PanelRegistry.attributesOf 直接用 [] 索引不存在的面板名时，会顺着原型链
  // 拿到 Object.prototype 上的同名成员——那些是函数，不是 PanelInfo，
  // for...of 它们的 .sets 会抛 "info.sets is not iterable"（完整模式）；
  // CUSTOM_HUD_WHITELIST[tag] 同理会拿到函数，.filter 会抛
  // "all.filter is not a function"（严格模式）。
  const POISONED_TAGS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

  for (const tag of POISONED_TAGS) {
    it(`标签名为 ${tag} 时属性补全不抛异常（完整模式）`, () => {
      const { doc, offset } = at(`<root><Panel><${tag} |/></Panel></root>`);
      const ctx = contextAt(doc, offset);
      expect(ctx).toMatchObject({ kind: 'attributeName', tag });
      expect(() => completeVxml(ctx, 'full', panels, ZH)).not.toThrow();
      expect(completeVxml(ctx, 'full', panels, ZH)).toEqual([]);
    });

    it(`标签名为 ${tag} 时属性补全不抛异常（严格模式）`, () => {
      const { doc, offset } = at(`<root><Panel><${tag} |/></Panel></root>`);
      const ctx = contextAt(doc, offset);
      expect(() => completeVxml(ctx, 'customHudLayout', panels, ZH)).not.toThrow();
      expect(completeVxml(ctx, 'customHudLayout', panels, ZH)).toEqual([]);
    });
  }
});

describe('completeVxml · CustomHudLayout 严格模式', () => {
  it('标签候选收窄到四种面板', () => {
    const { doc, offset } = at('<root><Panel><|</Panel></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH));
    expect(l.filter((x) => /^[A-Z]/.test(x)).sort()).toEqual(['Button', 'Image', 'Label', 'Panel']);
  });

  it('结构元素只剩 styles，scripts 与 snippets 不进候选', () => {
    const { doc, offset } = at('<root><|</root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH));
    expect(l).toContain('styles');
    expect(l).not.toContain('scripts');
    expect(l).not.toContain('snippets');
  });

  it('Button 的属性候选不含 text——文字要用子 Label', () => {
    const { doc, offset } = at('<root><Panel><Button |/></Panel></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH));
    expect(l).not.toContain('text');
    expect(l.sort()).toEqual(['class', 'id']);
  });

  it('style 与 on* 事件属性不进候选', () => {
    const { doc, offset } = at('<root><Panel><Label |/></Panel></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH));
    expect(l).not.toContain('style');
    expect(l.filter((x) => x.startsWith('on'))).toEqual([]);
  });

  it('数据绑定只提示 {s:}', () => {
    const { doc, offset } = at('<root><Label text="{|" /></root>');
    const l = labels(completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH));
    expect(l).toEqual(['{s:}']);
  });
});

describe('completeVxml · 绑定补全的替换区间（Task 9：改用显式 Range 锚定）', () => {
  it('绑定候选显式给出替换区间，覆盖用户刚敲的那个 {', () => {
    const text = '<root><Label text="{" /></root>';
    const doc = parseVxml(text);
    const brace = text.indexOf('{');
    const items = completeVxml(contextAt(doc, brace + 1), 'customHudLayout', panels, ZH);
    const item = items[0];
    expect(item.replaceStart).toBe(brace);
    expect(item.replaceEnd).toBe(brace + 1);
  });

  it('词字符紧贴 { 时替换区间仍只覆盖 { 本身', () => {
    const text = '<root><Label text="Score:{" /></root>';
    const doc = parseVxml(text);
    const brace = text.indexOf('{');
    const items = completeVxml(contextAt(doc, brace + 1), 'customHudLayout', panels, ZH);
    // 若靠 wordPattern 推导，Score: 会被一起吞掉；显式区间不会
    expect(items[0].replaceStart).toBe(brace);
    expect(items[0].replaceEnd).toBe(brace + 1);

    // 光靠上面两条数值断言测不出「区间对了、但插入文本和区间不配套」这类
    // 错误（vcss.ts 的伪类分支就真的犯过这个错——见 vcss.test.ts 的同型
    // 断言与 task-9-report.md 的 tamper check）。这里补一条自洽性检查：
    // 把区间实际替换掉、拼上 insertText，必须得到合法的完整属性值，而不是
    // 丢了 Score: 或者插出重复的花括号。
    expect(text.slice(items[0].replaceStart!, items[0].replaceEnd!)).toBe('{');
    const rebuilt =
      text.slice(0, items[0].replaceStart!) +
      (items[0].insertText ?? items[0].label) +
      text.slice(items[0].replaceEnd!);
    expect(rebuilt).toBe('<root><Label text="Score:{s:}" /></root>');
  });
});

describe('hoverVxml', () => {
  it('面板类型显示继承链', () => {
    const { doc, offset } = at('<root><La|bel /></root>');
    const info = hoverVxml(hoverTargetAt(doc, offset), 'full', panels, ZH)!;
    expect(info.title).toContain('Label');
    expect(info.body).toContain('Panel'); // derived from
  });

  it('属性显示其声明者', () => {
    const { doc, offset } = at('<root><Label te|xt="x" /></root>');
    const info = hoverVxml(hoverTargetAt(doc, offset), 'full', panels, ZH)!;
    expect(info.body).toContain('Label');
  });

  // panels 用的是 zh-cn 注册表（见文件顶部），所以这里断言中文对照。
  // 英文那一侧由 test/unit/core/data/panels-i18n.test.ts 覆盖。
  it('带 XSD 描述的属性把描述带上', () => {
    const { doc, offset } = at('<root><Image texture|width="24" /></root>');
    const info = hoverVxml(hoverTargetAt(doc, offset), 'full', panels, ZH)!;
    expect(info.body).toContain('覆盖矢量图形的尺寸');
  });

  it('严格模式下标注该面板是否在白名单内', () => {
    const { doc, offset } = at('<root><Sli|der /></root>');
    const info = hoverVxml(hoverTargetAt(doc, offset), 'customHudLayout', panels, ZH)!;
    expect(info.body).toContain('白名单');
  });

  it('未知标签不返回悬停信息', () => {
    const { doc, offset } = at('<root><NotA|Panel /></root>');
    expect(hoverVxml(hoverTargetAt(doc, offset), 'full', panels, ZH)).toBeUndefined();
  });
});

describe('symbolsVxml', () => {
  it('产出面板树，节点标注 id 或首个 class', () => {
    const doc = parseVxml(
      '<root><Panel class="hud-root"><Label id="Score" /></Panel></root>',
    );
    const syms = symbolsVxml(doc);
    expect(syms[0].name).toBe('root');
    const panel = syms[0].children[0];
    expect(panel.name).toBe('Panel');
    expect(panel.detail).toBe('.hud-root');
    expect(panel.children[0].detail).toBe('#Score');
  });

  it('id 与 class 同时出现时，detail 取 #id 而非 .class（防止优先级被反过来实现）', () => {
    const doc = parseVxml(
      '<root><Panel class="hud-root"><Panel id="Root2" class="hud-root" /></Panel></root>',
    );
    const syms = symbolsVxml(doc);
    const inner = syms[0].children[0].children[0];
    expect(inner.name).toBe('Panel');
    expect(inner.detail).toBe('#Root2');
  });
});

describe('completeVxml · class 跨文件补全', () => {
  const LAYOUT = '/p/panorama/layout/a.xml';
  const INCLUDED = '/p/panorama/styles/inc.css';
  const OTHER = '/p/panorama/styles/other.css';

  function crossFile(layoutText: string) {
    const files = new Set([LAYOUT, INCLUDED, OTHER, '/p/panorama/layout', '/p/panorama/styles']);
    const index = new WorkspaceIndex({
      exists: (p) => files.has(p.replace(/\\/g, '/')),
    });
    // 类名字母序刻意与 include 状态相反（zeta > alpha）：若排序不是真的按
    // isIncluded 前缀来的、而是退化成按名字本身排序，这里会直接翻车——用
    // inc-a / other-a 时 'i' < 'o' 与期望顺序巧合重合，isIncluded 恒真、恒假、
    // 乃至 sortText 完全不加前缀都能让断言蒙混过关（评审 Important 发现，
    // 详见 task-5-report.md「Fix round 1」）。
    index.update(symbolsOfVcss(INCLUDED, parseVcss('.zeta-x\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVcss(OTHER, parseVcss('.alpha-x\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVxml(LAYOUT, parseVxml(layoutText)));
    return { index, uri: LAYOUT };
  }

  const withInclude =
    '<root><styles><include src="s2r://panorama/styles/inc.vcss_c" /></styles>' +
    '<Panel class="|" /></root>';

  it('class= 里补出索引中的类名', () => {
    const text = withInclude.replace('|', '');
    const doc = parseVxml(text);
    const offset = text.indexOf('class="') + 'class="'.length;
    const items = completeVxml(contextAt(doc, offset), 'full', panels, ZH, crossFile(text));
    const labels = items.map((i) => i.label);
    expect(labels).toContain('zeta-x');
    expect(labels).toContain('alpha-x');
  });

  it('已 include 的样式表里的类名排在前面', () => {
    const text = withInclude.replace('|', '');
    const doc = parseVxml(text);
    const offset = text.indexOf('class="') + 'class="'.length;
    const items = completeVxml(contextAt(doc, offset), 'full', panels, ZH, crossFile(text));
    const included = items.find((i) => i.label === 'zeta-x')!;
    const other = items.find((i) => i.label === 'alpha-x')!;
    // zeta-x 在字母序上本就排在 alpha-x 之后——这条断言只有在 sortText 真的
    // 按 isIncluded 加了前缀（'1'/'2'）时才会成立，不会被名字本身的字母序
    // 蒙混过关。
    expect(included.sortText! < other.sortText!).toBe(true);
    expect(included.detail).toContain('已引入');
    // 反向断言：未被 include 的那个类名不能也被标成「已引入」——否则
    // isIncluded 恒为 true 这种坏实现，光靠上面那条正向断言测不出来。
    expect(other.detail).not.toContain('已引入');
  });

  it('class="a b" 中只补当前那一段，不重复已写过的', () => {
    const text = '<root><Panel class="inc-a " /></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('inc-a ') + 'inc-a '.length;
    const files = new Set([LAYOUT, INCLUDED, '/p/panorama/layout', '/p/panorama/styles']);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    index.update(symbolsOfVcss(INCLUDED, parseVcss('.inc-a\n{\n\ta: b;\n}\n.inc-b\n{\n\ta: b;\n}')));
    const items = completeVxml(contextAt(doc, offset), 'full', panels, ZH, { index, uri: LAYOUT });
    const labels = items.map((i) => i.label);
    expect(labels).toContain('inc-b');
    expect(labels).not.toContain('inc-a');
  });

  it('没有索引时（cross 未传）class= 不再报错，只是给不出候选', () => {
    const text = '<root><Panel class="" /></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('class="') + 'class="'.length;
    expect(() => completeVxml(contextAt(doc, offset), 'full', panels, ZH)).not.toThrow();
  });

  it('严格模式下 class 补全同样可用 —— 白名单不限制样式', () => {
    const text = withInclude.replace('|', '');
    const doc = parseVxml(text);
    const offset = text.indexOf('class="') + 'class="'.length;
    const items = completeVxml(contextAt(doc, offset), 'customHudLayout', panels, ZH, crossFile(text));
    expect(items.map((i) => i.label)).toContain('zeta-x');
  });
});

describe('completeVxml · 结构元素去重（规格 §9.1）', () => {
  it('已出现过的 styles 不再进候选', () => {
    const text = '<root><styles /><|</root>'.replace('|', '');
    const doc = parseVxml(text);
    const offset = text.lastIndexOf('<') + 1;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH).map((i) => i.label);
    expect(labels).not.toContain('styles');
    expect(labels).toContain('scripts');
  });

  // 复审顾虑 4：去重不能按名字整体排除，必须排除掉光标当前正在输入的那个
  // 元素自身——容错解析器会把还没打完/没闭合的标签也当成真实子元素提前放进
  // container.children，一旦它的标签名凑巧完整拼出某个结构元素名（这里是敲完
  // "<styles" 的那一刻，STRUCTURAL 按精确匹配收，敲到一半的 "sty" 不会命中，
  // 只有敲完整个词才会），旧实现会把它当成"已存在的兄弟"，将其从自己的候选
  // 里滤掉——越接近敲对，越补不出来。用户能直接撞上，不是理论边界。
  //
  // 夹具里同时放一个已经完整闭合、且不是光标所在的 <snippets></snippets>，
  // 一次性验证两条不能顾此失彼的性质：自排除生效的同时，去重本身不能失效。
  it('光标正在输入的结构元素本身不因去重被滤掉——即使它已完整拼出结构元素名', () => {
    const { doc, offset } = at('<root><snippets></snippets> <styles|');
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH).map((i) => i.label);
    expect(labels).toContain('styles');
  });

  it('去重本身仍然生效：不是光标所在的那个已存在的结构元素仍被滤掉', () => {
    const { doc, offset } = at('<root><snippets></snippets> <styles|');
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH).map((i) => i.label);
    expect(labels).not.toContain('snippets');
  });
});

describe('completeVxml · snippet= 同文件补全', () => {
  it('snippet 属性值补出同文件定义的片段名', () => {
    const text =
      '<root><snippets><snippet name="Row"><Panel /></snippet></snippets>' +
      '<Panel><Frame snippet="" /></Panel></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('snippet="') + 'snippet="'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH).map((i) => i.label);
    expect(labels).toEqual(['Row']);
  });
});

describe('completeVxml · src= 与枚举属性', () => {
  const LAYOUT2 = '/p/panorama/layout/a.xml';
  const STYLE2 = '/p/panorama/styles/hud/main.css';

  function crossWithFiles() {
    const files = new Set([LAYOUT2, STYLE2, '/p/panorama/layout', '/p/panorama/styles']);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    index.update(symbolsOfVcss(STYLE2, parseVcss('.a\n{\n\twidth: 1px;\n}')));
    return { index, uri: LAYOUT2 };
  }

  // 最终评审 Critical 2：src= 此前产出整条 s2r 路径且不给显式区间，而 VXML 的
  // wordPattern 不含斜杠——光标停在 src="s2r://panorama/sty| 时当前词只有
  // 'sty'，接受后得到 src="s2r://panorama/s2r://panorama/styles/..."。改成
  // 规格 §9.1 说的逐段补全：只产出光标所在的那一段，区间只覆盖那一段。
  //
  // 下面这组用 replaceStart/replaceEnd 手工合成「接受之后的文本」下断言，
  // 这正是真实编辑器做的事；真走 triggerSuggest + acceptSelectedSuggestion
  // 的那条在 test/e2e/suite/extension.test.ts。
  function completeSrc(typed: string, cross: ReturnType<typeof crossWithFiles>) {
    const text = `<root><styles><include src="${typed}" /></styles><Panel /></root>`;
    const doc = parseVxml(text);
    const offset = text.indexOf('src="') + 'src="'.length + typed.length;
    return { text, items: completeVxml(contextAt(doc, offset), 'full', panels, ZH, cross) };
  }

  function accept(text: string, item: { replaceStart?: number; replaceEnd?: number; insertText?: string }) {
    expect(item.replaceStart, '候选缺显式 replaceStart').toBeTypeOf('number');
    expect(item.replaceEnd, '候选缺显式 replaceEnd').toBeTypeOf('number');
    return text.slice(0, item.replaceStart) + item.insertText + text.slice(item.replaceEnd);
  }

  it('空值处给出的第一段是固定头部 + 首个目录段（头部不会被切成半截协议头）', () => {
    const { items } = completeSrc('', crossWithFiles());
    // 's2r:/' 这种把 '//' 切成空段的结果是明确不接受的
    expect(items.map((i) => i.label)).toEqual(['s2r://panorama/styles/']);
  });

  it('光标停在路径中段时，区间只覆盖当前段——不会把已输入的路径前缀再插一遍', () => {
    const { text, items } = completeSrc('s2r://panorama/sty', crossWithFiles());
    expect(items.map((i) => i.label)).toEqual(['styles/']);
    const after = accept(text, items[0]);
    expect(after).toContain('src="s2r://panorama/styles/"');
    expect(after).not.toContain('s2r://panorama/s2r://panorama/');
  });

  it('输入到最后一段时给出文件名本身，接受后拼出完整的 s2r 编译路径', () => {
    const { text, items } = completeSrc('s2r://panorama/styles/hud/', crossWithFiles());
    expect(items.map((i) => i.label)).toEqual(['main.vcss_c']);
    expect(accept(text, items[0])).toContain('src="s2r://panorama/styles/hud/main.vcss_c"');
  });

  it('目录段带 retriggerSuggest，文件段不带——接受目录后要立刻补下一段', () => {
    expect(completeSrc('s2r://panorama/styles/', crossWithFiles()).items[0]).toMatchObject({
      label: 'hud/',
      retriggerSuggest: true,
    });
    expect(completeSrc('s2r://panorama/styles/hud/', crossWithFiles()).items[0]).toMatchObject({
      label: 'main.vcss_c',
      retriggerSuggest: false,
    });
  });

  it('committed 前缀与索引里任何文件都对不上时，不产出候选', () => {
    expect(completeSrc('s2r://panorama/nope/', crossWithFiles()).items).toEqual([]);
  });

  it('scaling 属性给出固定枚举值', () => {
    const text = '<root><Panel><Image scaling="" /></Panel></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('scaling="') + 'scaling="'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH).map((i) => i.label);
    expect(labels).toContain('stretch-to-fit-preserve-aspect');
    expect(labels).toContain('none');
  });

  it('hittest 给出布尔取值', () => {
    const text = '<root><Panel hittest="" /></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('hittest="') + 'hittest="'.length;
    expect(
      completeVxml(contextAt(doc, offset), 'full', panels, ZH)
        .map((i) => i.label)
        .sort(),
    ).toEqual(['false', 'true']);
  });
});

// task-11-brief.md Step 4 给的参考实现只按 ctx.attribute === 'src' 触发，不看
// ctx.tag，也不按文件类型过滤候选——会把布局路径塞进 <include src> 的候选、把
// 样式表路径塞进 <Frame src> 的候选，还会把两者一起塞进范围之外的 <Image src>
// （brief 自己的注释写着「覆盖 include 与 Frame」「Image 不在范围内」，代码却
// 没真的挡住，注释与代码对不上）。brief 给的三条测试都只单独注册一个文件，测不出
// 这些问题——这一组把索引里同时放布局与样式表两种文件，实际压出上面这些缝隙。
// Image 用真实存在、真的声明了 src 属性的面板（见 data/panels.json 的 Image
// 属性集），不是编出来的反例。
describe('completeVxml · src= 的范围与类型限定（brief 参考实现未覆盖，本任务补强）', () => {
  const LAYOUT2 = '/p/panorama/layout/a.xml';
  const STYLE2 = '/p/panorama/styles/hud/main.css';

  function crossWithBoth() {
    const files = new Set([LAYOUT2, STYLE2, '/p/panorama/layout', '/p/panorama/styles']);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    index.update(symbolsOfVcss(STYLE2, parseVcss('.a\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVxml(LAYOUT2, parseVxml('<root><Panel /></root>')));
    return { index, uri: LAYOUT2 };
  }

  // 逐段补全之后，「布局 / 样式表混不混」这件事在第一段就能分辨：把光标停在
  // 固定头部之后，候选段直接是 layout/ 还是 styles/。判据没有被削弱，只是提前
  // 了一段——原来的整条路径断言换成同等信息量的目录段断言。
  it('Frame 的 src= 补出索引里的布局文件，且不混入样式表候选', () => {
    const text = '<root><Panel><Frame src="s2r://panorama/" /></Panel></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('src="') + 'src="'.length + 's2r://panorama/'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH, crossWithBoth()).map(
      (i) => i.label,
    );
    expect(labels).toContain('layout/');
    expect(labels).not.toContain('styles/');
  });

  it('include 只给样式表候选，即使索引里同时有布局文件', () => {
    const text = '<root><styles><include src="s2r://panorama/" /></styles><Panel /></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('src="') + 'src="'.length + 's2r://panorama/'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH, crossWithBoth()).map(
      (i) => i.label,
    );
    expect(labels).toContain('styles/');
    expect(labels).not.toContain('layout/');
  });

  it('Image 的 src= 不在本任务范围内（指向 images/，索引不覆盖）——即使标签真的声明了 src 也不产出候选', () => {
    const text = '<root><Panel><Image src="" /></Panel></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('src="') + 'src="'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH, crossWithBoth()).map(
      (i) => i.label,
    );
    expect(labels).toEqual([]);
  });

  it('每个文件按自己的路径算 s2r 根，不会被另一个文件更短的根抢先匹配（两棵嵌套的 panorama 内容树）', () => {
    // OUTER 的根 /w/panorama 恰好是 INNER 完整路径的字符串前缀——如果实现是
    // 「先收集全部文件各自算出的根，凑成一个共享候选池，再对每个文件挨个
    // startsWith 试」，且候选顺序恰好先试到 OUTER 这个更短的根，INNER 就会被
    // 错误地拼出一条多带了 vendor/widget/panorama/ 的过长路径——OUTER 注册在
    // 前，allFiles() 的遍历顺序=注册顺序，共享候选池实现下 OUTER 的根确实会
    // 先被试到。必须让每个文件只认自己路径里第一个 layout/ 或 styles/ 段，
    // 不经共享候选池，才能不管另一棵树长什么样都答对。
    const OUTER_STYLE = '/w/panorama/styles/outer.css';
    const INNER_LAYOUT = '/w/panorama/vendor/widget/panorama/layout/inner.xml';
    const files = new Set([
      OUTER_STYLE,
      INNER_LAYOUT,
      '/w/panorama/layout',
      '/w/panorama/styles',
      '/w/panorama/vendor/widget/panorama/layout',
      '/w/panorama/vendor/widget/panorama/styles',
    ]);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    index.update(symbolsOfVcss(OUTER_STYLE, parseVcss('.a\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVxml(INNER_LAYOUT, parseVxml('<root><Panel /></root>')));

    // 逐段之后判据同样提前一段就能分辨：算错根的实现会把 INNER 拼成
    // s2r://panorama/vendor/widget/panorama/layout/inner.vxml_c，头部之后的
    // 第一段是 'vendor/' 而不是 'layout/'。
    const text = '<root><Panel><Frame src="s2r://panorama/" /></Panel></root>';
    const doc = parseVxml(text);
    const offset = text.indexOf('src="') + 'src="'.length + 's2r://panorama/'.length;
    const labels = completeVxml(contextAt(doc, offset), 'full', panels, ZH, {
      index,
      uri: INNER_LAYOUT,
    }).map((i) => i.label);
    expect(labels).toContain('layout/');
    expect(labels).not.toContain('vendor/');
  });
});
