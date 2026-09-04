import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DiagnosticSeverity,
  MockDiagnosticCollection,
  __config,
  __configChangeHandlers,
  __diagnosticCollections,
  __docChangeHandlers,
  __docCloseHandlers,
  __docOpenHandlers,
  __openDocuments,
  createOpenDocument,
  fireDocClose,
  fireDocEdit,
  fireDocOpen,
  fireConfigChange,
  type MockOpenDocument,
} from '../../mocks/vscode';
import {
  createDiagnosticsHost,
  readDiagnosticSettings,
} from '../../../src/vscode/diagnostics-host';
import { WorkspaceIndex } from '../../../src/core/index/workspace-index';
import { symbolsOfVcss } from '../../../src/core/index/symbols';
import { parseVcss } from '../../../src/core/vcss/parser';
import {
  ALLOWED_LEVELS,
  DEFAULT_DIAGNOSTIC_SETTINGS,
  SETTING_KEYS,
} from '../../../src/core/diagnostics/types';

/**
 * 换算用的定位夹具。挑这个位置不是随手挑的：`visibility: hidden` 的取值
 * 落在**绝对偏移 52 / 第 4 行 / 第 16 列**上——三个数两两不等，而且
 * （行, 列）=（4, 16）与互换后的（16, 4）也不相等。
 *
 * 为什么非要这样挑：core 层给的是绝对字符偏移，适配层要把它换成
 * vscode.Range。换算写错（把 start 当行号、把偏移当列号、行列写反）时
 * core 的那批测试**照样全绿**——它们只看偏移——而编辑器里的波浪线全画
 * 错地方。只有在三个数互不相等的位置上，错误的换算才必然被断出来；随手
 * 挑一个 offset 0（行 0 列 0）之类的位置，三种坏法全都能蒙混过关。
 */
const FIXTURE_VCSS = [
  '/* fixture */',
  '.a',
  '{',
  '    width: 100%;',
  '    visibility: hidden;',
  '}',
  '',
].join('\n');

const VCSS_PATH = '/w/panorama/styles/a.css';

function ctx() {
  return { subscriptions: [] as Array<{ dispose?: () => void }> };
}

function onlyCollection(): MockDiagnosticCollection {
  expect(__diagnosticCollections).toHaveLength(1);
  return __diagnosticCollections[0];
}

