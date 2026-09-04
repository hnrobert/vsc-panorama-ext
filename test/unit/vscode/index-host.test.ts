import { describe, it, expect, beforeEach } from 'vitest';
import { minimatch } from 'minimatch';
import {
  __workspaceFiles,
  __watchers,
  __config,
  __docChangeHandlers,
  Uri,
  workspace,
} from '../../mocks/vscode';
import { createIndexHost, INDEX_GLOBS } from '../../../src/vscode/index-host';

const ctx = () => ({ subscriptions: [] as unknown[] }) as never;

describe('createIndexHost', () => {
  beforeEach(() => {
    __workspaceFiles.clear();
    __watchers.length = 0;
    __docChangeHandlers.length = 0;
  });

  function fireDocChange(fsPath: string, languageId: string, text: string): void {
    for (const h of __docChangeHandlers) {
      h({ document: { languageId, uri: Uri.file(fsPath), getText: () => text } });
    }
  }

  it('同步返回索引对象，不等待扫描完成', () => {
    __workspaceFiles.set('/w/panorama/styles/a.css', '.btn { width: 1px; }');
    const idx = createIndexHost(ctx());
    // 立即可用（此刻可能还是空的），provider 不该被阻塞
    expect(typeof idx.allClassNames).toBe('function');
  });

  it('扫描完成后索引里有符号', async () => {
    __workspaceFiles.set('/w/panorama/styles/a.css', '.btn\n{\n\twidth: 1px;\n}');
    __workspaceFiles.set(
      '/w/panorama/layout/a.xml',
      '<root><Panel class="btn" /></root>',
    );
    const idx = createIndexHost(ctx());
    await new Promise((r) => setTimeout(r, 50));

    expect(idx.allClassNames()).toContain('btn');
    expect(idx.classReferences('btn')).toHaveLength(1);
  });

  it('注册了文件监视器并放进 subscriptions', () => {
    const c = { subscriptions: [] as unknown[] };
    createIndexHost(c as never);
    expect(__watchers.length).toBeGreaterThan(0);
    expect(c.subscriptions.length).toBeGreaterThan(0);
  });

  it('文件删除事件会把符号从索引里摘掉', async () => {
    const p = '/w/panorama/styles/a.css';
    __workspaceFiles.set(p, '.gone\n{\n\twidth: 1px;\n}');
    const idx = createIndexHost(ctx());
    await new Promise((r) => setTimeout(r, 50));
    expect(idx.allClassNames()).toContain('gone');

    __workspaceFiles.delete(p);
    for (const w of __watchers) w.onDelete.fire(Uri.file(p));
    await new Promise((r) => setTimeout(r, 50));

    expect(idx.allClassNames()).not.toContain('gone');
  });

  it('index.enabled 为 false 时不扫描，索引保持为空', async () => {
    __workspaceFiles.set('/w/panorama/styles/a.css', '.btn\n{\n\twidth: 1px;\n}');
    __config.set('panorama.index.enabled', false);
    try {
      const idx = createIndexHost(ctx());
      await new Promise((r) => setTimeout(r, 50));
      expect(idx.allClassNames()).toEqual([]);
    } finally {
      __config.delete('panorama.index.enabled');
    }
  });

  it('删除竞态：删除前挂起的防抖编辑，不会在删除生效后把文件加回索引', async () => {
    const p = '/w/panorama/styles/a.css';
    __workspaceFiles.set(p, '.gone\n{\n\twidth: 1px;\n}');
    const idx = createIndexHost(ctx());
    await new Promise((r) => setTimeout(r, 50));
    expect(idx.allClassNames()).toContain('gone');

    // 触发一次编辑：挂起一个 300ms 防抖定时器，此刻还没到期
    fireDocChange(p, 'panorama-vcss', '.gone\n{\n\twidth: 3px;\n}');

    // 定时器到期前，文件被外部删除
    __workspaceFiles.delete(p);
    for (const w of __watchers) w.onDelete.fire(Uri.file(p));

    // 等过防抖窗口：如果 drop() 没清掉挂起的定时器，它会在这里触发，
    // 把删除的文件重新 index.update() 回去
    await new Promise((r) => setTimeout(r, 350));

    expect(idx.get(p)).toBeUndefined();
    expect(idx.allClassNames()).not.toContain('gone');
  });

  it('防抖如期落地：等过 300ms 后，新内容的符号出现在索引里', async () => {
    const p = '/w/panorama/styles/live-edit.css';
    const idx = createIndexHost(ctx());

    fireDocChange(p, 'panorama-vcss', '.freshly-typed\n{\n\twidth: 1px;\n}');

    // 防抖窗口内不该已经生效——证明这确实是「延迟落地」而不是同步写入
    expect(idx.allClassNames()).not.toContain('freshly-typed');

    await new Promise((r) => setTimeout(r, 350));

    expect(idx.allClassNames()).toContain('freshly-typed');
  });
});

