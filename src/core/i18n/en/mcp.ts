import type { McpMessages } from '../types-mcp';

/* 与 zh-cn/mcp.ts 逐条对应，顺序相同。不得出现中文字符
   （test/unit/core/diagnostics/no-chinese-in-english.test.ts 守卫）。 */
export const mcp: McpMessages = {
  toolValidateDesc: () =>
    'Validate a Counter-Strike 2 Panorama layout (.xml/.vxml) or stylesheet (.css/.vcss) file ' +
    'against the real Panorama language and return every diagnostic with a concrete fix. ' +
    'The file is read from disk; pass the workspace root to also run cross-file checks ' +
    '(unknown class names, unresolved @define / @keyframes)',
  toolPanelInfoDesc: () =>
    'Look up a Panorama panel type: its base type, whether it can be nested, and its full ' +
    'attribute set resolved through the inheritance chain. Without a panel name, list all ' +
    '245 known panel types',
  toolPropertyInfoDesc: () =>
    'Look up a VCSS property, function, at-rule or web-only construct: valid values, the web ' +
    'CSS equivalent, and why Panorama differs. Without a name, list everything known',
  toolSymbolsDesc: () =>
    'Query workspace-wide symbols from Panorama files: CSS class definitions and usages, ' +
    'ids, @define constants and @keyframes. The root is scanned once and cached; pass ' +
    'refresh to force a rescan',
  resourceDataDesc: () =>
    'Raw reference data behind the extension: panel registry, VCSS property domains, ' +
    'observed values and observed attributes, as generated from the schema CS2 emits and ' +
    'a 990-file corpus',
  promptReviewDesc: () =>
    'Validate a Panorama file, then fix every reported diagnostic following its suggested ' +
    'replacement, re-validating after each round until clean',
  promptWebConvertDesc: () =>
    'Convert web CSS declarations into their Panorama equivalents, using the property ' +
    'reference to explain every difference',
  promptScaffoldDesc: () =>
    'Scaffold a new Panorama layout and stylesheet pair, honouring the CustomHudLayout ' +
    'restrictions when the target lives under layout/custom_game/',
  errUnsupportedPath: (path) =>
    `Not a Panorama file (expected .xml/.vxml layout or .css/.vcss stylesheet): ${path}`,
  errFileNotFound: (path) => `File not found on disk: ${path}`,
  errUnreadable: (path) => `File could not be read: ${path}`,
  errRootNotDir: (root) => `Not a directory: ${root}`,
  noteDataIncomplete: () =>
    'The reference data is hand-curated from the schema CS2 emits plus a 990-file corpus ' +
    'and is known to be incomplete — absence from this list does not prove the construct ' +
    'is invalid',

  hostStatusTooltip: (url) => `CS2 Panorama MCP endpoint: ${url}`,
  hostPickTitle: () => 'Enable the Panorama MCP server for which client?',
  hostPickClaudeCode: () => 'Claude Code — write .mcp.json in this workspace',
  hostPickVSCode: () => 'VS Code (Copilot Agent) — write .vscode/mcp.json',
  hostPickCursor: () => 'Cursor — write .cursor/mcp.json',
  hostPickClaudeDesktop: () => 'Claude Desktop — copy config snippet',
  hostPickCopyUrl: () => 'Copy endpoint URL only',
  hostWroteFile: (path) => `Updated ${path}`,
  hostCopied: () => 'Copied to clipboard',
  hostConfigUnparsable: (path) =>
    `${path} exists but is not valid JSON — not overwriting it, please merge the entry manually`,
  hostDisabled: () => 'Panorama MCP is disabled (panorama.mcp.enabled is false)',
};
