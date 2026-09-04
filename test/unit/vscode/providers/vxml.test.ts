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
import { registerVxml } from '../../../../src/vscode/providers/vxml';
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

function at(marked: string, fsPath = 'w/panorama/20260829/panorama/layout/hud/hud.xml') {
  const offset = marked.indexOf('|');
  const document = createDocument(marked.replace('|', ''), fsPath);
  return { document, position: document.positionAt(offset) };
}

function provider<T>(type: string): T {
  const found = registered.find((r) => r.language === 'panorama-vxml' && r.type === type);
  if (!found) throw new Error(`未找到已注册的 ${type} provider`);
  return found.provider as T;
}

const POISONED_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

// 此前 test/mocks/vscode.ts 的 register* 只记录 {type, language}、丢弃 provider 本体，
// 导致适配层的实际行为从未被测试触达（Finding 4）。以下用例直接调用注册好的
// provideXxx 回调，端到端验证 core 层的修复真的经由适配层落到了返回值上。
describe('registerVxml · 适配层 provider 行为（Finding 4）', () => {
  beforeEach(() => {
    resetRegistrations();
    __workspaceFiles.clear();
    registerVxml({ subscriptions: [] } as never, new WorkspaceIndex({ exists: () => false }));
  });

  it('{s:} 补全项接受后得到完整的 {s:}，不会吃掉用户刚敲的 {（回归 Finding 1）', () => {
    const completion = provider<CompletionProviderLike>('completion');
    const { document, position } = at('<root><Label text="{|" /></root>');

    const items = completion.provideCompletionItems(document, position);
    const item = items.find((i) => i.label === '{s:}');

    expect(item, '{s:} 候选项缺失').toBeDefined();
    // insertText 显式等于 label，或者干脆不设置由 label 兜底，两种修法都算对；
    // 唯独不能是切片后的 's:'（会吞掉用户已经敲下的左花括号）。
    expect(item!.insertText ?? item!.label).toBe('{s:}');
  });

  // Task 9：core 层的 replaceStart/replaceEnd 只是两个数字，真正防止「词字符
  // 紧贴 { 时吞掉前面字符」这个 bug 复发的是 toItem() 把它们转成 vscode.Range
  // 挂到补全项上——core 层测试测不出「toItem 拿到这两个字段却没转换」这类
  // 失效，必须走真实注册的 provider 回调才能验证。这里刻意用
  // text="Score:{ 这个此前会出问题的场景（brief 标题场景本身），而不是简单
  // 的 text="{。
  it('{s:} 补全项经真实 provider 回调落地，range 只覆盖用户刚敲的那个 {，不含前面的 Score:（Task 9，适配层回归）', () => {
    const completion = provider<CompletionProviderLike>('completion');
    const marked = '<root><Label text="Score:{|" /></root>';
    const { document, position } = at(marked);

    const items = completion.provideCompletionItems(document, position);
    const item = items.find((i) => i.label === '{s:}');
    expect(item, '{s:} 候选项缺失').toBeDefined();

    const braceOffset = marked.replace('|', '').indexOf('{');
    expect(item!.range).toEqual(
      new Range(document.positionAt(braceOffset), document.positionAt(braceOffset + 1)),
    );
  });

  it('custom_game 路径下标签补全只有四种白名单面板，非 custom_game 路径下远不止四种', () => {
    const completion = provider<CompletionProviderLike>('completion');

    const strict = at(
      '<root><Panel><|</Panel></root>',
      'game/csgo/panorama/layout/custom_game/hud/main.xml',
    );
    const strictLabels = completion
      .provideCompletionItems(strict.document, strict.position)
      .map((i) => i.label)
      .filter((l) => /^[A-Z]/.test(l));
    expect(strictLabels.sort()).toEqual(['Button', 'Image', 'Label', 'Panel']);

    const full = at(
      '<root><Panel><|</Panel></root>',
      'w/panorama/20260829/panorama/layout/hud/hud.xml',
    );
    const fullLabels = completion.provideCompletionItems(full.document, full.position);
    expect(fullLabels.length).toBeGreaterThan(strictLabels.length);
    expect(fullLabels.length).toBeGreaterThan(50);
  });

  for (const tag of POISONED_KEYS) {
    it(`标签名为 ${tag} 时补全与悬停都不抛异常（回归 Finding 3）`, () => {
      const completion = provider<CompletionProviderLike>('completion');
      const hover = provider<HoverProviderLike>('hover');
      const { document, position } = at(`<root><Panel><${tag} |/></Panel></root>`);

      expect(() => completion.provideCompletionItems(document, position)).not.toThrow();
      expect(() => hover.provideHover(document, position)).not.toThrow();
    });
  }

  it('文档符号 provider 接线正常，产出的面板树带有正确的名字', () => {
    const symbols = provider<SymbolProviderLike>('symbol');
    const { document } = at('<root><Panel id="p"><Label id="l"/></Panel></root>');

    const result = symbols.provideDocumentSymbols(document);
    expect(result.map((s) => s.name)).toEqual(['root']);
    expect(result[0].children.map((s) => s.name)).toEqual(['Panel']);
  });

  it('class= 的跨文件补全项到达真实编辑器时带 CompletionItemKind.Value（KIND 表漏项会让它静默丢图标）', () => {
    // beforeEach 注册的是空索引，这里换一个真的挖出了类名的索引重新注册，
    // 覆盖掉 beforeEach 的那次——用来验证跨文件补全项真的经由 toItem() 落到
    // vscode.CompletionItem 上，而不是只在 core 层的 CompletionItem.kind 字符串
    // 停留在 'value'，适配层 KIND 表却漏了映射、静默变成 undefined。
    const index = new WorkspaceIndex({ exists: () => false });
    index.update(
      symbolsOfVcss('/w/panorama/styles/hud.css', parseVcss('.foo-a\n{\n\twidth: 1px;\n}')),
    );
    resetRegistrations();
    registerVxml({ subscriptions: [] } as never, index);

    const completion = provider<CompletionProviderLike>('completion');
    const { document, position } = at('<root><Panel class="|" /></root>');

    const items = completion.provideCompletionItems(document, position);
    const item = items.find((i) => i.label === 'foo-a');

    expect(item, 'foo-a 候选项缺失').toBeDefined();
    expect(item!.kind).toBe(CompletionItemKind.Value);
  });

  // Task 7 复审发现的缺口（前两个任务的地盘，按「同型小改动合批」并到 Task 8）：
  // provideCompletionItems 里的 `document.uri.fsPath.replace(/\\/g, '/')` 是
  // 承重的——cross.uri 直接喂给 WorkspaceIndex.includedStylesheets(uri)，
  // 后者 this.files.get(uri) 之后再无任何归一化，而索引宿主一律用正斜杠
  // 键控。Windows 下 fsPath 给的是反斜杠，删掉这句会让 includedStylesheets
  // 静默查不到当前文件，isIncluded 恒为 false——用户看到的是「已引入的样式表」
  // 被误标成「工作区其它样式表」、排序也跟着错。
  it('class= 跨文件补全在当前文件 fsPath 带 Windows 反斜杠时，detail/sortText 依然正确反映「已引入」', () => {
    const LAYOUT_URI = 'E:/ws/panorama/layout/a.xml';
    const LAYOUT_WIN = 'E:\\ws\\panorama\\layout\\a.xml';
    const INCLUDED = 'E:/ws/panorama/styles/inc.css';
    const OTHER = 'E:/ws/panorama/styles/other.css';

    const files = new Set([
      LAYOUT_URI,
      INCLUDED,
      OTHER,
      'E:/ws/panorama/layout',
      'E:/ws/panorama/styles',
    ]);
    const index = new WorkspaceIndex({ exists: (p) => files.has(p.replace(/\\/g, '/')) });
    // 类名字母序刻意与 include 状态相反（zeta > alpha）：若排序不是真的按
    // isIncluded 前缀来的、而是恰好按字母序排的，这条用例测不出问题。
    const layout =
      '<root><styles><include src="s2r://panorama/styles/inc.vcss_c" /></styles>' +
      '<Panel class="" /></root>';
    index.update(symbolsOfVcss(INCLUDED, parseVcss('.zeta-x\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVcss(OTHER, parseVcss('.alpha-x\n{\n\twidth: 1px;\n}')));
    index.update(symbolsOfVxml(LAYOUT_URI, parseVxml(layout)));
    resetRegistrations();
    registerVxml({ subscriptions: [] } as never, index);

    const completion = provider<CompletionProviderLike>('completion');
    // document.uri.fsPath 是真反斜杠的 Windows 路径，索引里却按正斜杠键控
    // 同一个文件——这正是缺口描述的错配场景。
    const { document, position } = at(layout.replace('class=""', 'class="|"'), LAYOUT_WIN);

    const items = completion.provideCompletionItems(document, position);
    const included = items.find((i) => i.label === 'zeta-x');
    const other = items.find((i) => i.label === 'alpha-x');

    expect(included, 'zeta-x 候选项缺失').toBeDefined();
    expect(other, 'alpha-x 候选项缺失').toBeDefined();
    expect(included!.detail).toBe('已引入的样式表');
    expect(other!.detail).toBe('工作区其它样式表');
    expect(included!.sortText! < other!.sortText!).toBe(true);
  });

  // Task 7 的 definition/reference provider 注册进 registerVxml 之后，从未有测试
  // 走过真实的 provideDefinition/provideReferences 回调——core 层 navigation.ts
  // 有覆盖，但 s2rEnv()/locationOf() 这两个适配层辅助，以及 provider 里对
  // document.uri.fsPath 的路径分隔符归一化，完全没有断言触达过。以下三条补齐。
  it('class= 的跳转定义经真实 provider 回调落地，目标文件当前未打开也能算出正确的 Range（跨文件 + locationOf 的 openTextDocument 路径）', async () => {
    const STYLE_PATH = '/w/panorama/styles/hud.css';
    const style = '.foo-a\n{\n\twidth: 1px;\n}';
    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVcss(STYLE_PATH, parseVcss(style)));
    // 目标文件当前未打开——只喂给 __workspaceFiles，不经过 createDocument/at()，
    // 逼 locationOf 走 openTextDocument + positionAt 那条路径换算真实 Range，
    // 而不是退回 catch 分支里那个占位的 Position(0, 0)。
    __workspaceFiles.set(STYLE_PATH, style);
    resetRegistrations();
    registerVxml({ subscriptions: [] } as never, index);

    const definition = provider<DefinitionProviderLike>('definition');
    const { document, position } = at('<root><Panel class="foo-|a" /></root>');

    const locs = await definition.provideDefinition(document, position);

    expect(locs).toHaveLength(1);
    expect(locs[0].uri.fsPath).toBe(STYLE_PATH);
    const { start, end } = locs[0].rangeOrPosition;
    expect(style.slice(start.character, end.character)).toBe('foo-a');
  });

  it('include 的 s2r 跳转即使当前文件 fsPath 带 Windows 反斜杠也能定位到目标文件', async () => {
    const CURRENT_URI = 'C:/w/panorama/layout/hud.xml';
    const CURRENT_FSPATH_WIN = 'C:\\w\\panorama\\layout\\hud.xml';
    const STYLE_PATH = 'C:/w/panorama/styles/a.css';
    const style = '.btn\n{\n\twidth: 1px;\n}';
    const layout = '<root><styles><include src="s2r://panorama/styles/a.vcss_c" /></styles></root>';

    const index = new WorkspaceIndex({ exists: () => false });
    // 当前文件本身也真的要被索引过——production 里 index-host.ts 的全量扫描
    // 不会跳过正在编辑的文件；这同时也让 s2rEnv() 的前缀匹配认得 layout/
    // 目录确实存在（它是从 index.allFiles() 反推出来的，不是凭空判断）。
    index.update(symbolsOfVxml(CURRENT_URI, parseVxml(layout)));
    index.update(symbolsOfVcss(STYLE_PATH, parseVcss(style)));
    __workspaceFiles.set(STYLE_PATH, style);
    resetRegistrations();
    registerVxml({ subscriptions: [] } as never, index);

    const definition = provider<DefinitionProviderLike>('definition');
    const { document, position } = at(
      layout.replace('s2r://panorama', 's2r://pano|rama'),
      CURRENT_FSPATH_WIN,
    );

    const locs = await definition.provideDefinition(document, position);

    expect(locs).toHaveLength(1);
    expect(locs[0].uri.fsPath).toBe(STYLE_PATH);
  });

  it('查找引用经真实 provider 回调落地，跨文件的定义与同文件的其它使用点都带正确的 Range', async () => {
    const LAYOUT_URI = '/w/panorama/layout/hud.xml';
    const STYLE_PATH = '/w/panorama/styles/hud.css';
    const layout = '<root><Panel class="btn"><Label class="btn" /></Panel></root>';
    const style = '.btn\n{\n\twidth: 1px;\n}';

    const index = new WorkspaceIndex({ exists: () => false });
    index.update(symbolsOfVxml(LAYOUT_URI, parseVxml(layout)));
    index.update(symbolsOfVcss(STYLE_PATH, parseVcss(style)));
    __workspaceFiles.set(LAYOUT_URI, layout);
    __workspaceFiles.set(STYLE_PATH, style);
    resetRegistrations();
    registerVxml({ subscriptions: [] } as never, index);

    const references = provider<ReferenceProviderLike>('reference');
    const { document, position } = at(layout.replace('class="btn"', 'class="b|tn"'), LAYOUT_URI);

    const locs = await references.provideReferences(document, position);

    const styleLocs = locs.filter((l) => l.uri.fsPath === STYLE_PATH);
    const layoutLocs = locs.filter((l) => l.uri.fsPath === LAYOUT_URI);
    expect(styleLocs).toHaveLength(1);
    expect(layoutLocs).toHaveLength(2);
    // 跨文件那一条（VCSS 定义本身）目标文件当前未打开，走的正是 locationOf 的
    // openTextDocument + positionAt 路径——用文本切片验证算出来的 Range 真的
    // 落在 .btn 的名字上，不是巧合数值。
    const { start, end } = styleLocs[0].rangeOrPosition;
    expect(style.slice(start.character, end.character)).toBe('btn');
  });
});
