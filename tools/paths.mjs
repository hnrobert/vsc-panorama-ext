// 解包库路径统一在此注入。仓库内既不提交 Valve 原始资源，也不硬编码任何本机路径。
//
// 三级来源，优先级从高到低：
//   1. PANORAMA_ARCHIVE 环境变量
//   2. tools/.archive-path —— 本机私有的一行文本，已 gitignore
//   3. 空字符串 —— 语料闸门据此判定归档不可用，跳过需要归档的用例，
//      而无条件断言照常执行。**不要改成抛异常**：那会让整份测试在收集期崩掉，
//      正是 M4 花了一个任务才修好的那个坑。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function localArchivePath() {
  const f = join(dirname(fileURLToPath(import.meta.url)), '.archive-path');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}

export const ARCHIVE = process.env.PANORAMA_ARCHIVE ?? localArchivePath();
export const XSD_PATH =
  process.env.PANORAMA_XSD ??
  (ARCHIVE ? `${ARCHIVE}/20260829/panorama_generate_layout_xsd.txt` : '');
