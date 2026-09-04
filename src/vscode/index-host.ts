import * as vscode from 'vscode';
import { parseVxml } from '../core/vxml/parser';
import { parseVcss } from '../core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../core/index/symbols';
import { WorkspaceIndex } from '../core/index/workspace-index';

/**
 * 全量扫描与 watcher 用的 glob。导出供测试直接验证两种工作区形态。
 *
 * 判据落在 `layout/` 与 `styles/` 这两个真正标识 Panorama 内容的路径段上，
 * **不要求路径里出现 `panorama/` 段**——`workspace.findFiles` 匹配的是
 * 「相对工作区文件夹」的路径，**文件夹名本身不在里面**。用户把
 * `.../content/csgo/panorama`（或某个 addon 的 `panorama/`）直接开成工作区根
 * 时，相对路径形如 `20260716/styles/x.css`，一个 `panorama` 段都没有：旧的
 * `**​/panorama/**​/styles/**` 在这种形态下扫到 0 个文件、watcher 也永不触发，
 * 全部跨文件能力静默降级为空且毫无提示。把 `panorama/` 嵌在工作区里的形态
 * 相对路径是 `panorama/styles/x.css`，同样落在 `styles/` 下，一条 glob 覆盖
 * 两种形态。
 *
 * 放宽只到这一步为止：`layout/` 之外的 `.xml`、`styles/` 之外的 `.css` 仍然
 * 进不来。顺带也让索引的判据与 `panorama.customHudLayout.include` 的默认 glob
 * （`**​/layout/custom_game/**`，同样不要求 panorama 段）对齐，不再出现
 * 「严格模式生效了、索引却是空的」这种自相矛盾的状态。
 *
 * glob 只是第一道闸——它拦不住混合仓库里的 `res/layout/*.xml`、
 * `src/styles/*.css`，那些由 {@link isPanoramaContent} 这道后置过滤丢弃。
 */
export const INDEX_GLOBS = [
  '**/layout/**/*.{xml,vxml}',
  '**/styles/**/*.{css,vcss}',
] as const;

/**
 * 路径里是否有独立的 `panorama` 段。
 *
 * 按段匹配而不是按子串：`panorama-tools/` 之类的目录不该被算成 Panorama 内容根。
 * 大小写不敏感——Windows 上路径大小写不区分，Panorama 与 panorama 是同一个
 * 目录，按大小写敏感去判会把一半用户静默漏掉，而这正是本轮要根除的失效模式。
 */
function hasPanoramaSegment(path: string): boolean {
  return /(^|\/)panorama(\/|$)/i.test(path);
}

/**
 * 后置过滤：这个文件算不算 Panorama 内容。
 *
 * {@link INDEX_GLOBS} 放宽到「`layout/` 或 `styles/` 之下」之后，混合仓库里
 * Android 的 `res/layout/*.xml`、Web 的 `src/styles/*.css` 也会命中，索引会被
 * 一堆无关类名污染——那等于把「索引恒空」这个静默失效换成「索引被污染」这个
 * 静默降级，不算真正解决。这里再要求路径里出现 `panorama` 段：
 *
 * - 根目录就是 `panorama/`（或某个 addon 的 `panorama/`）→ 工作区文件夹自身
 *   路径含 `panorama` 段 → 收下（Important 3 修好）；
 * - `panorama/` 嵌在工作区里 → 文件路径含 `panorama` 段 → 收下（原有形态不变）；
 * - 混合仓库的 `res/layout/x.xml`、`src/styles/y.css` → 都不含 → 丢弃。
 *
 * 判据只写了一条而不是「文件路径 ∨ 工作区文件夹自身路径」两条，是因为**这里拿到
 * 的是 `uri.fsPath`（绝对路径）**，工作区文件夹自身路径必然是它的前缀——第一种
 * 形态下文件的绝对路径 `X:/archive/panorama/20260716/styles/x.css` 本来
 * 就含 `panorama` 段。两条判据在绝对路径下逐例等价（含
 * `panorama-tools/myapp/src/styles/y.css` 这种否定例：两条都不命中），多写一条
 * 只会留下一段永远为假、因而无法被测试证伪的分支。
 *
 * 调用点只有一处（{@link createIndexHost} 里的 `ingest`），首次全量扫描与
 * watcher 的 create/change 都走它——两条路径必须共用同一个判定，否则 watcher 会
 * 把扫描时丢弃的文件重新塞回索引（与 Task 4「删除被防抖静默撤销」同型）。
 */
export function isPanoramaContent(path: string): boolean {
  return hasPanoramaSegment(path.replace(/\\/g, '/'));
}

const DEBOUNCE_MS = 300;

function isVxml(path: string): boolean {
  return path.endsWith('.xml') || path.endsWith('.vxml');
}

