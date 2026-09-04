import type { VxmlDocument, VxmlElement } from '../vxml/ast';
import type { VcssDocument, VcssRule } from '../vcss/ast';

export interface SymbolRef {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface ResourceRef {
  readonly target: string;
  readonly start: number;
  readonly end: number;
}

/**
 * 一个文件抽出的全部跨文件相关符号。索引只存这一层，不存 AST——
 * AST 随每次编辑重建，符号表才是跨文件查询要的东西。
 */
export interface FileSymbols {
  readonly uri: string;
  readonly kind: 'vxml' | 'vcss';
  /** 类名的定义处：VCSS 选择器里的 .name */
  readonly classDefs: SymbolRef[];
  /** 类名的使用处：VXML 的 class 属性 */
  readonly classRefs: SymbolRef[];
  /** id 的定义处：VXML 的 id 属性 */
  readonly idDefs: SymbolRef[];
  /** id 的使用处：VCSS 选择器里的 #name */
  readonly idRefs: SymbolRef[];
  readonly defineDefs: SymbolRef[];
  /**
   * 声明值里出现的裸标识符——是不是真的引用了某个 @define 常量，这里不判定，
   * 只收候选。抽取只看得到当前这一个文件，而常量可能定义在另一个文件里
   * （csgostyles.css 的 119 个 @define 到处被 @import 就是这么用的）；拿单文件
   * 视野去过滤跨文件才能判定的东西，会把真引用提前丢光，索引层再怎么合并
   * 各文件的符号表也拿不回来。真正的判定放到查询时按名字反查：没人
   * @define 过 `right`，就没人会去查 `defineReferences('right')`，噪音自然
   * 被过滤。已跳过引号包裹的片段（字符串 / url() 内容不算标识符）。
   */
  readonly defineRefs: SymbolRef[];
  readonly keyframeDefs: SymbolRef[];
  readonly keyframeRefs: SymbolRef[];
  /** <include src> 与 @import —— 决定「哪些样式表对这个布局可见」 */
  readonly includes: ResourceRef[];
  /** 其它资源引用：Image 的 src 等 */
  readonly resources: ResourceRef[];
  /** {s:x} / {d:x} / {g:x} / {t:x}，name 含前缀本身 */
  readonly bindings: SymbolRef[];
}

function empty(uri: string, kind: 'vxml' | 'vcss'): FileSymbols {
  return {
    uri,
    kind,
    classDefs: [],
    classRefs: [],
    idDefs: [],
    idRefs: [],
    defineDefs: [],
    defineRefs: [],
    keyframeDefs: [],
    keyframeRefs: [],
    includes: [],
    resources: [],
    bindings: [],
  };
}

function* walkElements(els: readonly VxmlElement[]): Generator<VxmlElement> {
  for (const el of els) {
    yield el;
    yield* walkElements(el.children);
  }
}

const BINDING_RE = /\{([sdgt]:[^}]*)\}/g;

export function symbolsOfVxml(uri: string, doc: VxmlDocument): FileSymbols {
  const s = empty(uri, 'vxml');

  for (const el of walkElements(doc.roots)) {
    for (const attr of el.attributes) {
      if (attr.value === undefined || attr.valueStart === undefined) continue;
      const base = attr.valueStart;

      if (attr.name === 'class') {
        // 逐个类名切出各自区间，供跳转与引用精确定位
        const re = /[^\s]+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(attr.value)) !== null) {
          s.classRefs.push({ name: m[0], start: base + m.index, end: base + m.index + m[0].length });
        }
      } else if (attr.name === 'id') {
        s.idDefs.push({ name: attr.value, start: base, end: base + attr.value.length });
      }

      if (attr.name === 'src') {
        const bucket = el.tag === 'include' ? s.includes : s.resources;
        bucket.push({ target: attr.value, start: base, end: base + attr.value.length });
      }

      BINDING_RE.lastIndex = 0;
      let b: RegExpExecArray | null;
      while ((b = BINDING_RE.exec(attr.value)) !== null) {
        s.bindings.push({
          name: b[1],
          start: base + b.index + 1,
          end: base + b.index + 1 + b[1].length,
        });
      }
    }
  }

  return s;
}

