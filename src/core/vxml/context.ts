import type { VxmlDocument, VxmlElement } from './ast';

/**
 * 结构位置。规格 §9.1 的标签/属性补全规则完全依赖它，
 * 必须由解析层提供，不能让 provider 去猜。
 */
export type TagSlot =
  | 'rootHeader' // <root> 内、根面板之前 —— 可出现 styles / scripts / snippets
  | 'rootPanel' // 根面板自身 —— 可用 245 种类型，且禁止 id
  | 'child' // 嵌套子元素 —— 只可用 202 种类型
  | 'outside'; // <root> 之外

export type VxmlContext =
  | { kind: 'tagName'; prefix: string; slot: TagSlot; existingStructural: string[] }
  | { kind: 'attributeName'; tag: string; prefix: string; existing: string[]; slot: TagSlot }
  | {
      kind: 'attributeValue';
      tag: string;
      attribute: string;
      value: string;
      /** 光标相对属性值起点的偏移，用于切出 class="a b c" 中当前那个类名 */
      valueOffset: number;
      /** 属性值首字符在文档中的绝对偏移，用于算补全替换区间（文档绝对偏移） */
      valueStart: number;
      /** 同文件 <snippets> 下定义的片段名 */
      snippetNames?: string[];
    }
  | { kind: 'text' }
  | { kind: 'none' };

export type VxmlHoverTarget =
  | { kind: 'tag'; name: string; start: number; end: number }
  | { kind: 'attribute'; tag: string; name: string; start: number; end: number }
  | { kind: 'none' };

const STRUCTURAL = new Set(['styles', 'scripts', 'snippets']);

function* walk(elements: readonly VxmlElement[]): Generator<VxmlElement> {
  for (const el of elements) {
    yield el;
    yield* walk(el.children);
  }
}

/** 找到包含该偏移的最深元素 */
function deepestAt(doc: VxmlDocument, offset: number): VxmlElement | undefined {
  let found: VxmlElement | undefined;
  for (const el of walk(doc.roots)) {
    if (offset >= el.tagStart && offset <= el.end) found = el;
  }
  return found;
}

/**
 * 光标是否落在某元素的开始标签内部（'<' 之后、'>' 之前）。
 *
 * 开始标签已闭合时必须用严格小于：openEnd 指向 '>' 之后的位置，
 * 光标停在那里已经是标签外的文本区了（`<root>|</root>` 属于 text 而非 attributeName）。
 * 开始标签未闭合（编辑中途）时没有 '>'，取到末尾才能让 `<Pa|` 拿到标签名上下文。
 */
function inOpenTag(el: VxmlElement, offset: number): boolean {
  if (offset <= el.tagStart) return false;
  return el.openEnd === -1 ? offset <= el.end : offset < el.openEnd;
}

/** 元素自身处于哪个结构位置 */
function slotOfElement(el: VxmlElement): TagSlot {
  const parent = el.parent;
  if (!parent) return 'outside';
  if (parent.tag !== 'root') return 'child';
  if (STRUCTURAL.has(el.tag)) return 'rootHeader';
  // root 的第一个非结构性子元素即根面板
  const firstPanel = parent.children.find((c) => !STRUCTURAL.has(c.tag));
  return firstPanel === el ? 'rootPanel' : 'child';
}

/** 一个「尚未成形」的新标签若插在此处，属于哪个结构位置 */
function slotOfPosition(doc: VxmlDocument, offset: number): TagSlot {
  const container = containerAt(doc, offset);
  if (!container) return 'outside';
  if (container.tag !== 'root') return 'child';
  // root 直接子级：看此位置之前是否已存在根面板
  const hasPanelBefore = container.children.some(
    (c) => !STRUCTURAL.has(c.tag) && c.end <= offset && c.tagStart < offset,
  );
  return hasPanelBefore ? 'child' : 'rootHeader';
}

/** 包含该偏移、且光标位于其标签体内部的最深元素（即「父容器」） */
function containerAt(doc: VxmlDocument, offset: number): VxmlElement | undefined {
  let found: VxmlElement | undefined;
  for (const el of walk(doc.roots)) {
    if (el.selfClosing) continue;
    const bodyStart = el.openEnd === -1 ? el.end : el.openEnd;
    if (offset >= bodyStart && offset <= el.end) found = el;
  }
  return found;
}

