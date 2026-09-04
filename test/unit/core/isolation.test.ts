import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// vitest 走 ESM，没有 __dirname
const CORE_DIR = fileURLToPath(new URL('../../../src/core', import.meta.url));

function allTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTs(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 精确匹配「引用 vscode 模块」的三种写法：
 * - import ... from 'vscode' / "vscode"（含 import type、export ... from、裸 import 'vscode'）
 * - require('vscode') / require("vscode")
 * - 动态 import('vscode') / import("vscode")
 *
 * 引号内必须恰好是 vscode 六个字符，因此不会被 `../vscode-helpers` 这类路径误伤；
 * 也不会被注释里单纯提到 vscode 一词触发——那种写法不会紧贴 from/import/require
 * 出现引号包裹的 vscode。经 `grep -rni vscode src/core/` 核实，目前 src/core 连注释
 * 里都没有 vscode 字样，不存在需要专门规避的既有场景。
 */
const VSCODE_REFERENCE =
  /\bfrom\s+['"]vscode['"]|\bimport\s+['"]vscode['"]|\b(?:require|import)\s*\(\s*['"]vscode['"]\s*\)/;

/**
 * 同样的三种写法，但引号内是 Node 内建模块（`node:` 前缀）。
 *
 * 全局约束逐字写的是「src/core 绝对禁止 import 'vscode' 或 node:fs」，但守卫
 * 至今只查 vscode 字面串，node 那一半零执行——最终评审点名的就是这条。这里
 * 拦下全部 `node:*` 而不只是 `node:fs`：D6 要保留低成本转 LSP / CLI 的余地，
 * `node:path`、`node:os` 一样会把 core 钉死在 Node 运行时上，而 core 至今
 * 一个 `node:` 导入都没有，收紧到整族的代价是零。
 *
 * 只认带 `node:` 前缀的写法，不去猜裸 'fs' / 'path'：裸名会与相对路径、
 * npm 包名混淆，误报的代价比漏报大。而 core 的依赖全是相对路径与 JSON，
 * 真要引入 Node 能力也必然写成 `node:` 前缀（仓库其余部分一律如此）。
 */
const NODE_BUILTIN_REFERENCE =
  /\bfrom\s+['"]node:[^'"]*['"]|\bimport\s+['"]node:[^'"]*['"]|\b(?:require|import)\s*\(\s*['"]node:[^'"]*['"]\s*\)/;

describe('src/core 与 vscode 的隔离边界（规格 D6：保留低成本转 LSP 的余地）', () => {
  const files = allTs(CORE_DIR);

  it('确实扫描到了 src/core 下的 .ts 文件——守卫不能在空扫描下形同虚设', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('没有任何文件引用 vscode 模块', () => {
    const offenders = files.filter((f) => VSCODE_REFERENCE.test(readFileSync(f, 'utf8')));

    expect(
      offenders,
      `以下文件引用了 vscode 模块，违反 src/core 边界（唯一允许 import vscode 的地方是 src/vscode/）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('没有任何文件引用 Node 内建模块（node:fs 等）', () => {
    const offenders = files.filter((f) => NODE_BUILTIN_REFERENCE.test(readFileSync(f, 'utf8')));

    expect(
      offenders,
      `以下文件引用了 Node 内建模块，违反 src/core 边界（文件系统访问以谓词注入，见 index/s2r.ts 的 S2rEnv）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
