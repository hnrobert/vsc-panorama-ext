import { resolve } from 'node:path';
import Mocha from 'mocha';

/** VSCode 扩展主机调用的入口。返回的 Promise 决定整个 E2E 的成败。 */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30_000 });
  mocha.addFile(resolve(__dirname, 'extension.test.cjs'));

  return new Promise((res, rej) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) rej(new Error(`${failures} 个 E2E 用例失败`));
        else res();
      });
    } catch (err) {
      rej(err);
    }
  });
}
