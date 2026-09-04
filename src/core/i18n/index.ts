import type { Locale } from './locale';
import type { Messages } from './types';
import { zhCN } from './zh-cn';
import { en } from './en';

export type { Locale } from './locale';
export { localeOf } from './locale';
export type { Messages, UiMessages, VcssMessages, VxmlMessages, HudMessages } from './types';

/**
 * 取指定语言的消息目录。
 *
 * 目录是模块级常量，两份都在 import 时就建好了——没有懒加载，也不需要缓存：
 * 全部内容是纯函数与字符串字面量，两份加起来的构造开销可以忽略，而省掉懒加载
 * 就少一处可能忘了初始化的状态。
 */
export function messagesFor(locale: Locale): Messages {
  return locale === 'zh-cn' ? zhCN : en;
}