/**
 * 若此处新标签插在 <root> 直接下面，已出现过哪些结构元素（规格 §9.1 去重用）。
 *
 * 必须排除掉光标当前正在输入的那个元素自身：容错解析器会把还没打完/没闭合的
 * 标签也当成真实子元素提前放进 container.children，一旦它的标签名凑巧完整
 * 拼出某个结构元素名（比如敲完 "<styles" 的那一刻——STRUCTURAL 是精确匹配，
 * 敲到一半的 "sty" 不会命中，只有敲完整个词才会），它就会被当成"已存在的
 * 兄弟"把自己从候选里滤掉，越接近敲对，越补不出来。
 *
 * 排除要按位置（tagStart）判定，不能按名字：调用方传入的 offset 就是被排查的
 * 这个"自身"元素的 tagStart（两处调用点都与同一次调用里 slotOfPosition 用的
 * 锚点一致），直接排除 tagStart 等于 offset 的子元素即可。按名字排除则会把
 * "已经有一个真的 <styles>、用户在别处又敲 <sty" 这种确实该去重的情形也一起
 * 放过——同一个名字可能同时对应"早就存在的另一个元素"和"光标所在的这一个"，
 * 只有位置能把两者分开。
 */
function structuralSiblings(doc: VxmlDocument, offset: number): string[] {
  const container = containerAt(doc, offset);
  if (!container || container.tag !== 'root') return [];
  return container.children
    .filter((c) => c.tagStart !== offset && STRUCTURAL.has(c.tag))
    .map((c) => c.tag);
}

/** 同文件 <snippets> 下所有 <snippet name="..."> 定义的名字 */
function snippetNames(doc: VxmlDocument): string[] {
  const out: string[] = [];
  for (const root of doc.roots) {
    for (const child of root.children) {
      if (child.tag !== 'snippets') continue;
      for (const s of child.children) {
        if (s.tag !== 'snippet') continue;
        const n = s.attributes.find((a) => a.name === 'name')?.value;
        if (n) out.push(n);
      }
    }
  }
  return out;
}

export function contextAt(doc: VxmlDocument, offset: number): VxmlContext {
  const text = doc.text;
  const el = deepestAt(doc, offset);

  if (el && inOpenTag(el, offset)) {
    // 光标在标签名范围内（含刚好在末尾）
    if (offset >= el.tagNameStart && offset <= el.tagNameEnd) {
      return {
        kind: 'tagName',
        prefix: text.slice(el.tagNameStart, offset),
        slot: slotOfPosition(doc, el.tagStart),
        existingStructural: structuralSiblings(doc, el.tagStart),
      };
    }

    // 光标在某个属性值的引号内
    for (const a of el.attributes) {
      if (a.valueStart !== undefined && a.valueEnd !== undefined) {
        if (offset >= a.valueStart && offset <= a.valueEnd) {
          return {
            kind: 'attributeValue',
            tag: el.tag,
            attribute: a.name,
            value: a.value ?? '',
            valueOffset: offset - a.valueStart,
            valueStart: a.valueStart,
            snippetNames: snippetNames(doc),
          };
        }
      }
    }

    // 否则视作在写属性名
    const before = text.slice(el.tagNameEnd, offset);
    const prefix = /([A-Za-z_][A-Za-z0-9_.:-]*)$/.exec(before)?.[1] ?? '';
    return {
      kind: 'attributeName',
      tag: el.tag,
      prefix,
      existing: el.attributes.map((a) => a.name).filter((n) => n !== prefix),
      slot: slotOfElement(el),
    };
  }

  // 不在任何标签体内：可能是刚敲下 '<'（此时解析不出元素）
  const lt = text.lastIndexOf('<', offset - 1);
  if (lt !== -1) {
    const between = text.slice(lt + 1, offset);
    if (/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(between) || between === '') {
      return {
        kind: 'tagName',
        prefix: between,
        slot: slotOfPosition(doc, lt),
        existingStructural: structuralSiblings(doc, lt),
      };
    }
  }

  if (doc.roots.length === 0) return { kind: 'none' };
  return containerAt(doc, offset) ? { kind: 'text' } : { kind: 'none' };
}

export function hoverTargetAt(doc: VxmlDocument, offset: number): VxmlHoverTarget {
  const el = deepestAt(doc, offset);
  if (!el) return { kind: 'none' };

  if (offset >= el.tagNameStart && offset <= el.tagNameEnd) {
    return { kind: 'tag', name: el.tag, start: el.tagNameStart, end: el.tagNameEnd };
  }

  for (const a of el.attributes) {
    if (offset >= a.nameStart && offset <= a.nameEnd) {
      return { kind: 'attribute', tag: el.tag, name: a.name, start: a.nameStart, end: a.nameEnd };
    }
  }

  return { kind: 'none' };
}
