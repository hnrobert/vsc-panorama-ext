/**
 * CustomHudLayout 严格模式（规格 §10.3）的 message 与 fix。
 *
 * 这七条规则全是 **error** 级——它们不是「可能有问题」，而是引擎在自定义 HUD
 * 里确定不会实例化的写法。所以 fix 尤其要把「那该怎么写」说完整：用户在这里
 * 是被硬性挡住的，只说「不支持」等于把人卡死。
 */
export interface HudMessages {
  /** 面板类型不在四面板白名单内 */
  panelNotAllowed(tag: string): string;
  panelNotAllowedFix(): string;

  /** 内联 style 属性 */
  inlineStyle(): string;
  inlineStyleFix(): string;

  /** on* 事件属性 */
  eventAttribute(attr: string): string;
  eventAttributeFix(): string;

  /** <Button> 的 text 属性 */
  buttonText(): string;
  buttonTextFix(): string;

  /** 属性不在该面板的白名单内。allowed 已由调用方拼成 `id= class=` 这样的串 */
  attributeNotAllowed(tag: string, attr: string): string;
  attributeNotAllowedFix(tag: string, allowed: string): string;

  /** {d:} / {g:} / {t:} 绑定 */
  binding(kind: string): string;
  bindingFix(): string;

  /** <scripts> 块 */
  scripts(): string;
  scriptsFix(): string;

  /** <snippets> / <snippet> / <Frame> 这类复用机制 */
  snippetsOrFrame(tag: string): string;
  snippetsOrFrameFix(): string;
}
