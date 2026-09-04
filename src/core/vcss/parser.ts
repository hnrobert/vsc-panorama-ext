import type {
  VcssDeclaration,
  VcssDefine,
  VcssDocument,
  VcssImport,
  VcssKeyframes,
  VcssRule,
} from './ast';

/** 从 i 起跳过空白与注释，返回新位置 */
function skipTrivia(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    return i;
  }
}

/**
 * 从 i 起扫描到分隔符，跳过字符串内部与注释。
 * 用于取 @define 的值、声明的值、选择器等——它们可能含 gradient(a, b) 这类
 * 嵌套结构，也可能含 "ui;click" 这类带分号的字符串。
 *
 * 不对括号做深度跟踪（Task 3b 之前的实现跟踪过，已移除）：本函数目前所有
 * 调用点用的 stops 只会是 `:` `;` `{` `}` `\n` 的组合，而这几个字符在合法、
 * 括号配平的 VCSS 取值里——不论 gradient(...)、rgba(...) 还是任意深度的
 * 嵌套函数调用——从不会出现在括号内部（参数只用逗号与空格分隔）。也就是说
 * 深度跟踪对格式正确的输入从未起过任何实际作用；它唯一观测得到的效果，是
 * 输入本身括号不配平时的行为——而这恰恰是它出问题的地方：深度一旦大于 0
 * 就再也不认识任何停止符，会一路扫到文件尾都补不平，把光标之后的整份文档
 * 从解析结果里吞掉。真实语料里每个构建各有 7 个反编译产物文件命中过这个
 * 盲区（`gradient(` 缺右括号一类的真实语法缺陷，详见 task-3b-report.md），
 * 代价是整条规则链——补全、颜色装饰、文档符号、跳转、诊断——同时对光标
 * 之后的内容失效。
 *
 * 去掉深度跟踪后，任一停止符只要出现（且不在字符串或注释内）就立即停止，
 * 与括号是否配平无关：格式正确的输入不受影响（深度跟踪原本就没有为它们
 * 改变过行为），格式错误的输入则不再无界吞噬——一个未闭合的 `(` 最坏情况
 * 也只吞到下一个真实存在的停止符为止。
 */
function scanValue(text: string, i: number, stops: string): number {
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote && text[i] !== '\n') i++;
      i = Math.min(i + 1, text.length);
      continue;
    }
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    if (stops.includes(c)) return i;
    i++;
  }
  return i;
}

/** 解析一个 '{' 开头的块。返回块本身与结束后的位置。 */
function parseBlock(text: string, braceAt: number, selector: string, selStart: number, selEnd: number): { rule: VcssRule; next: number } {
  const rule: VcssRule = {
    selector,
    selectorStart: selStart,
    selectorEnd: selEnd,
    blockStart: braceAt,
    blockEnd: -1,
    declarations: [],
    children: [],
  };

  let i = braceAt + 1;
  for (;;) {
    i = skipTrivia(text, i);
    if (i >= text.length) break;

    if (text[i] === '}') {
      rule.blockEnd = i;
      i++;
      break;
    }

    // 嵌套块：先扫到 '{' 或 ';' 或 '}'，命中 '{' 说明是子块
    const start = i;
    const stop = scanValue(text, i, ':;{}');
    if (text[stop] === '{') {
      const raw = text.slice(start, stop);
      const inner = parseBlock(text, stop, raw.trim(), start, start + raw.trimEnd().length);
      rule.children.push(inner.rule);
      i = inner.next;
      continue;
    }

    if (text[stop] !== ':') {
      // 既不是声明也不是子块（例如多余的 ';'），跳过
      i = stop + 1;
      continue;
    }

    const property = text.slice(start, stop).trim();
    const propertyStart = start + (text.slice(start, stop).length - text.slice(start, stop).trimStart().length);
    const valueStart = skipTrivia(text, stop + 1);
    const valueEnd = scanValue(text, valueStart, ';}');
    const rawValue = text.slice(valueStart, valueEnd);
    const trimmedValue = rawValue.trim();
    const adjustedValueEnd = valueStart + rawValue.trimEnd().length;
    const decl: VcssDeclaration = {
      property,
      propertyStart,
      propertyEnd: propertyStart + property.length,
      value: trimmedValue,
      valueStart,
      valueEnd: adjustedValueEnd,
    };
    if (property) rule.declarations.push(decl);
    i = text[valueEnd] === ';' ? valueEnd + 1 : valueEnd;
  }

  return { rule, next: i };
}

