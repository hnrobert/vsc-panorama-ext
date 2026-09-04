import { attributeValuesFor } from '../data/attribute-values';
import type { PanelRegistry } from '../data/panels';
import type { LayoutMode } from '../mode';
import { CUSTOM_HUD_ALLOWED_STRUCTURAL, CUSTOM_HUD_WHITELIST, customHudAttributesOf } from '../mode';
import type { VxmlDocument, VxmlElement } from '../vxml/ast';
import type { VxmlContext, VxmlHoverTarget } from '../vxml/context';
import type { WorkspaceIndex } from '../index/workspace-index';
import type { CompletionItem, HoverInfo, SymbolInfo } from './types';
import type { Messages } from '../i18n/types';

export interface VxmlCrossFile {
  readonly index: WorkspaceIndex;
  /** 当前文件路径，用于判断哪些样式表已被 include */
  readonly uri: string;
}

const STRUCTURAL_FULL = ['styles', 'scripts', 'snippets'];

/** s2r 引用的固定头部。逐段补全时它与后面第一个目录段作为一整块给出 */
const S2R_HEAD = 's2r://panorama/';

const BINDING_KINDS = ['s', 'd', 'g', 't'] as const;

/**
 * 四种 dialog 绑定的补全项。
 *
 * 此前这里是模块级常量表。常量在 import 时求值，那时还拿不到 locale——
 * 本地化改造后必须是函数。项目里同类的还有 diagnostics/vxml.ts 的
 * MISPLACED_UNDER_ROOT，一并改过。
 */
function bindings(msg: Messages): ReadonlyArray<{ label: string; documentation: string }> {
  return BINDING_KINDS.map((k) => ({
    label: `{${k}:}`,
    documentation: msg.ui.bindingDoc(k),
  }));
}

function panelItem(name: string, panels: PanelRegistry): CompletionItem {
  const info = panels.get(name);
  return {
    label: name,
    kind: 'panel',
    detail: info?.derivedFrom ? `derived from ${info.derivedFrom}` : undefined,
  };
}

