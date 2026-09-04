import type { VxmlAttribute, VxmlDocument, VxmlElement } from './ast';

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_.:-]/;

/**
 * 容错的 VXML 解析器。任何畸形输入都不抛异常——编辑器里光标处几乎总是
 * 半成品，解析必须在残缺状态下仍产出可用的树。
 */
export function parseVxml(text: string): VxmlDocument {
  const roots: VxmlElement[] = [];
  const stack: VxmlElement[] = [];
  let i = 0;

  const top = (): VxmlElement | undefined => stack[stack.length - 1];

  const push = (el: VxmlElement) => {
    const parent = top();
    if (parent) {
      el.parent = parent;
      parent.children.push(el);
    } else {
      roots.push(el);
    }
  };

  const closeTo = (tag: string, endOffset: number) => {
    // 从栈顶向下找同名开始标签；找不到就整体忽略这个闭合标签
    const idx = stack.map((e) => e.tag).lastIndexOf(tag);
    if (idx === -1) return;
    for (let k = stack.length - 1; k >= idx; k--) {
      stack[k].end = endOffset;
    }
    stack.length = idx;
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    // 注释 / CDATA / 处理指令：整段跳过，不产生元素
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      i = close === -1 ? text.length : close + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const close = text.indexOf(']]>', lt + 9);
      i = close === -1 ? text.length : close + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const close = text.indexOf('?>', lt + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }

    // 闭合标签
    if (text[lt + 1] === '/') {
      let p = lt + 2;
      const nameStart = p;
      while (p < text.length && NAME_CHAR.test(text[p])) p++;
      const tag = text.slice(nameStart, p);
      const gt = text.indexOf('>', p);
      const endOffset = gt === -1 ? text.length : gt + 1;
      closeTo(tag, endOffset);
      i = endOffset;
      continue;
    }

    // 开始标签
    if (!NAME_START.test(text[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }

    let p = lt + 1;
    const tagNameStart = p;
    while (p < text.length && NAME_CHAR.test(text[p])) p++;
    const tagNameEnd = p;
    const tag = text.slice(tagNameStart, tagNameEnd);

    const attributes: VxmlAttribute[] = [];
    let selfClosing = false;
    let unclosed = true;
    let openEnd = -1;

    while (p < text.length) {
      while (p < text.length && /\s/.test(text[p])) p++;
      if (p >= text.length) break;

      if (text[p] === '>') {
        openEnd = p + 1;
        unclosed = false;
        p++;
        break;
      }
      if (text[p] === '/' && text[p + 1] === '>') {
        selfClosing = true;
        openEnd = p + 2;
        unclosed = false;
        p += 2;
        break;
      }
      if (text[p] === '<') break; // 上一个标签没写完，就此打住

      if (!NAME_START.test(text[p])) {
        p++;
        continue;
      }

      const nameStart = p;
      while (p < text.length && NAME_CHAR.test(text[p])) p++;
      const nameEnd = p;
      const name = text.slice(nameStart, nameEnd);

      let q = p;
      while (q < text.length && /\s/.test(text[q])) q++;
      if (text[q] !== '=') {
        attributes.push({ name, nameStart, nameEnd, unterminated: false });
        continue;
      }

      q++; // 跳过 '='
      while (q < text.length && /\s/.test(text[q])) q++;
      const quote = text[q];
      if (quote !== '"' && quote !== "'") {
        // 只写到 `name=`，值还没开始
        attributes.push({ name, nameStart, nameEnd, unterminated: false });
        p = q;
        continue;
      }

      const valueStart = q + 1;
      let r = valueStart;
      while (r < text.length && text[r] !== quote && text[r] !== '\n') r++;
      const closed = text[r] === quote;
      attributes.push({
        name,
        nameStart,
        nameEnd,
        value: text.slice(valueStart, r),
        valueStart,
        valueEnd: r,
        unterminated: !closed,
      });
      p = closed ? r + 1 : r;
    }

    const el: VxmlElement = {
      tag,
      tagStart: lt,
      tagNameStart,
      tagNameEnd,
      openEnd,
      end: selfClosing && openEnd !== -1 ? openEnd : text.length,
      selfClosing,
      unclosed,
      attributes,
      children: [],
    };
    push(el);
    if (!selfClosing) stack.push(el);

    i = Math.max(p, lt + 1);
  }

  // 仍在栈上的元素都未闭合，一律延伸到文档末尾
  for (const el of stack) el.end = text.length;

  return { roots, text };
}
