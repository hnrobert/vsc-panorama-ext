import * as vscode from 'vscode';
import { PanelRegistry } from '../../core/data/panels';
import { DEFAULT_CUSTOM_HUD_PATTERNS, layoutModeFor } from '../../core/mode';
import { completeVxml, hoverVxml, symbolsVxml } from '../../core/features/vxml';
import { vxmlDefinitionsAt, vxmlReferencesAt } from '../../core/features/navigation';
import { parseVxml } from '../../core/vxml/parser';
import { contextAt, hoverTargetAt } from '../../core/vxml/context';
import type { WorkspaceIndex } from '../../core/index/workspace-index';
import { toItem, toSymbol, s2rEnv, locationOf } from './shared';
import { LOCALE } from '../locale';
import { messagesFor } from '../../core/i18n';

const MSG = messagesFor(LOCALE);
const panels = PanelRegistry.load(LOCALE);

const KIND: Record<string, number> = {
  panel: vscode.CompletionItemKind.Class,
  structural: vscode.CompletionItemKind.Keyword,
  attribute: vscode.CompletionItemKind.Property,
  binding: vscode.CompletionItemKind.Field,
  // class= 的跨文件补全项用这个 kind——工作区里挖出来的类名，语义上更接近
  // VCSS 取值补全的 value，不是本文件声明的面板/属性。
  value: vscode.CompletionItemKind.Value,
};

// symbolsVxml 目前只产出 'panel' 一种 kind，但仍然走映射表而不是硬编码
// SymbolKind.Class——和 vcss.ts 保持一致的写法，也不用在 core 新增
// SymbolInfo.kind 时回头改这里。
const SYMBOL_KIND: Record<string, number> = {
  panel: vscode.SymbolKind.Class,
};

function modeOf(document: vscode.TextDocument) {
  const patterns = vscode.workspace
    .getConfiguration('panorama')
    .get<string[]>('customHudLayout.include', [...DEFAULT_CUSTOM_HUD_PATTERNS]);
  return layoutModeFor(document.uri.fsPath, patterns);
}

export function registerVxml(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  const selector = { language: 'panorama-vxml' };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(document, position) {
          const doc = parseVxml(document.getText());
          const ctx = contextAt(doc, document.offsetAt(position));
          const cross = { index, uri: document.uri.fsPath.replace(/\\/g, '/') };
          return completeVxml(ctx, modeOf(document), panels, MSG, cross).map((i) =>
            toItem(i, KIND, document),
          );
        },
      },
      '<',
      ' ',
      '{',
      // 属性值在语法上是字符串记号，而 VSCode 的 editor.quickSuggestions 默认
      // strings: off——在 class= 的引号里敲字母不会自动触发。引号本身必须是
      // 触发字符，否则跨文件类名补全在真实编辑器里只能靠 Ctrl+Space 手动唤出，
      // 等同于看不见。package.json 的 configurationDefaults 负责另一半（继续
      // 敲字母时还跟着筛），两者缺一不可。
      '"',
      // src= 的逐段路径补全：每敲完一段斜杠就该给出下一段的候选
      '/',
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const doc = parseVxml(document.getText());
        const target = hoverTargetAt(doc, document.offsetAt(position));
        const info = hoverVxml(target, modeOf(document), panels, MSG);
        if (!info) return undefined;
        return new vscode.Hover(
          new vscode.MarkdownString(`**${info.title}**\n\n${info.body}`),
        );
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        const doc = parseVxml(document.getText());
        return symbolsVxml(doc).map((s) => toSymbol(document, s, SYMBOL_KIND));
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const doc = parseVxml(document.getText());
        const uri = document.uri.fsPath.replace(/\\/g, '/');
        const defs = vxmlDefinitionsAt(uri, doc, document.offsetAt(position), index, s2rEnv(index));
        return Promise.all(defs.map((d) => locationOf(d)));
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position) {
        const doc = parseVxml(document.getText());
        const uri = document.uri.fsPath.replace(/\\/g, '/');
        const refs = vxmlReferencesAt(uri, doc, document.offsetAt(position), index);
        return Promise.all(refs.map((r) => locationOf(r)));
      },
    }),
  );
}
