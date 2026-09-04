import type { VxmlMessages } from '../types-vxml';

/* 与 zh-cn/vxml.ts 逐条对应，顺序相同——两份并排打开就能逐行比对。 */
export const vxml: VxmlMessages = {
  unknownTag: (tag) => `${tag} is not a known panel type`,
  unknownTagFix: () =>
    "data/panels.json is generated from CS2's panorama_generate_layout_xsd — it is the engine's " +
    'own list of panel types. Check the spelling and casing first; if the engine really does ' +
    'accept this type, that is a gap in the XSD, and it belongs in the observed layer in ' +
    'data/vxml-observed-attributes.json',

  unknownAttribute: (attr, tag) =>
    `${attr} is not in the attribute set of ${tag} (inherited sets included)`,
  unknownAttributeFix: (tag) =>
    `The attribute set for ${tag} comes from the XSD, and the XSD's attribute sets are known to ` +
    'be incomplete (spec §5.1 / D-M4-1; the corpus has 554 legitimate uses outside the sets) — ' +
    'which is why this is only a hint. Check the spelling and casing first; if the engine does ' +
    'accept this attribute, ignore this, or add it to the observed layer in ' +
    'data/vxml-observed-attributes.json',

  unknownClass: (name) => `No definition found in the index for the class name ${name}`,
  unknownClassFix: () =>
    'Check the spelling, or make sure the stylesheet that defines it is imported by this layout',

  includeUnderRoot: () => '<include> cannot appear directly under <root>',
  includeUnderRootFix: () =>
    'Move it inside <styles> (for stylesheets) or <scripts> (for scripts): ' +
    '<root><styles><include src="…" /></styles>…</root>',
  snippetUnderRoot: () => '<snippet> cannot appear directly under <root>',
  snippetUnderRootFix: () =>
    'Snippet templates must be wrapped in <snippets>: ' +
    '<root><snippets><snippet name="…">…</snippet></snippets>…</root>',
  rootUnderRoot: () => '<root> cannot be nested inside <root>',
  rootUnderRootFix: () =>
    'A layout file holds exactly one tree. Merge the inner <root> into the outer one, or split ' +
    'them into two layout files',

  missingRoot: () => 'The document has no <root> element',
  missingRootFix: () =>
    'The outermost element of a Panorama layout must be <root>; styles, scripts, snippets and ' +
    'the root panel all go inside it: ' +
    '<root><styles>…</styles><scripts>…</scripts><Panel>…</Panel></root>',
  duplicateRoot: () => '<root> may appear only once',
  duplicateRootFix: () =>
    'A layout file holds exactly one tree. Merge the contents of the extra <root> into the first ' +
    'one, or split them into two layout files',

  skeletonAfterPanel: (tag, panelTag) => `<${tag}> must come before the root panel <${panelTag}>`,
  skeletonAfterPanelFix: (tag, panelTag) =>
    `Move the whole <${tag}> block above the root panel <${panelTag}> — the skeleton elements ` +
    'under <root> may only appear before the root panel',
  skeletonDuplicate: (tag) => `<${tag}> may appear only once`,
  skeletonDuplicateFix: (tag) => `Merge the contents of this <${tag}> into the <${tag}> block above`,
  skeletonOutOfOrder: (tag, mustPrecede) => `<${tag}> must come before <${mustPrecede}>`,
  skeletonOutOfOrderFix: (order) =>
    `The skeleton elements under <root> have a fixed order: ${order}`,

  missingRootPanel: () => '<root> has no root panel',
  missingRootPanelFix: () =>
    'Besides <styles> / <scripts> / <snippets>, <root> must contain exactly one panel element as ' +
    'its root panel (for example <Panel> or <PopupCustomLayout>)',
  extraRootPanel: (tag) => `<root> may have only one root panel; <${tag}> is an extra one`,
  extraRootPanelFix: (tag) => `Move <${tag}> inside the first root panel as one of its children`,

  rootPanelId: (tag) => `The root panel <${tag}> cannot carry an id attribute`,
  rootPanelIdFix: () =>
    'The engine rejects an id on the root panel. The XSD allows it, but this is an engine ' +
    'constraint the schema cannot express. Use class="…" to attach styles and selectors instead',

  rootOnlyNested: (tag) => `${tag} can only be a root panel; it cannot be nested inside another panel`,
  rootOnlyNestedFix: () =>
    'These 43 types are marked rootOnly in data/panels.json, derived from the root element ' +
    'substitution group in the XSD. If you wanted an ordinary container here, use <Panel>; if ' +
    "this really is meant to be the layout's root, move it to be a direct child of <root>",

  attrMissingCloseQuote: (attr) => `The value of attribute ${attr} is missing its closing quote`,
  attrMissingCloseQuoteFix: (attr) =>
    'Attribute values must be wrapped in a matching pair of quotes and cannot span lines: ' +
    `${attr}="…"`,
  attrUnquoted: (attr) => `The value of attribute ${attr} is not quoted`,
  attrUnquotedFix: (attr) => `Panorama attribute values must be quoted: ${attr}="…"`,

  missingGt: (tag) => `The start tag <${tag}> is missing its >`,
  missingGtFix: (tag) =>
    `Add the >. With children, write <${tag}>…</${tag}>; without children, write <${tag} … />`,
  missingCloseTag: (tag) => `<${tag}> is missing its closing tag </${tag}>`,
  missingCloseTagFix: (tag) => `Add </${tag}>, or make it self-closing: <${tag} … />`,

  duplicateId: (id) => `The id ${id} is duplicated within the same scope`,
  duplicateIdFix: () =>
    'An id must be unique within its scope, otherwise FindChildTraverse in script will only ever ' +
    'return the first match. Use class for a group of repeated elements; the same name in ' +
    'different <snippet>s is not a duplicate, since each snippet is its own scope',
};
