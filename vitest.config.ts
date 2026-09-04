import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // E2E 用的是 mocha 的 tdd 接口（suite/test 全局），由真实 VSCode 的
    // 扩展测试主机执行，不能被 vitest 收集。见 npm run test:e2e。
    exclude: ['test/e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      // 适配层测试用的最小 vscode mock；core 层禁止 import 'vscode'，不受影响
      vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)),
    },
  },
});
