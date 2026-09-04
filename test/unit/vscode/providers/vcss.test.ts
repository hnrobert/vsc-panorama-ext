import { describe, it, expect, beforeEach } from 'vitest';
import {
  registered,
  resetRegistrations,
  createDocument,
  Position,
  Range,
  DocumentSymbol,
  CompletionItemKind,
  __workspaceFiles,
  type MockTextDocument,
} from '../../../mocks/vscode';
import { registerVcss } from '../../../../src/vscode/providers/vcss';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';

interface CompletionItemLike {
  readonly label: string;
  readonly insertText?: string;
  readonly kind?: number;
  readonly detail?: string;
  readonly sortText?: string;
  readonly range?: Range;
}

interface CompletionProviderLike {
  provideCompletionItems(document: MockTextDocument, position: Position): CompletionItemLike[];
}

interface HoverProviderLike {
  provideHover(
    document: MockTextDocument,
    position: Position,
  ): { contents: { value: string } } | undefined;
}

interface SymbolProviderLike {
  provideDocumentSymbols(document: MockTextDocument): DocumentSymbol[];
}

interface LocationLike {
  readonly uri: { readonly fsPath: string };
  readonly rangeOrPosition: { readonly start: Position; readonly end: Position };
}

interface DefinitionProviderLike {
  provideDefinition(document: MockTextDocument, position: Position): Promise<LocationLike[]>;
}

interface ReferenceProviderLike {
  provideReferences(document: MockTextDocument, position: Position): Promise<LocationLike[]>;
}

function at(marked: string, fsPath = '/game/csgo/panorama/styles/hud.vcss') {
  const offset = marked.indexOf('|');
  const document = createDocument(marked.replace('|', ''), fsPath);
  return { document, position: document.positionAt(offset) };
}

function provider<T>(type: string): T {
  const found = registered.find((r) => r.language === 'panorama-vcss' && r.type === type);
  if (!found) throw new Error(`未找到已注册的 ${type} provider`);
  return found.provider as T;
}

function flatten(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols.flatMap((s) => [s, ...flatten(s.children)]);
}

const POISONED_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

