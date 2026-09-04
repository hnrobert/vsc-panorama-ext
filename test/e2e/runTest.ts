import { resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * 启动一个真实的 VSCode，加载本扩展，在 examples/ 工作区里跑集成测试。
 *
 * 这一层存在的理由只有一个：`insertText` 与语言 wordPattern 派生的替换区间
 * 之间的交互，单元测试的 vscode mock 无法建模。补全接受后缓冲区到底变成
 * 什么样，只有真编辑器能回答。
 */
async function main(): Promise<void> {
  // 本文件被编译到 out-e2e/runTest.cjs，仓库根在其上一级
  const repoRoot = resolve(__dirname, '..');

  await runTests({
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: resolve(__dirname, 'suite', 'index.cjs'),
    launchArgs: [
      resolve(repoRoot, 'examples'),
      '--disable-extensions', // 只留被测扩展，避免别的扩展往补全列表里塞东西
      '--disable-gpu',
    ],
  });
}

main().catch((err) => {
  console.error('E2E 运行失败：', err);
  process.exit(1);
});