/**
 * 最终评审 Important 3：`workspace.findFiles` 与 `createFileSystemWatcher` 匹配的
 * 是「相对工作区文件夹」的路径，**文件夹名本身不在里面**。旧 glob 硬编码
 * `**​/panorama/**​/…`，用户把 panorama 目录直接开成工作区根时相对路径里一个
 * panorama 段都没有，扫描恒为 0 个文件、watcher 也永不触发，全部跨文件能力
 * 静默降级为空且毫无提示。E2E fixture 一律是 `<root>/panorama/...` 的嵌套形态，
 * 只覆盖了一半。
 *
 * mock 的 findFiles 不做 glob 过滤（它把 __workspaceFiles 里的东西全返回），
 * 所以这里不能靠跑 createIndexHost 来验判据——那样写出来的是空转测试。改为
 * 直接对导出的 glob 常量做 minimatch，并另加一条把常量与真实用法钉在一起。
 */
describe('索引 glob 覆盖两种工作区形态（最终评审 Important 3）', () => {
  const scanned = (rel: string) => INDEX_GLOBS.some((g) => minimatch(rel, g));

  it('形态一：工作区根目录本身就是 panorama 目录（相对路径里没有 panorama 段）', () => {
    expect(scanned('20260716/styles/hud/x.css')).toBe(true);
    expect(scanned('20260716/layout/hud/x.xml')).toBe(true);
    expect(scanned('styles/x.vcss')).toBe(true);
    expect(scanned('layout/x.vxml')).toBe(true);
  });

  it('形态二：panorama 目录嵌在工作区里（原本就支持的形态，不能被改回归）', () => {
    expect(scanned('panorama/styles/hud/x.css')).toBe(true);
    expect(scanned('panorama/layout/hud/x.xml')).toBe(true);
    expect(scanned('game/csgo/panorama/layout/custom_game/demo/main.xml')).toBe(true);
  });

  it('layout/ 与 styles/ 之外的 .xml / .css 不被拉进索引', () => {
    expect(scanned('docs/readme.xml')).toBe(false);
    expect(scanned('src/app.css')).toBe(false);
    expect(scanned('panorama/scripts/hud.js')).toBe(false);
    expect(scanned('panorama/layout/hud/x.txt')).toBe(false);
  });

  it('watcher 真的按这两条 glob 注册——常量与实际用法不能脱节', () => {
    __watchers.length = 0;
    createIndexHost(ctx());
    expect([...__watchers.map((w) => w.pattern)].sort()).toEqual([...INDEX_GLOBS].sort());
  });
});

/**
 * glob 放宽到 `layout/` 与 `styles/` 之后，混合仓库里 Android 的
 * `res/layout/*.xml`、Web 的 `src/styles/*.css` 也会命中——那等于把「索引恒空」
 * 这个静默失效换成「索引被污染」这个静默降级。`isPanoramaContent` 这道后置过滤
 * 把它们丢掉，同时保住 Important 3 修好的两种真实形态。
 *
 * 这一组跑真实的 `createIndexHost`（不是对常量做 minimatch），因为要验的正是
 * 「文件到底有没有进索引」这件事，以及扫描与 watcher 是不是同一个判定。
 */