/** 从选择器文本里切出 .class 与 #id，偏移相对整份文档 */
function scanSelector(selector: string, base: number, s: FileSymbols): void {
  const re = /([.#])([A-Za-z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) {
    // 伪类以 : 开头，不会命中本正则；但 .a:hover 里的 .a 会正确命中
    const ref = {
      name: m[2],
      start: base + m.index + 1,
      end: base + m.index + 1 + m[2].length,
    };
    if (m[1] === '.') s.classDefs.push(ref);
    else s.idRefs.push(ref);
  }
}

/**
 * @define 引用候选：声明值里跳过引号片段之后的裸标识符（组 1）。
 * 引号片段本身作为一个整体匹配掉、不进组 1，效果是整段跳过——
 * background-image: url("blue.png") 里的 blue 不会被当成候选。
 */
const DEFINE_CANDIDATE_RE = /'[^']*'|"[^"]*"|([A-Za-z_][\w-]*)/g;
/** animation-name 的一段：带引号的字符串（组 1/2 为去引号内容）或裸标识符 */
const ANIM_NAME_RE = /'([^']*)'|"([^"]*)"|[A-Za-z_][\w-]*/g;

export function symbolsOfVcss(uri: string, doc: VcssDocument): FileSymbols {
  const s = empty(uri, 'vcss');

  for (const d of doc.defines) {
    s.defineDefs.push({ name: d.name, start: d.nameStart, end: d.nameEnd });
  }

  for (const k of doc.keyframes) {
    // VcssKeyframes.nameStart/nameEnd 框住的是"名字在源码里写的样子"：带引号时
    // 连引号一起框进去（quoted 为 true），k.name 却是去掉引号后的裸名字。
    // 直接拿 nameStart/nameEnd 当 name 的区间，对带引号的名字会切出 'fade' 而不是
    // fade —— 与真实语料一致核对过：archive 里的 @keyframes 全部带引号。
    const start = k.quoted ? k.nameStart + 1 : k.nameStart;
    const end = k.quoted ? k.nameEnd - 1 : k.nameEnd;
    s.keyframeDefs.push({ name: k.name, start, end });
  }

  for (const imp of doc.imports) {
    s.includes.push({ target: imp.target, start: imp.targetStart, end: imp.targetEnd });
  }

  // 顶层规则的选择器才是类名定义；@keyframes 的内层块（from/to）不是
  for (const rule of doc.rules) {
    scanSelector(rule.selector, rule.selectorStart, s);
  }

  const allRules: VcssRule[] = [...doc.rules, ...doc.keyframes.map((k) => k.rule)];
  for (const rule of allRules) {
    for (const r of [rule, ...rule.children]) {
      for (const decl of r.declarations) {
        DEFINE_CANDIDATE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = DEFINE_CANDIDATE_RE.exec(decl.value)) !== null) {
          if (m[1] === undefined) continue; // 命中的是引号片段，整体跳过，不进候选
          s.defineRefs.push({
            name: m[1],
            start: decl.valueStart + m.index,
            end: decl.valueStart + m.index + m[1].length,
          });
        }
        if (decl.property === 'animation-name') {
          // 可以是逗号分隔的多个动画名（真实语料如 hudgameicons.css 的
          // `animation-name: a, b, c;` 对应下面并列的 animation-duration 列表），
          // 每一段各自可能带引号也可能不带。逐段扫描而不是对整个值做一次
          // replace+indexOf——后者会把 "a, b, c" 整串当成一个（不存在的）
          // 动画名，导致这条引用永远链接不到任何一个真实的 @keyframes 定义。
          ANIM_NAME_RE.lastIndex = 0;
          let a: RegExpExecArray | null;
          while ((a = ANIM_NAME_RE.exec(decl.value)) !== null) {
            const quotedName = a[1] ?? a[2];
            const name = quotedName ?? a[0];
            if (!name) continue;
            const start = decl.valueStart + a.index + (quotedName !== undefined ? 1 : 0);
            s.keyframeRefs.push({ name, start, end: start + name.length });
          }
        }
      }
    }
  }

  return s;
}
