import type { VxmlMessages } from '../types-vxml';

/* 逐字搬自 src/core/diagnostics/vxml.ts 的原文，一个字都没改。 */
export const vxml: VxmlMessages = {
  unknownTag: (tag) => `${tag} 不是已知的面板类型`,
  unknownTagFix: () =>
    'data/panels.json 由 CS2 的 panorama_generate_layout_xsd 生成，是引擎自述的' +
    '面板清单。先检查拼写与大小写；若确认引擎认这个类型，说明它是 XSD 的缺口，' +
    '需要补进 data/vxml-observed-attributes.json 的观测层',

  unknownAttribute: (attr, tag) => `${attr} 不属于 ${tag} 的属性集（含继承）`,
  unknownAttributeFix: (tag) =>
    `${tag} 的属性集来自 XSD，而 XSD 的属性集已知不完整（规格 §5.1 / D-M4-1，` +
    '语料里有 554 处合法属性不在集内）——所以这条只是 hint。先检查拼写与大小写；' +
    '确认引擎认这个属性可以忽略，或补进 data/vxml-observed-attributes.json 的观测层',

  unknownClass: (name) => `类名 ${name} 在索引中找不到定义`,
  unknownClassFix: () => '检查拼写是否正确，或确认对应的 .vcss/.css 样式表已经被这个布局引入',

  includeUnderRoot: () => '<include> 不能直接写在 <root> 下',
  includeUnderRootFix: () =>
    '把它移进 <styles>（引样式表）或 <scripts>（引脚本）块里：' +
    '<root><styles><include src="…" /></styles>…</root>',
  snippetUnderRoot: () => '<snippet> 不能直接写在 <root> 下',
  snippetUnderRootFix: () =>
    '片段模板必须包在 <snippets> 里：' +
    '<root><snippets><snippet name="…">…</snippet></snippets>…</root>',
  rootUnderRoot: () => '<root> 不能嵌套在 <root> 里',
  rootUnderRootFix: () =>
    '一个布局文件只有一棵树。把里层 <root> 的内容并进外层，或者拆成两个布局文件',

  missingRoot: () => '文档缺少 <root> 根元素',
  missingRootFix: () =>
    'Panorama 布局的最外层必须是 <root>，样式、脚本、片段与根面板都写在它里面：' +
    '<root><styles>…</styles><scripts>…</scripts><Panel>…</Panel></root>',
  duplicateRoot: () => '<root> 只能出现一次',
  duplicateRootFix: () =>
    '一个布局文件只有一棵树。把多出来的 <root> 里的内容并进第一个 <root>，' + '或者拆成两个布局文件',

  skeletonAfterPanel: (tag, panelTag) => `<${tag}> 必须写在根面板 <${panelTag}> 之前`,
  skeletonAfterPanelFix: (tag, panelTag) =>
    `把 <${tag}> 整块移到根面板 <${panelTag}> 上面去——` + '<root> 的骨架元素只能出现在根面板之前',
  skeletonDuplicate: (tag) => `<${tag}> 只能出现一次`,
  skeletonDuplicateFix: (tag) => `把这个 <${tag}> 里的内容并进上面那个 <${tag}> 块`,
  skeletonOutOfOrder: (tag, mustPrecede) => `<${tag}> 必须写在 <${mustPrecede}> 之前`,
  skeletonOutOfOrderFix: (order) => `<root> 下骨架元素的顺序固定为 ${order}`,

  missingRootPanel: () => '<root> 下没有根面板',
  missingRootPanelFix: () =>
    '<root> 里除了 <styles> / <scripts> / <snippets> 之外，还必须有且只有一个' +
    '面板元素作根面板（如 <Panel>、<PopupCustomLayout>）',
  extraRootPanel: (tag) => `<root> 下只能有一个根面板，<${tag}> 是多出来的`,
  extraRootPanelFix: (tag) => `把 <${tag}> 挪进第一个根面板里作它的子元素`,

  rootPanelId: (tag) => `根面板 <${tag}> 不能带 id 属性`,
  rootPanelIdFix: () =>
    '引擎不接受根面板上的 id（XSD 允许，但这是 schema 管不到的引擎约束）。' +
    '改用 class="…" 来给它挂样式与选择器',

  rootOnlyNested: (tag) => `${tag} 只能作根面板，不能嵌套在其他面板里`,
  rootOnlyNestedFix: () =>
    'data/panels.json 里这 43 种类型标了 rootOnly（由 XSD 的根元素替换组推导）。' +
    '若这里想要的是一个普通容器，改用 <Panel>；若它确实该是这个布局的根，' +
    '把它移到 <root> 的直接子元素位置',

  attrMissingCloseQuote: (attr) => `属性 ${attr} 的值缺少右引号`,
  attrMissingCloseQuoteFix: (attr) => '属性值必须由成对的引号包起来，且不能跨行：' + `${attr}="…"`,
  attrUnquoted: (attr) => `属性 ${attr} 的值没有加引号`,
  attrUnquotedFix: (attr) => `Panorama 的属性值必须加引号：${attr}="…"`,

  missingGt: (tag) => `开始标签 <${tag}> 缺少 >`,
  missingGtFix: (tag) => `补上 >（有子元素时写 <${tag}>…</${tag}>，没有子元素时写 <${tag}> … />）`,
  missingCloseTag: (tag) => `<${tag}> 缺少闭合标签 </${tag}>`,
  missingCloseTagFix: (tag) => `补上 </${tag}>，或者把它改成自闭合的 <${tag} … />`,

  duplicateId: (id) => `id ${id} 在同一作用域内重复`,
  duplicateIdFix: () =>
    'id 在同一个作用域里必须唯一，否则脚本的 FindChildTraverse 只会拿到第一个。' +
    '同一组重复的元素改用 class；<snippet> 之间同名不算重复，各自是独立作用域',
};