export function completeVxml(
  ctx: VxmlContext,
  mode: LayoutMode,
  panels: PanelRegistry,
  msg: Messages,
  cross?: VxmlCrossFile,
): CompletionItem[] {
  const strict = mode === 'customHudLayout';

  if (ctx.kind === 'tagName') {
    // <root> 之外唯一合法的元素就是 root 本身——它不在 panels.json 里
    // （不是一种"面板"），两种模式下都一样，必须在下面的面板名分支之前特判掉，
    // 否则会连同 245/4 种面板名一起冒出来，但 root 从来不在那些集合里。
    if (ctx.slot === 'outside') {
      return [{ label: 'root', kind: 'structural' }];
    }

    const taken = new Set(ctx.existingStructural);
    const structural = (strict ? CUSTOM_HUD_ALLOWED_STRUCTURAL : STRUCTURAL_FULL)
      .filter((label) => !taken.has(label))
      .map((label): CompletionItem => ({ label, kind: 'structural' }));

    const names = strict
      ? Object.keys(CUSTOM_HUD_WHITELIST)
      : ctx.slot === 'child'
        ? panels.childPanels()
        : panels.allPanels();

    const tags = names.map((n) => panelItem(n, panels));
    return ctx.slot === 'rootHeader' ? [...structural, ...tags] : tags;
  }

  if (ctx.kind === 'attributeName') {
    const all = strict ? customHudAttributesOf(ctx.tag) : panels.attributesOf(ctx.tag);

    const taken = new Set(ctx.existing);
    return all
      .filter((a) => !taken.has(a))
      // 根面板不接受 id（引擎硬约束，XSD 查不出）
      .filter((a) => !(ctx.slot === 'rootPanel' && a === 'id'))
      .map((a) => ({
        label: a,
        kind: 'attribute' as const,
        documentation: panels.docFor(a),
      }));
  }

  if (ctx.kind === 'attributeValue') {
    const typed = ctx.value.slice(0, ctx.valueOffset);
    if (typed.endsWith('{')) {
      // 严格模式下只有 {s:} 对自定义内容开放
      const all = bindings(msg);
      const allowed = strict ? all.filter((b) => b.label === '{s:}') : all;
      // 显式区间只覆盖用户刚敲的那个 '{'（文档绝对偏移），不再依赖编辑器按
      // wordPattern 推导——那条路径只在 wordPattern 恰好把 '{' 算作单词字符
      // 时才凑巧正确，且词字符紧贴 '{'（如 text="Score:{"，冒号后没有空格）
      // 时会把前面的 'Score:' 一起吞掉。insertText 仍是完整的 '{s:}'：区间
      // 只有一个字符宽（那个 '{'），插入完整 label 才能把它换成 '{s:}'，
      // 插入切片后的 's:' 反而会把左花括号丢掉。
      const braceAt = ctx.valueStart + ctx.valueOffset - 1;
      return allowed.map((b) => ({
        label: b.label,
        kind: 'binding' as const,
        documentation: b.documentation,
        insertText: b.label,
        replaceStart: braceAt,
        replaceEnd: braceAt + 1,
      }));
    }

    if (ctx.attribute === 'snippet' && ctx.snippetNames) {
      return ctx.snippetNames.map((name) => ({ label: name, kind: 'value' as const }));
    }

    if (ctx.attribute === 'class' && cross) {
      // class="a b|" —— 只补光标所在的那一段，已写过的其余段要从候选里排除
      const written = new Set(ctx.value.split(/\s+/).filter(Boolean));
      const current = /[^\s]*$/.exec(typed)?.[0] ?? '';
      if (current) written.delete(current);

      const included = new Set(cross.index.includedStylesheets(cross.uri));
      return cross.index
        .allClassNames()
        .filter((name) => !written.has(name))
        .map((name) => {
          const defs = cross.index.classDefinitions(name);
          const isIncluded = defs.some((d) => included.has(d.uri));
          return {
            label: name,
            kind: 'value' as const,
            // 已 include 的样式表里的类名更可能是用户想要的，排前面
            detail: msg.ui.stylesheetIncluded(isIncluded),
            sortText: `${isIncluded ? '1' : '2'}${name}`,
          };
        });
    }

    if (ctx.attribute === 'src' && cross && (ctx.tag === 'include' || ctx.tag === 'Frame')) {
      // 只从索引里已有的文件产出，覆盖 <include src>（样式表）与 <Frame src>
      // （布局）——这两类正是索引扫描的对象。<Image src> 等指向 images/ 的
      // 属性不在索引范围内，需要目录遍历，本版不支持（规格 §9.1 任务范围）。
      //
      // 按 tag 收窄到 include/Frame，且按文件的真实后缀分开只给样式表或只给
      // 布局候选：include 不该出现布局路径，Frame 也不该出现样式表路径，
      // 混着给引擎不认，属于错误建议。
      //
      // 每个文件的 s2r 根只由它自己的路径决定——取它路径里第一个 /layout/
      // 或 /styles/ 段之前的那一截。不能先把全部文件各自算出的根收集成一个
      // 共享候选池、再对每个文件挨个 startsWith 试：候选池里可能同时有两棵
      // 内容树的根，其中一棵更短的根恰好也是另一棵里某个文件路径的字符串
      // 前缀时，会把那个文件的根误判成外面那棵树的根，拼出一条多出一截的
      // 错误路径。只认自己路径里的分段，不经共享候选池，就没有这个问题。
      const wantStyle = ctx.tag === 'include';
      const paths: Array<{ path: string; file: string }> = [];
      for (const file of cross.index.allFiles()) {
        const root = file.replace(/\/(layout|styles)\/.*$/, '');
        if (root === file) continue; // 不在 layout/ 或 styles/ 下，不是可补全的资源
        const rel = file.slice(root.length + 1);
        const isStyle = /\.(css|vcss)$/.test(rel);
        const isLayout = /\.(xml|vxml)$/.test(rel);
        if (wantStyle ? !isStyle : !isLayout) continue;
        const compiled = isStyle
          ? rel.replace(/\.(css|vcss)$/, '.vcss_c')
          : rel.replace(/\.(xml|vxml)$/, '.vxml_c');
        paths.push({ path: `${S2R_HEAD}${compiled}`, file });
      }

      // 逐段补全（规格 §9.1「src= 逐段补全」）：只产出光标所在的那一段，
      // 显式区间也只覆盖那一段。
      //
      // 整条路径 + 无区间的老写法在真实编辑器里必然出错：VXML 的 wordPattern
      // （language-configuration-vxml.json）不含斜杠，光标停在
      // src="s2r://panorama/sty| 时当前词只有 'sty'，接受后得到
      // src="s2r://panorama/s2r://panorama/styles/hud/main.vcss_c"。
      // 只有「空值 + Ctrl+Space」和「刚敲完 s2r:」两种起点碰巧正确。
      const cut = typed.lastIndexOf('/') + 1;
      const committed = typed.slice(0, cut);

      // chunk -> 该 chunk 是文件时的来源路径（目录段没有唯一来源，留 undefined）
      const chunks = new Map<string, string | undefined>();
      for (const { path, file } of paths) {
        if (!path.startsWith(committed)) continue;
        // 分段边界不允许落在固定头部 's2r://panorama/' 内部：那里的 '//' 会被
        // 切出一个空段，补出 's2r:/' 这种半截协议头，接受了也没往前推进。
        // 从 max(cut, 头部长度) 起找下一个 '/'，头部因此总是与它后面的第一个
        // 目录段一起作为一整块给出。
        const slash = path.indexOf('/', Math.max(cut, S2R_HEAD.length));
        const chunk = slash === -1 ? path.slice(cut) : path.slice(cut, slash + 1);
        if (!chunks.has(chunk)) chunks.set(chunk, slash === -1 ? file : undefined);
      }

      const start = ctx.valueStart + cut;
      const end = ctx.valueStart + ctx.valueOffset;
      return [...chunks].map(([chunk, file]) => ({
        label: chunk,
        kind: 'value' as const,
        detail: file,
        insertText: chunk,
        replaceStart: start,
        replaceEnd: end,
        // 目录段接受之后下一段才有意义，立刻重新触发补全
        retriggerSuggest: chunk.endsWith('/'),
      }));
    }

    // 有固定取值域的属性（如 Image 的 scaling、各类布尔属性）：数据来自
    // data/vxml-attribute-values.json，人工整理——XSD 不含任何 xs:enumeration，
    // 引擎侧不提供机器可读的取值域。
    const enumerated = attributeValuesFor(ctx.tag, ctx.attribute);
    if (enumerated.length > 0) {
      return enumerated.map((label) => ({ label, kind: 'value' as const }));
    }

    return [];
  }

  return [];
}

