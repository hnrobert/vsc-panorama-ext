import * as vscode from 'vscode';
import type { CompletionItem as CoreItem, SymbolInfo } from '../../core/features/types';
import type { SymbolLocation, WorkspaceIndex } from '../../core/index/workspace-index';
import type { S2rEnv } from '../../core/index/s2r';
import { messagesFor } from '../../core/i18n';
import { LOCALE } from '../locale';

// 适配层唯一一条面向用户的字符串走的也是同一份目录，
// 与两个 provider 的 MSG 同源，不另起一套。
const MSG = messagesFor(LOCALE);

/**
 * core 层的 CompletionItem 转成 vscode.CompletionItem。
 * VXML 与 VCSS 两个 provider 里这段逻辑曾经逐字节重复，只有 kind 映射表不同，
 * 现在共享一份实现，调用方各自传入自己的映射表。
 *
 * document 是可选的：只有传入时才能把 core 层给出的 replaceStart/replaceEnd
 * （文档绝对偏移）换算成 vscode.Range。不传或 core 层没给出这两个字段时，
 * out.range 保持 undefined，交由编辑器按语言 wordPattern 推导——这正是
 * Task 9 之前唯一的路径，仍作为没有显式区间时的后备行为保留。
 */
export function toItem(
  item: CoreItem,
  kind: Readonly<Record<string, number>>,
  document?: vscode.TextDocument,
): vscode.CompletionItem {
  const out = new vscode.CompletionItem(item.label, kind[item.kind]);
  out.detail = item.detail;
  if (item.documentation) out.documentation = new vscode.MarkdownString(item.documentation);
  out.sortText = item.sortText;
  out.insertText = item.insertText;
  if (document && item.replaceStart !== undefined && item.replaceEnd !== undefined) {
    out.range = new vscode.Range(
      document.positionAt(item.replaceStart),
      document.positionAt(item.replaceEnd),
    );
  }
  // 逐段路径补全接受一个目录段之后要立刻再弹一次，否则用户得手动 Ctrl+Space
  // 才能往下走一段。VSCode 只认挂在候选项上的 command，没有别的表达方式。
  if (item.retriggerSuggest) {
    out.command = { command: 'editor.action.triggerSuggest', title: MSG.ui.continueCompletion() };
  }
  return out;
}

/**
 * core 层的 SymbolInfo 转成 vscode.DocumentSymbol（递归带上子节点）。
 * 同样是两个 provider 曾经重复的逻辑，只有 kind 映射表不同。
 */
export function toSymbol(
  document: vscode.TextDocument,
  s: SymbolInfo,
  kind: Readonly<Record<string, number>>,
): vscode.DocumentSymbol {
  const range = new vscode.Range(document.positionAt(s.start), document.positionAt(s.end));
  const out = new vscode.DocumentSymbol(s.name, s.detail ?? '', kind[s.kind], range, range);
  out.children = s.children.map((c) => toSymbol(document, c, kind));
  return out;
}

function vscodeContentRoots(): string[] {
  return vscode.workspace.getConfiguration('panorama').get<string[]>('contentRoots', []);
}

/**
 * 索引已经在扫描期积累了工作区路径集合，s2r 的存在性判断直接复用它——
 * 跳转定义/查找引用在补全同样的同步路径上运行，不能为了判断一条 s2r
 * 引用是否存在就去发一次额外的文件系统 IO。
 */
export function s2rEnv(index: WorkspaceIndex): S2rEnv {
  const files = new Set(index.allFiles());
  return {
    exists: (p) => {
      const n = p.replace(/\\/g, '/');
      if (files.has(n)) return true;
      for (const f of files) if (f.startsWith(n + '/')) return true;
      return false;
    },
    contentRoots: vscodeContentRoots(),
  };
}

/** 把 core 的符号位置转成 vscode.Location，按需打开目标文档以换算行列 */
export async function locationOf(l: SymbolLocation): Promise<vscode.Location> {
  const uri = vscode.Uri.file(l.uri);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return new vscode.Location(
      uri,
      new vscode.Range(doc.positionAt(l.start), doc.positionAt(l.end)),
    );
  } catch {
    return new vscode.Location(uri, new vscode.Position(0, 0));
  }
}
