import * as vscode from 'vscode';
import { PanelRegistry } from '../../core/data/panels';
import { PropertyRegistry } from '../../core/data/properties';
import { ObservedValues } from '../../core/data/observed-values';
import { completeVcss, hoverVcss, symbolsVcss } from '../../core/features/vcss';
import { vcssDefinitionsAt, vcssReferencesAt } from '../../core/features/navigation';
import { colorsOf, formatColor } from '../../core/features/colors';
import { parseVcss } from '../../core/vcss/parser';
import { contextAt, hoverTargetAt } from '../../core/vcss/context';
import type { WorkspaceIndex } from '../../core/index/workspace-index';
import { toItem, toSymbol, s2rEnv, locationOf } from './shared';
import { LOCALE } from '../locale';
import { messagesFor } from '../../core/i18n';

const MSG = messagesFor(LOCALE);
const props = PropertyRegistry.load(LOCALE);
const observed = ObservedValues.load();
const panels = PanelRegistry.load(LOCALE);

// 'function' 没有列在这里：completeVcss 从不产出这种 kind 的补全项——
// 函数签名只出现在 hover 里（hoverVcss 的 'function' target），是另一回事。
const KIND: Record<string, number> = {
  property: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.Value,
  panel: vscode.CompletionItemKind.Class,
  pseudoClass: vscode.CompletionItemKind.Enum,
  atRule: vscode.CompletionItemKind.Keyword,
};

const SYMBOL_KIND: Record<string, number> = {
  rule: vscode.SymbolKind.Class,
  define: vscode.SymbolKind.Variable,
  keyframes: vscode.SymbolKind.Event,
};

export function registerVcss(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  const selector = { language: 'panorama-vcss' };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(document, position) {
          const doc = parseVcss(document.getText());
          const ctx = contextAt(doc, document.offsetAt(position));
          const cross = { index, uri: document.uri.fsPath.replace(/\\/g, '/') };
          return completeVcss(ctx, doc, props, observed, panels, MSG, cross).map((item) =>
            toItem(item, KIND, document),
          );
        },
      },
      ':',
      '@',
      '.',
      '#',
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const doc = parseVcss(document.getText());
        const info = hoverVcss(hoverTargetAt(doc, document.offsetAt(position)), doc, props, MSG);
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
        const doc = parseVcss(document.getText());
        return symbolsVcss(doc, MSG).map((s) => toSymbol(document, s, SYMBOL_KIND));
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const doc = parseVcss(document.getText());
        const uri = document.uri.fsPath.replace(/\\/g, '/');
        const defs = vcssDefinitionsAt(uri, doc, document.offsetAt(position), index, s2rEnv(index));
        return Promise.all(defs.map((d) => locationOf(d)));
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position) {
        const doc = parseVcss(document.getText());
        const uri = document.uri.fsPath.replace(/\\/g, '/');
        const refs = vcssReferencesAt(uri, doc, document.offsetAt(position), index);
        return Promise.all(refs.map((r) => locationOf(r)));
      },
    }),
  );

  // Panorama 用八位 #RRGGBBAA 写法（含 alpha），标准 CSS 取色器不认这种形式，
  // 所以内置 CSS 语言的颜色装饰在这里不可用，得自己注册。VXML 没有颜色字面量
  // 语法，不需要这个 provider。
  context.subscriptions.push(
    vscode.languages.registerColorProvider(selector, {
      provideDocumentColors(document) {
        const doc = parseVcss(document.getText());
        return colorsOf(doc).map(
          (c) =>
            new vscode.ColorInformation(
              new vscode.Range(document.positionAt(c.start), document.positionAt(c.end)),
              new vscode.Color(c.r, c.g, c.b, c.a),
            ),
        );
      },
      provideColorPresentations(color) {
        return [
          new vscode.ColorPresentation(formatColor(color.red, color.green, color.blue, color.alpha)),
        ];
      },
    }),
  );
}
