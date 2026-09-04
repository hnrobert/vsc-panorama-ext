import type { PanelRegistry } from '../data/panels';
import type { PropertyRegistry } from '../data/properties';
import type { ObservedValues } from '../data/observed-values';
import type { VcssDocument } from '../vcss/ast';
import type { VcssContext, VcssHoverTarget } from '../vcss/context';
import type { WorkspaceIndex } from '../index/workspace-index';
import type { CompletionItem, HoverInfo, SymbolInfo } from './types';
import type { Messages } from '../i18n/types';

export interface VcssCrossFile {
  readonly index: WorkspaceIndex;
  readonly uri: string;
}

/** 排序前缀：数字越小越靠前 */
const SORT = {
  panoramaOnly: '1',
  standard: '2',
  curatedValue: '1',
  localSymbol: '2',
  /** 其它文件的符号：确实存在，但不在当前文件，排在同文件符号之后 */
  crossFileSymbol: '3',
  /** 语料挖掘的弱可靠取值一律排在最后（规格 §5.3） */
  minedValue: '9',
} as const;

const AT_RULES = ['@define', '@import', '@keyframes'];

export function completeVcss(
  ctx: VcssContext,
  doc: VcssDocument,
  props: PropertyRegistry,
  observed: ObservedValues,
  panels: PanelRegistry,
  msg: Messages,
  cross?: VcssCrossFile,
): CompletionItem[] {
  if (ctx.kind === 'atRule') {
    return AT_RULES.map((label) => ({
      label,
      kind: 'atRule' as const,
      documentation: props.atRule(label)?.description,
    }));
  }

  if (ctx.kind === 'propertyName') {
    return props.allProperties().map((name) => {
      const info = props.get(name)!;
      return {
        label: name,
        kind: 'property' as const,
        detail: info.panoramaOnly ? msg.ui.panoramaOnly() : undefined,
        documentation: info.description,
        sortText: `${info.panoramaOnly ? SORT.panoramaOnly : SORT.standard}${name}`,
      };
    });
  }

  if (ctx.kind === 'propertyValue') {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    for (const v of props.valuesOf(ctx.property)) {
      seen.add(v);
      items.push({ label: v, kind: 'value', sortText: `${SORT.curatedValue}${v}` });
    }

    // animation-name 补全同文件的 @keyframes 名（跨文件属于 M3）。
    //
    // 插入的是**不带引号**的名字：`@keyframes` 声明要引号
    // （`@keyframes 'fade' { ... }`，Panorama 的真实怪癖）而 `animation-name`
    // 引用不要——Valve 两个构建 516 处 animation-name 声明零例外全部不带引号。
    // 早先这里插入 `'${k.name}'`，把「声明」的怪癖套到了「引用」上；引号还
    // 顺带让 label 以 `'` 开头，用户敲 `fa` 时 VSCode 的前缀过滤匹配不上
    // `'fade'`，候选被整个过滤掉。（M4 Ruling 11）
    if (ctx.property === 'animation-name') {
      for (const k of doc.keyframes) {
        if (seen.has(k.name)) continue;
        seen.add(k.name);
        items.push({ label: k.name, kind: 'value', sortText: `${SORT.localSymbol}${k.name}` });
      }
    }

    // 同文件内的 @define 常量（跨文件在下面处理）。detail 里明确标注「当前
    // 文件」，与下面跨文件分支的 detail 互斥，供适配层/测试区分候选的来源。
    for (const d of doc.defines) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      items.push({
        label: d.name,
        kind: 'value',
        detail: msg.ui.defineInCurrentFile(d.value),
        sortText: `${SORT.localSymbol}${d.name}`,
      });
    }

    // 其它文件的 @define：排在同文件之后、挖掘值之前
    if (cross) {
      for (const name of cross.index.allDefineNames()) {
        if (seen.has(name)) continue;
        const defs = cross.index.defineDefinitions(name);
        if (defs.every((d) => d.uri === cross.uri)) continue; // 同文件的已在上面处理
        seen.add(name);
        items.push({
          label: name,
          kind: 'value',
          detail: msg.ui.defineFromOtherSheet(),
          sortText: `${SORT.crossFileSymbol}${name}`,
        });
      }
      // 同样不带引号，理由见上面同文件分支的注释（M4 Ruling 11）。
      if (ctx.property === 'animation-name') {
        for (const name of cross.index.allKeyframeNames()) {
          if (seen.has(name)) continue;
          seen.add(name);
          items.push({
            label: name,
            kind: 'value',
            detail: msg.ui.keyframesFromOtherSheet(),
            sortText: `${SORT.crossFileSymbol}${name}`,
          });
        }
      }
    }

    // 语料挖掘的候选：弱可靠，排最后
    for (const v of observed.valuesOf(ctx.property)) {
      if (seen.has(v)) continue;
      seen.add(v);
      items.push({
        label: v,
        kind: 'value',
        detail: msg.ui.seenInCorpusOnly(),
        sortText: `${SORT.minedValue}${v}`,
      });
    }

    return items;
  }

  if (ctx.kind === 'selector') {
    // 冒号后补全伪类
    if (ctx.prefix.endsWith(':') || /:[\w-]*$/.test(ctx.prefix)) {
      // label 本身带前导冒号（':hover'）用于下拉列表里正常显示；那个冒号也
      // 正是用户已经敲过、触发这次补全的字符。此前没有显式区间时，只能靠
      // 编辑器按 wordPattern 推导替换范围——VCSS 的 wordPattern 只在冒号
      // 后面跟着 '{'（且同一行）时才把冒号并入"当前单词"，本项目一贯的
      // 花括号另起一行写法触不到那个条件，所以旧实现把插入文本里的前导
      // 冒号去掉，避免插入后与原有冒号重复成 '::hover'。
      //
      // 现在显式给出替换区间——从触发补全的那个冒号开始，直到已输入的伪类
      // 前缀结束——区间本身就会把用户敲的冒号一并纳入替换范围，所以插入
      // 文本必须换回完整的 label（含前导冒号），否则会丢掉冒号变成
      // '.btn hover' 而不是 '.btn:hover'。区间与插入文本必须配套修改，
      // 只改其中一处都会插出错误结果。
      const colonAt = ctx.prefixStart + ctx.prefix.lastIndexOf(':');
      const end = ctx.prefixStart + ctx.prefix.length;
      return props.pseudoClasses().map((label) => ({
        label,
        kind: 'pseudoClass' as const,
        insertText: label,
        replaceStart: colonAt,
        replaceEnd: end,
      }));
    }
    // '.' 后补类名、'#' 后补 id：与上面伪类那支同一条不变式（见
    // features/types.ts 的 replaceStart 注释），而且这里更硬——没有显式区间
    // 时这两支在真实编辑器里 100% 不可见。
    //
    // VCSS 的 wordPattern（language-configuration-vcss.json）第 3、4 个分支
    // `(([@#.!])?[\w-?]+%?)` 与 `([@#!.])` 把前导 '.' / '#' 算进当前词：
    // 敲到 '.fo' 时当前词是 '.fo'，只敲一个 '.' 时当前词就是 '.'。VSCode 拿
    // 这个词去过滤候选，而裸名 label（'foo'）里根本没有那个 '.'，模糊匹配恒
    // 失败（长度小于 3 时连 permutation 都不会试），候选被整批滤掉——用户敲完
    // '.' 之后看到的是空列表。就算侥幸被接受，替换区间也会把前导 '.' 一起
    // 吃掉，得到 'foo { }' 这种非法选择器。
    //
    // 所以区间必须覆盖「含前导 sigil 的整段 token」，label 与 insertText 也
    // 随之带上那个 sigil：label 带上它才能通过编辑器的过滤，insertText 带上
    // 它才能把区间吃掉的那个字符补回来。三者必须配套改，只改一处都会插错。
    //
    // token 的起点取 prefix 里最后一个 sigil：'.a .shared' / '.a.b' / '.x#Id'
    // 这些形态下，正在输入的永远是最后那一段。sigil 之后只可能是 [\w-]
    // （上面的正则已经保证），所以区间不会跨行，满足 VSCode 对补全 Range
    // 「必须单行且包含光标」的要求。
    const sigilItems = (sigil: '.' | '#', names: readonly string[]): CompletionItem[] => {
      const sigilAt = ctx.prefixStart + ctx.prefix.lastIndexOf(sigil);
      const end = ctx.prefixStart + ctx.prefix.length;
      return names.map((name) => {
        const label = `${sigil}${name}`;
        return {
          label,
          kind: 'value' as const,
          insertText: label,
          replaceStart: sigilAt,
          replaceEnd: end,
        };
      });
    };

    // . 后补全类名：工作区里全部样式表定义过的类名（含本文件）
    if (cross && /\.[\w-]*$/.test(ctx.prefix)) {
      return sigilItems('.', cross.index.allClassNames());
    }
    // # 后补全 id：工作区里 VXML 声明过的 id
    if (cross && /#[\w-]*$/.test(ctx.prefix)) {
      return sigilItems('#', cross.index.allIdNames());
    }
    // 裸标识符位置补全面板类型名
    if (!/[.#]/.test(ctx.prefix)) {
      return panels.allPanels().map((label) => ({ label, kind: 'panel' as const }));
    }
    return [];
  }

  return [];
}

