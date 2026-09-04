import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XSD_PATH } from './paths.mjs';

// <root> 的 sequence 里这几个不是面板
const STRUCTURAL = new Set(['root', 'styles', 'scripts', 'snippets']);

// 属性 documentation 形如：
//   &lt;b&gt;text&lt;/b&gt; (from Label)&lt;br /&gt;&lt;br /&gt;可选的真实描述
const DOC_RE =
  /&lt;b&gt;([^&]+)&lt;\/b&gt;\s*\(from ([^)]+)\)&lt;br \/&gt;&lt;br \/&gt;([\s\S]*?)<\/xs:documentation>/;

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/** 取具名 complexType 的正文。该文件中具名 complexType 不嵌套，故首个闭合标签即为对应闭合。 */
export function sliceComplexType(text, name) {
  const open = text.indexOf(`<xs:complexType name="${name}">`);
  if (open === -1) return '';
  const close = text.indexOf('</xs:complexType>', open);
  return text.slice(open, close === -1 ? undefined : close);
}

/** 取 <xs:element name="root"> 内那个 xs:choice 起至文件末尾（root 是最后一个顶层元素）。 */
export function sliceRootChoice(text) {
  const open = text.indexOf('<xs:element name="root">');
  if (open === -1) return '';
  const choice = text.indexOf('<xs:choice', open);
  return choice === -1 ? '' : text.slice(choice);
}

export function collectElementNames(slice) {
  return [...slice.matchAll(/<xs:element name="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * @typedef {{derivedFrom: string|null, sets: string[], rootOnly: boolean}} PanelInfo
 * @typedef {{
 *   attributeSets: Record<string, string[]>,
 *   attributeDocs: Record<string, string>,
 *   panels: Record<string, PanelInfo>,
 *   generatedFrom?: string
 * }} PanelData
 */

/**
 * 把运行时 XSD 解析成查询友好的面板数据。
 * @param {string} text XSD 全文
 * @returns {PanelData}
 */
export function parseXsd(text) {
  const childAllowed = new Set(collectElementNames(sliceComplexType(text, 'Internal_BaseType')));
  const rootAllowed = new Set(
    collectElementNames(sliceRootChoice(text)).filter((n) => !STRUCTURAL.has(n)),
  );

  /** @type {Record<string, Set<string>>} */
  const attributeSets = {};
  /** @type {Record<string, string>} */
  const attributeDocs = {};
  /** @type {Record<string, {derivedFrom: string|null, sets: string[], rootOnly: boolean}>} */
  const panels = {};

  const typeRe = /<xs:complexType name="([^"]+)">/g;
  let m;
  while ((m = typeRe.exec(text)) !== null) {
    const typeName = m[1];
    if (typeName.startsWith('Internal_')) continue;

    const panelName = typeName.replace(/Type$/, '');
    const close = text.indexOf('</xs:complexType>', m.index);
    const body = text.slice(m.index, close === -1 ? undefined : close);

    const derived = body.match(/\(derived from ([^)]+)\)/);
    const declarers = new Set();

    // 按 <xs:attribute name=" 切块，每块自带其 annotation
    for (const chunk of body.split('<xs:attribute name="').slice(1)) {
      const attrName = chunk.slice(0, chunk.indexOf('"'));
      const doc = chunk.match(DOC_RE);
      const declarer = doc ? doc[2] : panelName;

      declarers.add(declarer);
      (attributeSets[declarer] ??= new Set()).add(attrName);

      if (doc) {
        const desc = decodeEntities(doc[3]);
        if (desc && !attributeDocs[attrName]) attributeDocs[attrName] = desc;
      }
    }

    panels[panelName] = {
      derivedFrom: derived ? derived[1] : null,
      sets: [...declarers].sort(),
      rootOnly: rootAllowed.has(panelName) && !childAllowed.has(panelName),
    };
  }

  const sortObj = (obj, mapVal = (v) => v) =>
    Object.fromEntries(
      Object.entries(obj)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, mapVal(v)]),
    );

  return /** @type {PanelData} */ ({
    attributeSets: sortObj(attributeSets, (set) => [...set].sort()),
    attributeDocs: sortObj(attributeDocs),
    panels: sortObj(panels),
  });
}

// CLI：node tools/gen-panel-data.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../data/panels.json');
  const data = parseXsd(readFileSync(XSD_PATH, 'utf8'));
  data.generatedFrom = 'panorama_generate_layout_xsd.txt (CS2 build 20260829)';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const rootOnly = Object.values(data.panels).filter((p) => p.rootOnly).length;
  console.log(
    `已写出 ${out}\n  面板 ${Object.keys(data.panels).length} 种（其中 rootOnly ${rootOnly} 种）` +
      `\n  属性名 ${new Set(Object.values(data.attributeSets).flat()).size} 个` +
      `\n  带描述的属性 ${Object.keys(data.attributeDocs).length} 个`,
  );
}