interface SeenDiagnostic {
  readonly code?: string;
  readonly severity?: number;
  readonly message: string;
  readonly range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function diagnosticsOf(doc: MockOpenDocument): readonly SeenDiagnostic[] {
  return (onlyCollection().get(doc.uri) ?? []) as readonly SeenDiagnostic[];
}

function codesOf(doc: MockOpenDocument): string {
  return diagnosticsOf(doc)
    .map((d) => d.code ?? '?')
    .join(',');
}

/**
 * 推进防抖窗口。**用的是假计时器，不是挂钟**（见下面 beforeEach 里的
 * vi.useFakeTimers）。
 *
 * 交付时这里是真 setTimeout：11 条用例各真睡 400ms 以上，最长一条 1207ms。
 * 它在空闲机器上稳，在 CPU 有并发负载时会**假红**——M4 收尾期间实测撞见过一次
 * 两条红、单独跑该文件 19 条全过、随后连跑四次又全绿。
 *
 * 成因与 T10 修掉的 E2E 盲等是**同一类**：拿挂钟时间当就绪判断。防抖窗口是
 * 300ms，睡 400ms 只留 100ms 余量，被抢一次 CPU 就穿。而一个会随机变红的闸门
 * 与一个不会变红的闸门一样有害——它训练人忽略红色，本里程碑的全部价值都建立在
 * 「红了就是真的坏了」上。
 *
 * 假计时器把「等够 400 毫秒」换成「让计时器前进 400 毫秒」：与负载无关，也不再
 * 有余量这个概念。**区分力一点没少**——advanceTimersByTimeAsync 之前那句「防抖
 * 窗口内不该已经落地」照旧断得住，之后那句也照旧要求回调真的跑过；防抖常数改大
 * 或清定时器漏掉，两个方向都仍然变红（已实测）。顺带把这个文件的耗时从 ~5s 压到
 * 毫秒级。
 */
const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function emptyIndex(): WorkspaceIndex {
  return new WorkspaceIndex({ exists: () => false });
}

describe('createDiagnosticsHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __diagnosticCollections.length = 0;
    __docOpenHandlers.length = 0;
    __docCloseHandlers.length = 0;
    __docChangeHandlers.length = 0;
    __configChangeHandlers.length = 0;
    __openDocuments.length = 0;
    __config.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    __config.clear();
  });

  it('建立一个诊断集合并放进 subscriptions', () => {
    const c = ctx();
    createDiagnosticsHost(c as never, emptyIndex());
    const collection = onlyCollection();
    expect(collection.name).toBe('panorama');
    expect(c.subscriptions).toContain(collection);
  });

  it('打开文档时经真实注册的回调产出诊断，且偏移被正确换算成行列', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);

    const found = diagnosticsOf(doc).find((d) => d.code === 'vcss.visibilityHidden');
    expect(found, `没报出 visibility: hidden，实际：${codesOf(doc)}`).toBeDefined();

    // 先自证夹具确实处在「三个数互不相等」的位置上——这条断言坏了说明夹具
    // 被改动，上面那段挑选理由随之失效，下面的换算断言也就不再有区分力。
    expect(FIXTURE_VCSS.indexOf('hidden')).toBe(52);

    expect(found!.range.start).toEqual({ line: 4, character: 16 });
    expect(found!.range.end).toEqual({ line: 4, character: 22 });
  });

  /**
   * 三档级别**各断一条真实诊断**，不能只断 warning 与 error。
   *
   * 交付时这条只断了 warning，外加一句 `expect(DiagnosticSeverity.Hint).toBe(3)`
   * ——后者是对 mock 常量的断言，**与被测代码无关**。实测（tamper T7）：把
   * 映射表里的 `hint` 改成 `DiagnosticSeverity.Information`，15 条全绿。
   * hint 是本扩展最常出现的级别（`unknownClass` 一条规则在语料上就有 793 处），
   * 错成 Information 会让「问题」面板里凭空多出几百条 info。
   */
  it('三档级别各自映射到 vscode 的枚举值——hint 是 Hint(3) 不是 Information(2)', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());

    const warn = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(warn);
    const w = diagnosticsOf(warn).find((d) => d.code === 'vcss.visibilityHidden');
    expect(w!.severity).toBe(DiagnosticSeverity.Warning);

    // hint：class= 引用了工作区里没有定义的类名（默认 hint 级）
    const hint = createOpenDocument(
      '<root>\n\t<Panel class="nowhere-defined" />\n</root>\n',
      '/w/panorama/layout/a.xml',
      'panorama-vxml',
    );
    fireDocOpen(hint);
    const h = diagnosticsOf(hint).find((d) => d.code === 'vxml.unknownClass');
    expect(h, `实际：${codesOf(hint)}`).toBeDefined();
    expect(h!.severity).toBe(DiagnosticSeverity.Hint);
    // 顺带钉住 mock 与真实 vscode 枚举的一致性：Hint 是 3，Information 才是 2。
    // 这一句是对 mock 的断言，不是对被测代码的——上面那条才是。
    expect(DiagnosticSeverity.Hint).toBe(3);
    expect(DiagnosticSeverity.Information).toBe(2);
  });

  it('替代写法进入 message —— 规格 §10.1 要求每条 warning 都给', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    const found = diagnosticsOf(doc).find((d) => d.code === 'vcss.visibilityHidden');
    expect(found!.message).toContain('visibility: collapse');
  });

  it('非 Panorama 语言的文档不产诊断', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, '/w/other/a.css', 'css');
    fireDocOpen(doc);
    expect(onlyCollection().get(doc.uri)).toBeUndefined();
  });

  it('编辑走 300ms 防抖：窗口内不落地，窗口后落地', async () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const clean = createOpenDocument('.a\n{\n\twidth: 1px;\n}\n', VCSS_PATH, 'panorama-vcss');
    fireDocOpen(clean);
    expect(diagnosticsOf(clean)).toHaveLength(0);

    // 同一个 uri，内容换成有问题的那份
    const dirty = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    __openDocuments[__openDocuments.indexOf(clean)] = dirty;
    fireDocEdit(dirty);
    expect(diagnosticsOf(dirty), '防抖窗口内不该已经落地').toHaveLength(0);

    await elapse(400);
    expect(diagnosticsOf(dirty).some((d) => d.code === 'vcss.visibilityHidden')).toBe(true);
  });

  it('关闭文档后诊断被清掉', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    expect(diagnosticsOf(doc).length).toBeGreaterThan(0);

    fireDocClose(doc);
    expect(onlyCollection().get(doc.uri)).toBeUndefined();
  });

  it('关闭竞态：关闭前挂起的防抖重算，不会在关闭生效后把诊断写回去', async () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    expect(diagnosticsOf(doc).length).toBeGreaterThan(0);

    // 触发一次编辑：挂起一个 300ms 定时器，此刻还没到期
    fireDocEdit(doc);
    // **不等防抖**就关掉它
    fireDocClose(doc);
    expect(onlyCollection().get(doc.uri)).toBeUndefined();

    // 等过防抖窗口：若关闭时没清掉挂起的定时器，它会在这里触发并把诊断写回去，
    // 于是编辑器里出现「已经关掉的文件仍挂着诊断」。这与 M3 索引宿主那个
    // 「删除被防抖静默撤销」是同一个陷阱，方向反过来。
    await elapse(400);
    expect(
      onlyCollection().get(doc.uri),
      '已关闭的文档不该再被写上诊断——挂起的防抖定时器没被清掉',
    ).toBeUndefined();
  });

  it('索引变化后重算已打开的文档——跨文件规则的结论跟着索引走', async () => {
    const index = emptyIndex();
    createDiagnosticsHost(ctx() as never, index);
    const doc = createOpenDocument(
      '.a\n{\n\tbackground-color: myAccent;\n}\n',
      VCSS_PATH,
      'panorama-vcss',
    );
    fireDocOpen(doc);
    expect(
      diagnosticsOf(doc).some((d) => d.code === 'vcss.unknownDefine'),
      `索引里没有 myAccent 时应报「引用不到定义」，实际：${codesOf(doc)}`,
    ).toBe(true);

    // 另一个文件里定义了它——索引变了，这条诊断就该消失
    index.update(
      symbolsOfVcss('/w/panorama/styles/b.css', parseVcss('@define myAccent: #123456;\n')),
    );
    await elapse(400);
    expect(
      diagnosticsOf(doc).some((d) => d.code === 'vcss.unknownDefine'),
      '索引更新后没有重算，编辑器里会一直挂着过期的「未定义」',
    ).toBe(false);
  });

  it('索引变化不会把已关闭文档的诊断写回来', async () => {
    const index = emptyIndex();
    createDiagnosticsHost(ctx() as never, index);
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    fireDocClose(doc);

    index.update(symbolsOfVcss('/w/panorama/styles/b.css', parseVcss('@define x: #123456;\n')));
    await elapse(400);
    expect(onlyCollection().get(doc.uri)).toBeUndefined();
  });

  it('组设为 off 时整组消失；改级别时 severity 跟着变', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');

    __config.set('panorama.diagnostics.webOnlySyntax', 'off');
    fireDocOpen(doc);
    expect(diagnosticsOf(doc).some((d) => d.code === 'vcss.visibilityHidden')).toBe(false);

    __config.set('panorama.diagnostics.webOnlySyntax', 'error');
    fireDocOpen(doc);
    const found = diagnosticsOf(doc).find((d) => d.code === 'vcss.visibilityHidden');
    expect(found!.severity).toBe(DiagnosticSeverity.Error);
  });

  it('配置取值非法时回落到默认级别，而不是静默关掉整组', () => {
    __config.set('panorama.diagnostics.structure', 'WARNING'); // 大小写不对，不是合法取值
    expect(readDiagnosticSettings().structure).toBe(DEFAULT_DIAGNOSTIC_SETTINGS.structure);
    __config.clear();
    expect(readDiagnosticSettings()).toEqual(DEFAULT_DIAGNOSTIC_SETTINGS);
  });

  it('合法取值是**逐键**判的：error 只对开到 error 的那四个键成立', () => {
    // 最终评审 M-6：交付时这里用的是一张全局 LEVELS 表，于是手改 settings.json
    // 写 "panorama.diagnostics.unknownProperty": "error" 会被照单接受——而
    // package.json 给这个键声明的 enum 只到 warning，设置界面的下拉框里根本没有
    // 这一项。现在按键查 ALLOWED_LEVELS，超出该键取值域的照「非法」回落。
    //
    // 两个方向各钉一次，缺任一侧都可能空转：只钉「越界被拒」时，把
    // ALLOWED_LEVELS 全改成 ['off','hint'] 照样绿；只钉「合法被收」时，退回
    // 全局表照样绿。
    for (const key of SETTING_KEYS) {
      __config.clear();
      __config.set(`panorama.diagnostics.${key}`, 'error');
      const got = readDiagnosticSettings()[key];
      const allowed: readonly string[] = ALLOWED_LEVELS[key];
      expect(got, `${key} 的取值域是 ${allowed.join('|')}`).toBe(
        allowed.includes('error') ? 'error' : DEFAULT_DIAGNOSTIC_SETTINGS[key],
      );
    }
    // 上面那句用 allowed 自证会跟着表一起变，所以另外把「哪三个键不到 error」
    // 逐字钉死一次——规格 §10.4 的分档本身是承重的，改动它必须是有意的。
    const capped = SETTING_KEYS.filter((k) => !(ALLOWED_LEVELS[k] as readonly string[]).includes('error'));
    expect([...capped].sort()).toEqual(['duplicateId', 'unknownClass', 'unknownProperty']);
  });

  it('激活时已经打开着的文档也会被诊断（它们收不到 onDidOpen）', () => {
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    __openDocuments.push(doc);
    createDiagnosticsHost(ctx() as never, emptyIndex());
    expect(diagnosticsOf(doc).some((d) => d.code === 'vcss.visibilityHidden')).toBe(true);
  });

  it('VXML 侧同样接线：严格模式下的白名单违规报 error', () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(
      '<root>\n\t<Panel>\n\t\t<ProgressBar />\n\t</Panel>\n</root>\n',
      '/w/panorama/layout/custom_game/demo/main.xml',
      'panorama-vxml',
    );
    fireDocOpen(doc);
    const found = diagnosticsOf(doc).find((d) => d.code === 'hud.panelNotAllowed');
    expect(found, `实际：${codesOf(doc)}`).toBeDefined();
    expect(found!.severity).toBe(DiagnosticSeverity.Error);
  });

  it('dispose 清干净：集合被释放，挂起的防抖定时器不再落地', async () => {
    const c = ctx();
    createDiagnosticsHost(c as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    fireDocEdit(doc); // 挂起一个定时器

    for (const s of c.subscriptions) s.dispose?.();
    expect(onlyCollection().disposed).toBe(true);

    await elapse(400);
    expect(
      onlyCollection().get(doc.uri),
      'dispose 之后挂起的定时器仍然落地了——扩展卸载后还在往编辑器写诊断',
    ).toBeUndefined();
  });

  /**
   * I-2：七个开关改了要立刻生效。没有这个监听器时，用户把 unknownClass 关掉
   * （语料上 793 处命中，最可能被关的一组），**已经打开着的文件波浪线纹丝不动**，
   * 直到他去每个文件里随手敲一下——本任务的头号交付物在最常见的使用姿势下
   * 看起来是坏的。这条测试全程**不碰文档**，只改配置。
   */
  it('改配置后不碰文档，已打开文档的诊断也跟着变', async () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    expect(diagnosticsOf(doc).find((d) => d.code === 'vcss.visibilityHidden')?.severity).toBe(
      DiagnosticSeverity.Warning,
    );

    __config.set('panorama.diagnostics.webOnlySyntax', 'error');
    fireConfigChange(['panorama.diagnostics.webOnlySyntax']);
    await elapse(400);
    expect(
      diagnosticsOf(doc).find((d) => d.code === 'vcss.visibilityHidden')?.severity,
      '改了开关却没重算：已打开的文件要等到被编辑或重开才生效',
    ).toBe(DiagnosticSeverity.Error);

    __config.set('panorama.diagnostics.webOnlySyntax', 'off');
    fireConfigChange(['panorama.diagnostics.webOnlySyntax']);
    await elapse(400);
    expect(
      diagnosticsOf(doc).some((d) => d.code === 'vcss.visibilityHidden'),
      '整组关掉之后波浪线还在',
    ).toBe(false);

    // 反过来：与本扩展无关的配置变化不该触发重算，否则用户每改一次字号都要
    // 把所有打开的文档重跑一遍诊断。这一句同时钉住 affectsConfiguration 那道
    // 过滤——去掉它的话这里会重算、把 webOnlySyntax 恢复成 warning 而变红。
    __config.set('panorama.diagnostics.webOnlySyntax', 'warning');
    fireConfigChange(['editor.fontSize']);
    await elapse(400);
    expect(
      diagnosticsOf(doc).some((d) => d.code === 'vcss.visibilityHidden'),
      '与本扩展无关的配置变化也触发了重算',
    ).toBe(false);
  });

  /**
   * 第二个配置读取点（modeOf 读的 `panorama.customHudLayout.include`）此前同样
   * 没有任何测试碰过——把它的节名改成别的字符串，714 条照样全绿（本轮实测）。
   * 这条把它一并钉住：改了这个 glob，已打开的文档要立刻换一套规则集。
   */
  it('customHudLayout.include 改了也重算——顺带钉住第二个读取点的节名', async () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    // 默认 glob 是 **/layout/custom_game/**，这个路径不在其中 -> 完整模式
    const doc = createOpenDocument(
      '<root>\n\t<Panel>\n\t\t<ProgressBar />\n\t</Panel>\n</root>\n',
      '/w/panorama/layout/my_mod/main.xml',
      'panorama-vxml',
    );
    fireDocOpen(doc);
    expect(
      diagnosticsOf(doc).some((d) => d.code === 'hud.panelNotAllowed'),
      `完整模式下 ProgressBar 是合法面板，实际：${codesOf(doc)}`,
    ).toBe(false);

    __config.set('panorama.customHudLayout.include', ['**/layout/my_mod/**']);
    fireConfigChange(['panorama.customHudLayout.include']);
    await elapse(400);
    const found = diagnosticsOf(doc).find((d) => d.code === 'hud.panelNotAllowed');
    expect(found, `改成严格模式后应报白名单违规，实际：${codesOf(doc)}`).toBeDefined();
    expect(found!.severity).toBe(DiagnosticSeverity.Error);
  });

  /**
   * 与「关闭竞态」「索引变化不写回已关闭文档」同一个陷阱：配置变化排下的那次
   * 重算若记的是**事件发生那一刻的文档快照**，300ms 后它会把诊断写回一个已经
   * 关掉的文件上。读实时的 textDocuments 才不会。
   */
  it('配置变化挂起的重算，不会在文档关闭生效后把诊断写回去', async () => {
    createDiagnosticsHost(ctx() as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);
    expect(diagnosticsOf(doc).length).toBeGreaterThan(0);

    __config.set('panorama.diagnostics.webOnlySyntax', 'error');
    fireConfigChange(['panorama.diagnostics.webOnlySyntax']);
    // **不等防抖**就关掉它
    fireDocClose(doc);
    expect(onlyCollection().get(doc.uri)).toBeUndefined();

    await elapse(400);
    expect(
      onlyCollection().get(doc.uri),
      '已关闭的文档被那次挂起的配置重算又写上了诊断',
    ).toBeUndefined();
  });

  it('dispose 之后挂起的「配置变化重算」不再落地', async () => {
    const c = ctx();
    createDiagnosticsHost(c as never, emptyIndex());
    const doc = createOpenDocument(FIXTURE_VCSS, VCSS_PATH, 'panorama-vcss');
    fireDocOpen(doc);

    __config.set('panorama.diagnostics.webOnlySyntax', 'off');
    fireConfigChange(['panorama.diagnostics.webOnlySyntax']);
    // 不等防抖就卸载扩展
    for (const s of c.subscriptions) s.dispose?.();
    expect(onlyCollection().disposed).toBe(true);

    await elapse(400);
    expect(
      onlyCollection().entries.size,
      'dispose 之后那次挂起的配置重算仍然落地了——扩展卸载后还在往编辑器写诊断',
    ).toBe(0);
  });
});
