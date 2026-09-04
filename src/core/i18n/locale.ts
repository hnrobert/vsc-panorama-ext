/**
 * 扩展支持的两种文案语言。
 *
 * 只有两种是刻意的（规格 D7）：语言跟随编辑器显示语言，而我们只维护中英两套
 * 译文。任何其它显示语言都回落到 en——这与 package.nls.json 作兜底的逻辑一致。
 *
 * 本文件刻意零依赖：数据层的 PropertyRegistry / PanelRegistry 只需要 Locale
 * 这个类型，不该为此被整个消息目录（src/core/i18n/types.ts 及两份实现）拖下水。
 */
export type Locale = 'zh-cn' | 'en';

/**
 * 把 VSCode 的 `env.language` 归并到我们维护的两种之一。
 *
 * 三处细节都是有理由的，且都有对应的测试咬住（篡改验证过）：
 *
 * - **前缀匹配而不是子串匹配**：子串会把 'en-zh' 这类标签误判成中文。
 * - **大小写不敏感**：env.language 的大小写形态由宿主决定，不由我们决定。
 * - **繁中归到简中而不是英文**：同为中文读者，简体的可读性远高于英文。
 *   VSCode 的中文语言包发布 zh-cn 与 zh-tw 两种，两者都会出现在这里。
 *
 * 拿不到语言（空串）时回落 en 而不是抛异常：本地化失败不该让整个扩展起不来。
 */
export function localeOf(envLanguage: string): Locale {
  return envLanguage.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
}