/** 同步存在性判断：s2r 解析要在补全的同步路径里用，不能等异步 stat */
function existsSync(path: string): boolean {
  // VSCode 没有同步 fs API。索引在扫描期已经知道工作区里有哪些文件，
  // 目录则由文件路径前缀推出——这对 s2r 的两类候选判断已经够用，
  // 且避免了在补全路径上做异步 IO。
  return knownPaths.has(path) || dirPrefixes.has(path);
}

const knownPaths = new Set<string>();
const dirPrefixes = new Set<string>();

function remember(path: string): void {
  knownPaths.add(path);
  let dir = path;
  for (;;) {
    const i = dir.lastIndexOf('/');
    if (i <= 0) break;
    dir = dir.slice(0, i);
    dirPrefixes.add(dir);
  }
}

function forget(path: string): void {
  knownPaths.delete(path);
  // 目录前缀不回收：一个空目录被误判为存在，最坏后果是多试一个候选根，
  // 而候选仍要通过文件存在性验证才会被采纳。
}

export function createIndexHost(context: vscode.ExtensionContext): WorkspaceIndex {
  const cfg = vscode.workspace.getConfiguration('panorama');
  const contentRoots = cfg.get<string[]>('contentRoots', []);
  const enabled = cfg.get<boolean>('index.enabled', true);
  const extraExclude = cfg.get<string[]>('index.exclude', []);

  const index = new WorkspaceIndex({ exists: existsSync, contentRoots });

  // 关闭索引后跨文件能力降级为单文件能力（规格 §12）：返回一个永远为空的
  // 索引，provider 照常调用，只是拿不到跨文件候选。比在每个 provider 里
  // 加分支干净。
  if (!enabled) return index;

  const exclude = ['**/node_modules/**', ...extraExclude].join(',');
  const excludeGlob = extraExclude.length > 0 ? `{${exclude}}` : '**/node_modules/**';

  // 编辑中的文档以内存内容为准，防抖后重建该文件的符号。声明提到 ingest/drop
  // 前面，因为 drop 也要能清掉该路径挂起的定时器（见下）。
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const ingest = async (uri: vscode.Uri): Promise<void> => {
    const path = uri.fsPath.replace(/\\/g, '/');
    // 后置过滤的唯一闸口：首次全量扫描与 watcher 的 create/change 都经由这里，
    // 两条路径因此共用同一个判定。把它放到扫描循环里而不是这里，watcher 就会把
    // 扫描时丢弃的文件重新塞回索引——那是 Task 4 那个「删除被防抖静默撤销」的
    // 同型陷阱，只是方向反过来。
    if (!isPanoramaContent(path)) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(bytes);
      remember(path);
      index.update(
        isVxml(path)
          ? symbolsOfVxml(path, parseVxml(text))
          : symbolsOfVcss(path, parseVcss(text)),
      );
    } catch {
      // 读不到就当它不存在——文件可能刚被删掉
      forget(path);
      index.remove(path);
    }
  };

  const drop = (uri: vscode.Uri): void => {
    const path = uri.fsPath.replace(/\\/g, '/');
    // 必须先清掉这个路径挂起的防抖定时器：否则文件删除后，此前一次编辑
    // 排的队仍会在 300ms 后触发，把刚删掉的文件重新 index.update() 回去，
    // 删除被静默撤销。
    clearTimeout(timers.get(path));
    timers.delete(path);
    forget(path);
    index.remove(path);
  };

  // 首次全量扫描：异步进行，provider 在此期间基于部分结果工作，不阻塞
  void (async () => {
    for (const glob of INDEX_GLOBS) {
      const found = await vscode.workspace.findFiles(glob, excludeGlob);
      for (const uri of found) await ingest(uri);
    }
  })();

  for (const glob of INDEX_GLOBS) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(ingest);
    watcher.onDidChange(ingest);
    watcher.onDidDelete(drop);
    context.subscriptions.push(watcher);
  }

  // 编辑中文档这条路径**刻意不过 isPanoramaContent**：它的门槛是 languageId，
  // 而 languageId 本身已经是更强的信号——.vxml / .vcss 后缀无条件就是 Panorama
  // 文件，.xml / .css 则只有命中 package.json 里那两条 filenamePatterns
  // （都要求 panorama 段）才拿得到这个 languageId。所以混合仓库里的
  // res/layout/x.xml 根本走不到这里，这条路径不是后置过滤的后门；反过来真去
  // 过滤它，会把「用户正在编辑的、后缀就是 .vcss 的文件」挡在索引外，那是纯粹
  // 的功能倒退。
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const id = e.document.languageId;
      if (id !== 'panorama-vxml' && id !== 'panorama-vcss') return;
      const path = e.document.uri.fsPath.replace(/\\/g, '/');
      clearTimeout(timers.get(path));
      timers.set(
        path,
        setTimeout(() => {
          const text = e.document.getText();
          remember(path);
          index.update(
            id === 'panorama-vxml'
              ? symbolsOfVxml(path, parseVxml(text))
              : symbolsOfVcss(path, parseVcss(text)),
          );
        }, DEBOUNCE_MS),
      );
    }),
  );

  return index;
}
