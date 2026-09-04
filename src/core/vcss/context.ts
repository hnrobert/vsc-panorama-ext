import type { VcssDocument } from './ast';

export type VcssContext =
  | { kind: 'selector'; prefix: string; /** prefix 首字符在文档中的绝对偏移 */ prefixStart: number }
  | { kind: 'propertyName'; prefix: string }
  | { kind: 'propertyValue'; property: string; prefix: string }
  | { kind: 'atRule'; prefix: string }
  | { kind: 'none' };

export type VcssHoverTarget =
  | { kind: 'property'; name: string; start: number; end: number }
  | { kind: 'define'; name: string; start: number; end: number }
  | { kind: 'function'; name: string; start: number; end: number }
  | { kind: 'none' };

/** 光标是否落在注释或字符串内部——这两处不应给补全 */
function inTrivia(text: string, offset: number): boolean {
  let i = 0;
  while (i < offset) {
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      // 已闭合的注释用严格小于；未闭合的注释用包含，因为光标在EOF仍在注释内
      if (close === -1) {
        if (offset <= text.length) return true;
      } else {
        if (offset < close + 2) return true;
      }
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j++;
      if (offset <= j) return true;
      i = j + 1;
      continue;
    }
    i++;
  }
  return false;
}

/** 统计 offset 之前未闭合的 '{' 数量（跳过注释与字符串） */
function braceDepth(text: string, offset: number): number {
  let depth = 0;
  let i = 0;
  while (i < offset) {
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? offset : close + 2;
      continue;
    }
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j++;
      i = j + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  return depth;
}

const WORD_BEFORE = /([-\w]*)$/;

export function contextAt(doc: VcssDocument, offset: number): VcssContext {
  const text = doc.text;
  if (inTrivia(text, offset)) return { kind: 'none' };

  const before = text.slice(0, offset);

  // at-rule：本行以 @ 开头的记号。
  // 前面必须不是单词字符——否则 url(a@b 这类取值里嵌的 @ 也会被下面的
  // [-\w]* 从末尾贪婪地捞出来匹配成 at-rule（例如 url(a@b| 会被误判成
  // 前缀 '@b' 的 at-rule，抢在 propertyValue 之前），而它显然不是一个
  // 独立的、位于记号开头的 @。
  const atMatch = /(?<![-\w])(@[-\w]*)$/.exec(before);
  if (atMatch) return { kind: 'atRule', prefix: atMatch[1] };

  if (braceDepth(text, offset) === 0) {
    const sel = /([^{};]*)$/.exec(before)?.[1] ?? '';
    // 不能用 sel.trim()：trim 连尾随空白也削掉，一旦削掉，prefix 就不再是
    // 「以 offset 结尾的 before 后缀」，用长度反推起点会算错——'.btn: '
    // （冒号后跟一个空格，光标停在末尾）会把 prefix 削成 '.btn:'，反推出的
    // prefixStart 往后错位一位，指向那个空格而不是冒号；下游伪类分支用它
    // 切出的区间覆盖的是空格，插入完整 label 后产生双冒号——本任务原本要
    // 根除的失效模式原样复发（评审用真实 contextAt() 复现，见
    // task-9-report.md「Fix round 1」）。
    //
    // trimStart 只削前导空白，prefix 的末尾永远等于 sel 的末尾、也就是
    // offset，长度反推起点因此总是成立。副作用是尾随空白时 prefix 不再以
    // 冒号 / 类名 / id 结尾——这是期望行为：CSS 里冒号与伪类名之间、
    // 选择器片段与后面内容之间都不允许有空格，这个位置本就不该补出候选。
    const prefix = sel.trimStart();
    return { kind: 'selector', prefix, prefixStart: offset - prefix.length };
  }

  // 块内：从上一个 ; { } 起看有没有冒号
  const segStart = Math.max(
    before.lastIndexOf(';'),
    before.lastIndexOf('{'),
    before.lastIndexOf('}'),
  );
  const segment = before.slice(segStart + 1);
  const colon = segment.indexOf(':');

  if (colon === -1) {
    return { kind: 'propertyName', prefix: WORD_BEFORE.exec(segment)?.[1] ?? '' };
  }

  return {
    kind: 'propertyValue',
    property: segment.slice(0, colon).trim(),
    prefix: WORD_BEFORE.exec(segment)?.[1] ?? '',
  };
}

export function hoverTargetAt(doc: VcssDocument, offset: number): VcssHoverTarget {
  const text = doc.text;

  // @define 定义处
  for (const d of doc.defines) {
    if (offset >= d.nameStart && offset <= d.nameEnd) {
      return { kind: 'define', name: d.name, start: d.nameStart, end: d.nameEnd };
    }
  }

  // 声明的属性名
  const allRules = [...doc.rules, ...doc.keyframes.map((k) => k.rule)];
  for (const rule of allRules) {
    for (const r of [rule, ...rule.children]) {
      for (const decl of r.declarations) {
        if (offset >= decl.propertyStart && offset <= decl.propertyEnd) {
          return {
            kind: 'property',
            name: decl.property,
            start: decl.propertyStart,
            end: decl.propertyEnd,
          };
        }
      }
    }
  }

  // 光标所在的标识符：可能是函数名或 @define 引用
  let s = offset;
  while (s > 0 && /[-\w]/.test(text[s - 1])) s--;
  let e = offset;
  while (e < text.length && /[-\w]/.test(text[e])) e++;
  const word = text.slice(s, e);
  if (!word) return { kind: 'none' };

  if (text[e] === '(') return { kind: 'function', name: word, start: s, end: e };
  if (doc.defines.some((d) => d.name === word)) {
    return { kind: 'define', name: word, start: s, end: e };
  }

  return { kind: 'none' };
}