describe('后置过滤：混合仓库里的无关 layout/ styles/ 不进索引', () => {
  /** mock 的 workspaceFolders 是普通可写属性，用完还原 */
  async function withFolder<T>(folder: string, fn: () => Promise<T>): Promise<T> {
    const w = workspace as { workspaceFolders?: unknown };
    const saved = w.workspaceFolders;
    w.workspaceFolders = [{ uri: Uri.file(folder), name: 'ws', index: 0 }];
    try {
      return await fn();
    } finally {
      w.workspaceFolders = saved;
    }
  }

  beforeEach(() => {
    __workspaceFiles.clear();
    __watchers.length = 0;
    __docChangeHandlers.length = 0;
  });

  it('形态一：工作区根目录本身就是 panorama 目录 —— 文件进索引', async () => {
    await withFolder('/w/panorama', async () => {
      __workspaceFiles.set('/w/panorama/20260716/styles/hud.css', '.root-only { width: 1px; }');
      const idx = createIndexHost(ctx());
      await new Promise((r) => setTimeout(r, 50));
      expect(idx.allClassNames()).toContain('root-only');
    });
  });

  it('形态二：panorama 目录嵌在工作区里 —— 文件进索引', async () => {
    await withFolder('/w', async () => {
      __workspaceFiles.set('/w/panorama/styles/hud.css', '.nested-ok { width: 1px; }');
      const idx = createIndexHost(ctx());
      await new Promise((r) => setTimeout(r, 50));
      expect(idx.allClassNames()).toContain('nested-ok');
    });
  });

  it('混合仓库里的 res/layout 与 src/styles 不进索引（工作区文件夹路径不含 panorama）', async () => {
    await withFolder('/w', async () => {
      // 这两个都会被 INDEX_GLOBS 命中（res/layout/**.xml、src/styles/**.css），
      // 拦住它们的只可能是后置过滤。
      __workspaceFiles.set(
        '/w/res/layout/activity_main.xml',
        '<root><Panel class="android-noise" /></root>',
      );
      __workspaceFiles.set('/w/src/styles/site.css', '.web-noise { width: 1px; }');
      // 同一个工作区里真的有 panorama 内容——证明这条不是靠「索引整体为空」蒙对的
      __workspaceFiles.set('/w/panorama/styles/hud.css', '.real-panorama { width: 1px; }');

      const idx = createIndexHost(ctx());
      await new Promise((r) => setTimeout(r, 50));

      expect(idx.allClassNames()).toContain('real-panorama');
      expect(idx.allClassNames()).not.toContain('web-noise');
      expect(idx.classReferences('android-noise')).toEqual([]);
      expect(idx.get('/w/src/styles/site.css')).toBeUndefined();
      expect(idx.get('/w/res/layout/activity_main.xml')).toBeUndefined();
    });
  });

  it('watcher 与首次扫描判定一致：扫描时被丢弃的文件，create/change 事件也不能把它塞回来', async () => {
    await withFolder('/w', async () => {
      const noise = '/w/src/styles/site.css';
      __workspaceFiles.set(noise, '.web-noise { width: 1px; }');

      const idx = createIndexHost(ctx());
      await new Promise((r) => setTimeout(r, 50));
      expect(idx.allClassNames()).not.toContain('web-noise');

      // watcher 的两个入口各来一次——判定只落在扫描循环里的话，这里就会漏进去
      for (const w of __watchers) w.onCreate.fire(Uri.file(noise));
      for (const w of __watchers) w.onChange.fire(Uri.file(noise));
      await new Promise((r) => setTimeout(r, 50));

      expect(idx.allClassNames()).not.toContain('web-noise');
      expect(idx.get(noise)).toBeUndefined();
    });
  });
});
