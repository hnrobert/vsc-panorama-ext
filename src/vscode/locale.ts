import * as vscode from 'vscode';
import { localeOf } from '../core/i18n/locale';
import type { Locale } from '../core/i18n/locale';

/**
 * 本进程的文案语言，一次性确定。
 *
 * 不需要响应式重算，也不需要监听任何事件：改编辑器显示语言会强制重载窗口，
 * 扩展宿主随之重启，这个模块级常量自然重新求值。这也是规格 D7 选择「只跟随
 * 显示语言」而不加设置项的附带好处——设置项可以随时改，就必须处理热切换。
 */
export const LOCALE: Locale = localeOf(vscode.env.language);
