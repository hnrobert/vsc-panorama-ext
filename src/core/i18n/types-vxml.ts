/**
 * VXML 诊断规则的 message 与 fix。命名与 VcssMessages 同规则。
 *
 * 结构类规则（`vxml.structure`）一条 ruleId 底下有 8 种不同情形，各自的
 * message / fix 完全不同，所以接口按**情形**而不是按 ruleId 拆成 8 组。
 */
export interface VxmlMessages {
  // ── 标签与属性 ────────────────────────────────────────────────────────────
  unknownTag(tag: string): string;
  unknownTagFix(): string;

  unknownAttribute(attr: string, tag: string): string;
  unknownAttributeFix(tag: string): string;

  // ── 跨文件 ────────────────────────────────────────────────────────────────
  unknownClass(name: string): string;
  unknownClassFix(): string;

  // ── 结构：<root> 下位置错了的元素（原 MISPLACED_UNDER_ROOT 常量表）────────
  includeUnderRoot(): string;
  includeUnderRootFix(): string;
  snippetUnderRoot(): string;
  snippetUnderRootFix(): string;
  rootUnderRoot(): string;
  rootUnderRootFix(): string;

  // ── 结构：<root> 本身 ─────────────────────────────────────────────────────
  missingRoot(): string;
  missingRootFix(): string;
  duplicateRoot(): string;
  duplicateRootFix(): string;

  // ── 结构：骨架元素的位置与顺序 ────────────────────────────────────────────
  skeletonAfterPanel(tag: string, panelTag: string): string;
  skeletonAfterPanelFix(tag: string, panelTag: string): string;
  skeletonDuplicate(tag: string): string;
  skeletonDuplicateFix(tag: string): string;
  skeletonOutOfOrder(tag: string, mustPrecede: string): string;
  /** order 已由调用方拼成 `<styles> → <scripts> → <snippets>` 这样的串 */
  skeletonOutOfOrderFix(order: string): string;

  // ── 结构：根面板 ──────────────────────────────────────────────────────────
  missingRootPanel(): string;
  missingRootPanelFix(): string;
  extraRootPanel(tag: string): string;
  extraRootPanelFix(tag: string): string;

  // ── 根面板不能带 id（XSD 查不出的引擎约束）────────────────────────────────
  rootPanelId(tag: string): string;
  rootPanelIdFix(): string;

  // ── rootOnly 面板出现在嵌套位置 ───────────────────────────────────────────
  rootOnlyNested(tag: string): string;
  rootOnlyNestedFix(): string;

  // ── 语法：属性引号 ────────────────────────────────────────────────────────
  attrMissingCloseQuote(attr: string): string;
  attrMissingCloseQuoteFix(attr: string): string;
  attrUnquoted(attr: string): string;
  attrUnquotedFix(attr: string): string;

  // ── 语法：标签未闭合 ──────────────────────────────────────────────────────
  missingGt(tag: string): string;
  missingGtFix(tag: string): string;
  missingCloseTag(tag: string): string;
  missingCloseTagFix(tag: string): string;

  // ── id 重复 ───────────────────────────────────────────────────────────────
  duplicateId(id: string): string;
  duplicateIdFix(): string;
}