export function hoverVcss(
  target: VcssHoverTarget,
  doc: VcssDocument,
  props: PropertyRegistry,
  msg: Messages,
): HoverInfo | undefined {
  if (target.kind === 'property') {
    const info = props.get(target.name);
    if (!info) return undefined;

    const lines = [info.description];
    if (info.values.length) lines.push(msg.ui.values(info.values));
    if (info.webEquivalent) lines.push(msg.ui.webEquivalent(info.webEquivalent));
    if (info.panoramaOnly) lines.push(msg.ui.panoramaOnlyNote());
    return { title: target.name, body: lines.join('\n\n') };
  }

  if (target.kind === 'define') {
    const def = doc.defines.find((d) => d.name === target.name);
    if (!def) return undefined;
    return {
      title: target.name,
      body: msg.ui.defineHover(def.value),
    };
  }

  if (target.kind === 'function') {
    const fn = props.functions().find((f) => f.name === target.name);
    if (!fn) return undefined;
    return { title: fn.name, body: `\`${fn.signature}\`\n\n${fn.description}` };
  }

  return undefined;
}

export function symbolsVcss(doc: VcssDocument, msg: Messages): SymbolInfo[] {
  const out: SymbolInfo[] = [];

  // 三类都可能在编辑中途产出空名字（没写名字的 @keyframes、`@define :`、
  // 没有选择器的裸 `{`）。真实 VSCode 的 DocumentSymbol 不接受空 name，
  // 适配层会直接抛异常、拖垮整份大纲；一个没名字的构造本来也没什么可展示的，
  // 跳过它比强行编个占位名更干净。
  for (const d of doc.defines) {
    if (!d.name) continue;
    out.push({
      name: d.name,
      kind: 'define',
      detail: d.value,
      start: d.nameStart,
      end: d.valueEnd,
      children: [],
    });
  }

  for (const k of doc.keyframes) {
    if (!k.name) continue;
    out.push({
      name: k.name,
      kind: 'keyframes',
      start: k.nameStart,
      end: k.rule.blockEnd === -1 ? doc.text.length : k.rule.blockEnd + 1,
      children: [],
    });
  }

  for (const r of doc.rules) {
    if (!r.selector) continue;
    out.push({
      name: r.selector,
      kind: 'rule',
      detail: msg.ui.declarationCount(r.declarations.length),
      start: r.selectorStart,
      end: r.blockEnd === -1 ? doc.text.length : r.blockEnd + 1,
      children: [],
    });
  }

  return out.sort((a, b) => a.start - b.start);
}