export function hoverVxml(
  target: VxmlHoverTarget,
  mode: LayoutMode,
  panels: PanelRegistry,
  msg: Messages,
): HoverInfo | undefined {
  if (target.kind === 'tag') {
    const info = panels.get(target.name);
    if (!info) return undefined;

    const lines: string[] = [];
    lines.push(
      msg.ui.panelType(info.derivedFrom),
    );
    if (info.rootOnly) lines.push(msg.ui.rootOnlyNote());
    if (mode === 'customHudLayout') {
      lines.push(msg.ui.whitelistNote(Object.hasOwn(CUSTOM_HUD_WHITELIST, target.name)));
    }
    return { title: target.name, body: lines.join('\n\n') };
  }

  if (target.kind === 'attribute') {
    if (!panels.has(target.tag)) return undefined;
    const declarer = panels.declarerOf(target.tag, target.name);

    const lines: string[] = [];
    lines.push(msg.ui.attributeOf(declarer));
    const doc = panels.docFor(target.name);
    if (doc) lines.push(doc);
    if (mode === 'customHudLayout') {
      const allowed = customHudAttributesOf(target.tag);
      lines.push(msg.ui.whitelistNote(allowed.includes(target.name)));
    }
    return { title: target.name, body: lines.join('\n\n') };
  }

  return undefined;
}

function symbolOf(el: VxmlElement): SymbolInfo {
  const id = el.attributes.find((a) => a.name === 'id')?.value;
  const cls = el.attributes.find((a) => a.name === 'class')?.value?.split(/\s+/)[0];
  return {
    name: el.tag,
    kind: 'panel',
    detail: id ? `#${id}` : cls ? `.${cls}` : undefined,
    start: el.tagStart,
    end: el.end,
    children: el.children.map(symbolOf),
  };
}

export function symbolsVxml(doc: VxmlDocument): SymbolInfo[] {
  return doc.roots.map(symbolOf);
}
