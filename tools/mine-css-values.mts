import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE } from './paths.mjs';
import { DECOMPILER_ARTIFACTS, mineValues } from '../src/core/data/mine.ts';

function allCss(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allCss(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

const styleDir = `${ARCHIVE}/20260829/panorama/styles`;
const files = allCss(styleDir);
const data = mineValues(files.map((f) => readFileSync(f, 'utf8')));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../data/vcss-observed-values.json');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      source: `从 ${files.length} 个真实样式表挖掘（弱可靠：语料里出现过 != 引擎支持）`,
      excluded: DECOMPILER_ARTIFACTS,
      values: data,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`已写出 ${out}\n  覆盖 ${Object.keys(data).length} 个属性`);