// 此前 test/mocks/vscode.ts 的 register* 只记录 {type, language}、丢弃 provider 本体，
// 导致适配层的实际行为从未被测试触达（Finding 4）。以下用例直接调用注册好的
// provideXxx 回调，端到端验证 core 层的修复真的经由适配层落到了返回值上。
describe('registerVcss · 适配层 provider 行为（Finding 4）', () => {
  beforeEach(() => {
    resetRegistrations();
    __workspaceFiles.clear();
    registerVcss({ subscriptions: [] } as never, new WorkspaceIndex({ exists: () => false }));
  });

  it('文档符号 provider 面对会产出空名字的输入不抛异常，也不产出空名字的符号（回归 Finding 2）', () => {
    const symbols = provider<SymbolProviderLike>('symbol');
    // 三个都是真实的「编辑中途」输入：光有 @keyframes 没名字、@define 漏了名字、
    // 裸的顶层 { 没有选择器。真实 VSCode 的 DocumentSymbol 拒绝空 name（见 mock），
    // 修复前这里会直接抛异常，整份大纲和面包屑跟着消失。
    const cases = [
      '@keyframes\n{\n\tfrom { opacity: 0; }\n}',
      '@define : #fff;',
      '{\n\twidth: 1px;\n}',
    ];

    for (const text of cases) {
      const document = createDocument(text);
      let result: DocumentSymbol[] = [];
      expect(() => {
        result = symbols.provideDocumentSymbols(document);
      }, text).not.toThrow();
      expect(flatten(result).some((s) => s.name === ''), text).toBe(false);
    }
  });

  it('伪类补全项接受后得到 .btn:hover，而不是 .btn::hover（回归 Finding 7，Task 9 起改用显式 range）', () => {
    // Finding 7 时期没有 range，靠去掉 insertText 的前导冒号避免重复；
    // Task 9 起 insertText 换回完整 label，改由显式 range 覆盖用户敲的冒号。
    // 这里不再分别孤立断言 insertText 和某个假设的区间，而是真的用适配层
    // 吐出来的 range 做一次替换，模拟真实编辑器接受补全时的效果——只有
    // range 与 insertText 真正配套，重建出的文本才会是 .btn:hover。
    const completion = provider<CompletionProviderLike>('completion');
    const marked = '.btn:|';
    const { document, position } = at(marked);

    const items = completion.provideCompletionItems(document, position);
    const item = items.find((i) => i.label === ':hover');

    expect(item, ':hover 候选项缺失').toBeDefined();
    expect(item!.range, '伪类候选项应带显式 range（Task 9）').toBeDefined();

    const text = marked.replace('|', '');
    const { start, end } = item!.range!;
    const after = text.slice(0, start.character) + item!.insertText + text.slice(end.character);
    expect(after).toBe('.btn:hover');
  });

  // Task 9：上面那条用的是「光秃秃的冒号」场景（.btn:），触发补全时还没有
  // 任何伪类前缀字符，区间恰好只有一个字符宽，不足以证明「已经敲了一部分
  // 伪类名」时区间会正确地把那部分也纳入替换范围——真编辑器里更常见的输入
  // 节奏是 .btn:hov 这种带部分前缀的样子。这条用精确的 range 数值钉住这个
  // 场景，和 core 层 vcss.test.ts 的同名断言（'替换区间与 insertText 自洽'）
  // 对称，只是这里额外验证适配层真的把 replaceStart/replaceEnd 转成了
  // vscode.Range，而不是止步于 core 层的两个数字。
  it('伪类补全项经真实 provider 回调落地，部分输入的伪类前缀（.btn:hov）也带正确的 range（Task 9，适配层回归）', () => {
    const completion = provider<CompletionProviderLike>('completion');
    const marked = '.btn:hov|';
    const { document, position } = at(marked);

    const items = completion.provideCompletionItems(document, position);
    const item = items.find((i) => i.label === ':hover');
    expect(item, ':hover 候选项缺失').toBeDefined();

    const text = marked.replace('|', '');
    const colonAt = text.indexOf(':');
    expect(item!.range).toEqual(
      new Range(document.positionAt(colonAt), document.positionAt(text.length)),
    );
    expect(item!.insertText).toBe(':hover');
  });

  for (const key of POISONED_KEYS) {
    it(`属性名为 ${key} 时取值补全不抛异常（回归 Finding 3）`, () => {
      const completion = provider<CompletionProviderLike>('completion');
      const { document, position } = at(`.x { ${key}: | }`);
      expect(() => completion.provideCompletionItems(document, position)).not.toThrow();
    });

    it(`悬停在 ${key} 属性名上不抛异常（回归 Finding 3）`, () => {
      const hover = provider<HoverProviderLike>('hover');
      const { document, position } = at(`.x { ${key.slice(0, 1)}|${key.slice(1)}: 1; }`);
      expect(() => hover.provideHover(document, position)).not.toThrow();
    });
  }

  // Task 6 只有 core 层的 completeVcss 有 brief 指定的测试；跨文件 cross 参数
  // 在适配层的接线（Step 4：构造 { index, uri } 并传给 completeVcss）本身完全
  // 没有断言覆盖。同型缺口在 Task 5 出过一次（vxml.ts 的 KIND 表漏项，评审后
  // 定为 standing rule：「适配层的映射与转换没有断言就等于没有覆盖」），这里
  // 依同一标准主动补上，而不是等下一轮评审再补。
  it('. 后的跨文件类名补全项经真实 provider 回调落地，带正确的 CompletionItemKind（cross 接线 + KIND 表的端到端回归）', () => {
    const index = new WorkspaceIndex({ exists: () => false });
    // 故意存进另一个 uri——hud.vcss（at() 的默认路径）自己从没被索引过，
    // 确保 'foo-a' 只能是通过 cross.index 跨文件查到的，不是巧合命中本文件。
    index.update(
      symbolsOfVcss(
        '/game/csgo/panorama/styles/other.css',
        parseVcss('.foo-a\n{\n\twidth: 1px;\n}'),
      ),
    );
    resetRegistrations();
    registerVcss({ subscriptions: [] } as never, index);

    const completion = provider<CompletionProviderLike>('completion');
    const { document, position } = at('.foo|');

    const items = completion.provideCompletionItems(document, position);
    // label 带前导点：最终评审 Critical 1 起，'.' 后的类名候选连同 sigil 一起
    // 给出，替换区间也覆盖那个点（否则 wordPattern 推导出的当前词含 '.'，
    // 裸名会被真实编辑器整批滤掉）。
    const item = items.find((i) => i.label === '.foo-a');

    expect(item, '.foo-a 候选项缺失——cross 没有真正传到 completeVcss').toBeDefined();
    expect(item!.kind).toBe(CompletionItemKind.Value);
    // 适配层必须把 core 给的 replaceStart/replaceEnd 换算成 Range 挂上去——
    // 漏掉这一步，编辑器就退回 wordPattern 推导，Critical 1 原样复发。
    expect(item!.range, '.foo-a 候选项没有显式 Range——toItem 没把区间落到候选上').toBeDefined();
  });

  // Task 7 复审发现的缺口（前两个任务的地盘，按「同型小改动合批」并到 Task 8）：
  // provideCompletionItems 里的 `document.uri.fsPath.replace(/\\/g, '/')` 是
  // 承重的。completeVcss 用 cross.uri 判断一个 @define 是否「就是当前文件
  // 自己」（`defs.every(d => d.uri === cross.uri)`，同文件的已在别处按本地
  // 符号处理，不该再混进「其它样式表的 @define」列表）——这个判断只有在
  // live buffer 里还没写、但索引里已经登记过当前文件本身的 @define 时才会
  // 真正被走到（防抖窗口内的正常状态，index-host.ts 的 300ms 防抖）。
  // Windows 下 fsPath 给的是反斜杠，删掉归一化会让这条自身归属判断恒假，
  // 「当前文件自己的旧索引条目」被误标成「其它样式表的 @define」冒出来。
  it('取值补全在当前文件 fsPath 带 Windows 反斜杠时，仍能把「当前文件自己」的索引条目与真正的跨文件 @define 区分开', () => {
    const CURRENT_URI = 'E:/ws/panorama/styles/a.vcss';
    const CURRENT_WIN = 'E:\\ws\\panorama\\styles\\a.vcss';
    const OTHER_URI = 'E:/ws/panorama/styles/other.vcss';

    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVcss(OTHER_URI, parseVcss('@define otherBlue: #222;')));
    // 索引里已经登记过当前文件自己的旧快照（例如全量扫描或上一次防抖落地），
    // 其中含一条 @define；但当前正在补全的 live buffer（下面 at() 传入的文本）
    // 还没有这条——不写进这次的 doc.defines，才能让「排除自身文件」这一步
    // 真正被执行到，而不是被更前面「同文件」那条分支的 seen 提前拦掉。
    index.update(symbolsOfVcss(CURRENT_URI, parseVcss('@define staleBlue: #333;')));
    resetRegistrations();
    registerVcss({ subscriptions: [] } as never, index);

    const completion = provider<CompletionProviderLike>('completion');
    const { document, position } = at('.x\n{\n\tcolor: |\n}', CURRENT_WIN);

    const items = completion.provideCompletionItems(document, position);

    const other = items.find((i) => i.label === 'otherBlue');
    expect(other, 'otherBlue 候选项缺失——真正的跨文件 @define 应该始终出现').toBeDefined();
    expect(other!.detail).toBe('其它样式表的 @define');
    expect(
      items.find((i) => i.label === 'staleBlue'),
      'staleBlue 是当前文件自己的旧索引条目，本该被排除，却被误标成了其它样式表的 @define',
    ).toBeUndefined();
  });

  // Task 7 的 definition/reference provider 注册进 registerVcss 之后，从未有测试
  // 走过真实的 provideDefinition/provideReferences 回调——core 层 navigation.ts
  // 有覆盖，但 s2rEnv()/locationOf() 这两个适配层辅助，以及 provider 里对
  // document.uri.fsPath 的路径分隔符归一化，完全没有断言触达过。以下三条补齐，
  // 与 vxml.test.ts 对称。
  it('#id 的跳转定义经真实 provider 回调落地，目标文件当前未打开也能算出正确的 Range', async () => {
    const LAYOUT_URI = '/w/panorama/layout/hud.xml';
    const layout = '<root><Panel id="RootPanel" /></root>';
    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVxml(LAYOUT_URI, parseVxml(layout)));
    // 目标文件（VXML）当前未打开——只喂给 __workspaceFiles，逼 locationOf 走
    // openTextDocument + positionAt 那条路径换算真实 Range。
    __workspaceFiles.set(LAYOUT_URI, layout);
    resetRegistrations();
    registerVcss({ subscriptions: [] } as never, index);

    const definition = provider<DefinitionProviderLike>('definition');
    const { document, position } = at('#Root|Panel\n{\n\twidth: 1px;\n}');

    const locs = await definition.provideDefinition(document, position);

    expect(locs).toHaveLength(1);
    expect(locs[0].uri.fsPath).toBe(LAYOUT_URI);
    const { start, end } = locs[0].rangeOrPosition;
    expect(layout.slice(start.character, end.character)).toBe('RootPanel');
  });

  it('查找引用经真实 provider 回调落地，从 VCSS 的类名定义查出跨文件的全部使用点', async () => {
    const LAYOUT_URI = '/w/panorama/layout/hud.xml';
    const STYLE_PATH = '/game/csgo/panorama/styles/hud.vcss'; // 与 at() 默认 fsPath 一致——当前正在编辑的这个文件
    const layout = '<root><Panel class="btn"><Label class="btn" /></Panel></root>';
    const style = '.btn\n{\n\twidth: 1px;\n}';

    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVxml(LAYOUT_URI, parseVxml(layout)));
    index.update(symbolsOfVcss(STYLE_PATH, parseVcss(style)));
    __workspaceFiles.set(LAYOUT_URI, layout);
    __workspaceFiles.set(STYLE_PATH, style);
    resetRegistrations();
    registerVcss({ subscriptions: [] } as never, index);

    const references = provider<ReferenceProviderLike>('reference');
    const { document, position } = at('.b|tn\n{\n\twidth: 1px;\n}');

    const locs = await references.provideReferences(document, position);

    const layoutLocs = locs.filter((l) => l.uri.fsPath === LAYOUT_URI);
    const styleLocs = locs.filter((l) => l.uri.fsPath === STYLE_PATH);
    expect(layoutLocs).toHaveLength(2);
    expect(styleLocs).toHaveLength(1);
    // 跨文件那两条（VXML 的使用点）目标文件当前未打开，走的正是 locationOf 的
    // openTextDocument + positionAt 路径——用文本切片验证算出来的 Range 真的
    // 落在 btn 的名字上，不是巧合数值。
    const { start, end } = layoutLocs[0].rangeOrPosition;
    expect(layout.slice(start.character, end.character)).toBe('btn');
  });

  it('@import 的 s2r 跳转即使当前文件 fsPath 带 Windows 反斜杠也能定位到目标文件', async () => {
    const CURRENT_URI = 'C:/w/panorama/styles/hud.vcss';
    const CURRENT_FSPATH_WIN = 'C:\\w\\panorama\\styles\\hud.vcss';
    const OTHER_STYLE_PATH = 'C:/w/panorama/styles/a.css';
    const otherStyle = '.btn\n{\n\twidth: 1px;\n}';
    const style = '@import url("s2r://panorama/styles/a.vcss_c");';

    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVcss(CURRENT_URI, parseVcss(style)));
    index.update(symbolsOfVcss(OTHER_STYLE_PATH, parseVcss(otherStyle)));
    // 撑起 s2rEnv() 前缀匹配需要的 layout/ 目录——它是从 index.allFiles() 反推的。
    index.update(symbolsOfVxml('C:/w/panorama/layout/dummy.xml', parseVxml('<root></root>')));
    __workspaceFiles.set(OTHER_STYLE_PATH, otherStyle);
    resetRegistrations();
    registerVcss({ subscriptions: [] } as never, index);

    const definition = provider<DefinitionProviderLike>('definition');
    const { document, position } = at(
      style.replace('s2r://panorama', 's2r://pano|rama'),
      CURRENT_FSPATH_WIN,
    );

    const locs = await definition.provideDefinition(document, position);

    expect(locs).toHaveLength(1);
    expect(locs[0].uri.fsPath).toBe(OTHER_STYLE_PATH);
  });
});
