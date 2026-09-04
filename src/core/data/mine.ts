// 显式 .ts 扩展名：本模块会被 tools/mine-css-values.mts 经 Node 原生 ESM 加载，
// 而 Node 要求相对导入带扩展名。其余 core 模块无此约束。
import { parseVcss } from '../vcss/parser.ts';

/**
 * 已知的反编译器产物：Source 2 Viewer 给某些枚举值起的标签，
 * 在 panorama.dll 里查无此字符串，不是引擎关键字。
 * 挖掘数据若不排除它们，就会主动给出错误的补全建议（规格 §5.3）。
 */
export const DECOMPILER_ARTIFACTS: readonly string[] = Object.freeze(['clip_then_cover']);

const ARTIFACTS = new Set(DECOMPILER_ARTIFACTS);
/** 只收单个裸标识符 */
const BARE_KEYWORD = /^-?[a-zA-Z][\w-]*$/;

export interface MinedValue {
  readonly value: string;
  readonly count: number;
}

/**
 * 从 VCSS 源码中按属性收集「关键字型」取值。
 * 颜色、数字、字符串、url()、函数调用、多词取值一律不收；
 * 语料里任何一个文件声明过的 @define 名也一律不收——Panorama 的 @define
 * 引用没有 `$` 之类的前缀，与关键字在语法形状上完全相同，但它只在声明它的
 * 文件里有意义，原样当关键字推荐给用户会产出无法解析的代码（规格 §5.3）。
 */
export function mineValues(sources: readonly string[]): Record<string, MinedValue[]> {
  const docs = sources.map(parseVcss);

  // 第一遍：跨全部来源收集出现过的 @define 名，不分文件——
  // 用户文件里可能引用任何一个来源文件定义的常量，所以排除集必须是全局的。
  const defineNames = new Set<string>();
  for (const doc of docs) {
    for (const def of doc.defines) defineNames.add(def.name);
  }

  // 第二遍：按属性统计取值，排除反编译器产物与 @define 名
  const counts: Record<string, Map<string, number>> = {};
  for (const doc of docs) {
    const rules = [...doc.rules, ...doc.keyframes.map((k) => k.rule)];
    for (const rule of rules) {
      for (const r of [rule, ...rule.children]) {
        for (const d of r.declarations) {
          const v = d.value.trim();
          if (!BARE_KEYWORD.test(v) || ARTIFACTS.has(v) || defineNames.has(v)) continue;
          const m = (counts[d.property] ??= new Map());
          m.set(v, (m.get(v) ?? 0) + 1);
        }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prop, m]) => [
        prop,
        [...m.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((x, y) => y.count - x.count || x.value.localeCompare(y.value)),
      ]),
  );
}
