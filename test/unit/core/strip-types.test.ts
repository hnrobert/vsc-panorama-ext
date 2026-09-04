import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeModule from 'node:module';

declare module 'node:module' {
  /**
   * Node 22.13+ 的实验性 API：对一段源码字符串执行与 CLI 的
   * `--experimental-strip-types` 完全相同的类型擦除变换——遇到 strip-only
   * 模式无法处理、需要真正代码生成的语法（参数属性、enum、
   * namespace/module 等）会按同一套规则抛 SyntaxError，不需要 import()、
   * 不需要把文件真的加载执行、也不需要额外起子进程。
   * `@types/node` 目前锁定在 20.x（见 package.json），还没收录这个
   * 22.x 才有的 API，这里手动补一个最小类型声明，只声明用到的这一个函数。
   */
  export function stripTypeScriptTypes(
    code: string,
    options?: { mode?: 'strip' | 'transform'; sourceMap?: boolean; sourceUrl?: string },
  ): string;
}

/**
 * tools/mine-css-values.mts 经 `node --experimental-strip-types` 运行，而
 * 「仅擦类型」模式不支持参数属性、enum、namespace 这类需要代码生成的语法。
 * gen:values 目前能跑只是因为它的导入链恰好绕开了带这类语法的文件——加一个
 * 导入就会带着报错挂掉。这里直接守住整个 core 目录都不出现这类语法。
 *
 * Fix round 1（复审 Important）：这条守卫原先是两条正则
 * （`/constructor\s*\([^)]*\b(private|public|protected|readonly)\b/s` 与
 * `/^\s*(export\s+)?(const\s+)?(enum|namespace)\s/m`），复审用 Node 实测出
 * 两个真实漏网写法——参数属性不是构造函数第一个参数、且前一个参数的默认值
 * 带函数调用时（`constructor(x: Foo = makeFoo(), private readonly z: string) {}`），
 * `[^)]*` 会被 `makeFoo()` 自己的右括号截断；`module Foo {}`（namespace 的
 * TS 旧写法，非 `declare`）没有被第二条正则的关键字列表覆盖到。两处都经
 * `node --experimental-strip-types` 实测确认真的会 exit 1，正则却判定通过。
 * 正则近似「这份代码能不能被 strip-only 模式跑起来」这件事只会不断有新的
 * 漏网写法冒出来，属于打地鼠——于是这条守卫改成直接测那个真实性质本身。
 *
 * 没有采用「子进程 + 动态 import() 全部文件」这个最初提议的直测写法：
 * `src/core/data/{panels,properties,observed-values}.ts` 都用不带
 * import attribute 的写法引入 JSON（`import x from '../../../data/y.json'`）——
 * 这在 tsc/esbuild 的构建链路下没问题，但 Node 原生 ESM loader 要求 JSON
 * 模块必须带 `with { type: 'json' }`，实测直接 import() 这三个文件会以
 * `Module ".../panels.json" needs an import attribute of "type: json"`
 * 失败——这是一个和参数属性/enum/namespace 完全无关的既有限制，如果不修，
 * 会让「import 全部文件」这条路径对这三个文件永远红、且红的原因文不对题；
 * 如果去修（给三处 JSON import 都加上 import attribute），又是这次改动范围
 * 之外的另一件事。`node:module.stripTypeScriptTypes()` 只做纯语法层面的
 * 擦除变换，不解析、不加载任何 import 目标，天然绕开这个不相关的坑，
 * 同时仍然是 Node 用来实现 `--experimental-strip-types` 的那同一段真实逻辑
 * ——不是别的近似，就是它本身。
 */
const CORE = fileURLToPath(new URL('../../../src/core', import.meta.url));

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (n.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('src/core 与 Node 的 strip-only 类型擦除兼容', () => {
  const files = tsFiles(CORE);

  it('扫描到了文件（防止路径写错导致守卫空过）', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('每个文件都能被 strip-only 模式实际处理（真实执行，不是正则近似）', () => {
    const offenders = files
      .map((f) => {
        try {
          // sourceUrl 用正斜杠：Node 把它当 URL 处理，反斜杠会被静默吞掉，
          // 报错里的路径会变成一坨连在一起、认不出是哪个文件的字符串。
          nodeModule.stripTypeScriptTypes(readFileSync(f, 'utf8'), {
            mode: 'strip',
            sourceUrl: f.replace(/\\/g, '/'),
          });
          return undefined;
        } catch (e) {
          return `${f}\n  ${(e as Error).message}`;
        }
      })
      .filter((x): x is string => x !== undefined);

    expect(
      offenders,
      `以下文件无法被 strip-only 模式实际处理：\n\n${offenders.join('\n\n')}`,
    ).toEqual([]);
  });
});
