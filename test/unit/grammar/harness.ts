import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

const require_ = createRequire(import.meta.url);

// loadWASM 每进程只能调用一次，故整体缓存
let onigLib: Promise<textmate.IOnigLib> | undefined;

function getOnigLib(): Promise<textmate.IOnigLib> {
  onigLib ??= (async () => {
    const wasm = readFileSync(require_.resolve('vscode-oniguruma/release/onig.wasm'));
    // Node 的 Buffer 复用内存池，.buffer 是整个池而非本文件的字节，必须按 offset 切片
    await oniguruma.loadWASM(
      wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
    );
    return {
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    };
  })();
  return onigLib;
}

export interface Token {
  text: string;
  scopes: string[];
}

async function loadGrammar(scopeName: string, grammarPath: string) {
  const registry = new textmate.Registry({
    onigLib: getOnigLib(),
    loadGrammar: async (scope) =>
      scope === scopeName
        ? textmate.parseRawGrammar(readFileSync(grammarPath, 'utf8'), grammarPath)
        : null,
  });

  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) throw new Error(`未能加载语法：${scopeName}`);
  return grammar;
}

export async function tokenize(
  scopeName: string,
  grammarPath: string,
  line: string,
): Promise<Token[]> {
  const grammar = await loadGrammar(scopeName, grammarPath);
  const result = grammar.tokenizeLine(line, textmate.INITIAL);
  return result.tokens.map((t) => ({
    text: line.slice(t.startIndex, t.endIndex),
    scopes: t.scopes,
  }));
}

/**
 * 跨行 tokenize，逐行传递 ruleStack。
 * 真实 Panorama 样式表把 `{` 单独放在下一行，单行 tokenize 测不出这种结构。
 */
export async function tokenizeLines(
  scopeName: string,
  grammarPath: string,
  source: string,
): Promise<Token[]> {
  const grammar = await loadGrammar(scopeName, grammarPath);
  const all: Token[] = [];
  let state = textmate.INITIAL;

  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    for (const t of result.tokens) {
      all.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    }
  }
  return all;
}

/** 取首个文本恰为 text 的 token 的作用域列表 */
export function scopesOf(tokens: Token[], text: string): string[] {
  const token = tokens.find((t) => t.text === text);
  if (!token) {
    throw new Error(
      `未找到文本为 "${text}" 的 token。实际切分：${JSON.stringify(tokens.map((t) => t.text))}`,
    );
  }
  return token.scopes;
}
