/**
 * VCSS 诊断规则的 message 与 fix。
 *
 * 命名规则：`<规则短名>` 是 message，`<规则短名>Fix` 是 fix；同一规则有多种
 * fix 时再加后缀（如 `FixFlex` / `FixGrid`）。
 *
 * 规格 §10.1 要求每条 warning 都给出替代写法，不能只说「这个不行」——所以除
 * `unknownProperty` / `unknownValue` 这两条 hint 外，每条都有配套的 Fix。
 * 写英文译文时这条同样成立：把 fix 译成一句「不支持」等于毁掉规则的价值。
 */
export interface VcssMessages {
  // ── 规格 §10.1：能证明是错的 ──────────────────────────────────────────────
  webOnlyProperty(prop: string): string;
  webOnlyPropertyFixFlex(): string;
  webOnlyPropertyFixGrid(): string;

  positionKeyword(value: string): string;
  positionKeywordFix(): string;

  webUnit(unit: string): string;
  /** vw / vh 有专门的替代写法（锁宽高比），与 em / rem 不同，故分两条 */
  webUnitFixViewport(unit: string): string;
  webUnitFixFontRelative(unit: string): string;

  pseudoElement(text: string): string;
  pseudoElementFix(): string;

  visibilityHidden(): string;
  visibilityHiddenFix(): string;

  customProperty(prop: string): string;
  customPropertyFix(prop: string): string;

  varReference(name: string): string;
  varReferenceFix(): string;

  keyframesUnquoted(name: string): string;
  keyframesUnquotedFix(name: string): string;

  boxShadowColorFirst(): string;
  boxShadowColorFirstFix(): string;

  clipThenCover(): string;
  clipThenCoverFix(): string;

  // ── 规格 §10.1 的跨文件两条 ───────────────────────────────────────────────
  unknownDefine(name: string): string;
  unknownDefineFix(name: string): string;

  unknownKeyframes(name: string): string;
  unknownKeyframesFix(name: string): string;

  // ── 规格 §10.2：只是没见过，级别只到 hint ─────────────────────────────────
  unknownProperty(property: string): string;
  unknownPropertyFix(): string;

  unknownValue(value: string, property: string): string;
  unknownValueFix(property: string, known: readonly string[]): string;
}
