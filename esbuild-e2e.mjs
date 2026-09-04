import esbuild from 'esbuild';

/**
 * 把 E2E 测试转译成 CJS —— VSCode 的扩展测试主机以 CommonJS 加载它们。
 *
 * 这里刻意不 bundle：suite/index 要用 mocha 的 addFile 按路径加载
 * extension.test.cjs，打包成一个文件就没有那个路径了。
 */
await esbuild.build({
  entryPoints: [
    'test/e2e/runTest.ts',
    'test/e2e/suite/index.ts',
    'test/e2e/suite/extension.test.ts',
  ],
  outdir: 'out-e2e',
  outbase: 'test/e2e',
  bundle: false,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  outExtension: { '.js': '.cjs' },
  logLevel: 'info',
});