/** 容错的 VCSS 解析器。畸形输入一律不抛异常。 */
export function parseVcss(text: string): VcssDocument {
  const defines: VcssDefine[] = [];
  const imports: VcssImport[] = [];
  const keyframes: VcssKeyframes[] = [];
  const rules: VcssRule[] = [];

  let i = 0;
  while (i < text.length) {
    i = skipTrivia(text, i);
    if (i >= text.length) break;

    if (text.startsWith('@define', i)) {
      const nameStart = skipTrivia(text, i + 7);
      let p = nameStart;
      while (p < text.length && /[\w-]/.test(text[p])) p++;
      const nameEnd = p;
      p = skipTrivia(text, p);
      if (text[p] === ':') {
        const valueStart = skipTrivia(text, p + 1);
        // @define 漏分号时以换行兜底，避免吞掉后续内容
        const valueEnd = scanValue(text, valueStart, ';\n');
        const rawValue = text.slice(valueStart, valueEnd);
        const trimmedValue = rawValue.trim();
        const adjustedValueEnd = valueStart + rawValue.trimEnd().length;
        const name = text.slice(nameStart, nameEnd);
        // 空名字（如 `@define : #fff;`）不记录——与下面声明路径的
        // `if (property)` 守卫保持一致，没有名字的常量无法被引用或补全。
        if (name) {
          defines.push({
            name,
            nameStart,
            nameEnd,
            value: trimmedValue,
            valueStart,
            valueEnd: adjustedValueEnd,
          });
        }
        i = text[valueEnd] === ';' ? valueEnd + 1 : valueEnd;
      } else {
        i = nameEnd;
      }
      continue;
    }

    if (text.startsWith('@import', i)) {
      const end = scanValue(text, i + 7, ';');
      const m = /url\(\s*["']([^"']*)["']\s*\)/.exec(text.slice(i, end));
      if (m) {
        const targetStart = i + text.slice(i, end).indexOf(m[1]);
        imports.push({ target: m[1], targetStart, targetEnd: targetStart + m[1].length });
      }
      i = text[end] === ';' ? end + 1 : end;
      continue;
    }

    if (text.startsWith('@keyframes', i)) {
      const nameStart = skipTrivia(text, i + 10);
      const quote = text[nameStart];
      const quoted = quote === '"' || quote === "'";
      let p = quoted ? nameStart + 1 : nameStart;
      while (p < text.length && text[p] !== '\n' && (quoted ? text[p] !== quote : /[\w-]/.test(text[p]))) p++;
      // 带引号的名字若在换行处停止则表示未找到闭合引号，跳过此 @keyframes
      if (quoted && (p >= text.length || text[p] === '\n')) {
        i = p;
        continue;
      }
      const name = text.slice(quoted ? nameStart + 1 : nameStart, p);
      const nameEnd = quoted ? Math.min(p + 1, text.length) : p;

      const brace = text.indexOf('{', nameEnd);
      if (brace === -1) {
        i = nameEnd;
        continue;
      }
      const { rule, next } = parseBlock(text, brace, name, nameStart, nameEnd);
      keyframes.push({ name, quoted, nameStart, nameEnd, rule });
      i = next;
      continue;
    }

    // 普通规则：选择器一直扫到 '{'
    const selStart = i;
    const stop = scanValue(text, i, '{};');
    if (text[stop] !== '{') {
      i = stop + 1;
      continue;
    }
    const raw = text.slice(selStart, stop);
    const { rule, next } = parseBlock(text, stop, raw.trim(), selStart, selStart + raw.trimEnd().length);
    rules.push(rule);
    i = next;
  }

  return { defines, imports, keyframes, rules, text };
}
