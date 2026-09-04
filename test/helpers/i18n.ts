import { messagesFor } from '../../src/core/i18n';

/**
 * 单元测试默认跑中文目录。
 *
 * 这样既有的散文断言（`detail` 等于 '其它样式表的 @define' 之类）原样保留，
 * 本地化改造不需要把它们逐条改写——改写它们等于让「文案是否正确」这件事
 * 失去基线。
 *
 * **英文路径不靠这批测试覆盖**，由三处专门负责：
 *   1. test/unit/core/data/*-i18n.test.ts —— 数据层双语完整性
 *   2. test/unit/core/diagnostics/no-chinese-in-english.test.ts —— 全部 28 条规则的英文产出无汉字
 *   3. test/e2e/suite/extension.test.ts —— 真实宿主里 env.language 那条链路
 */
export const ZH = messagesFor('zh-cn');

/** 英文目录。给需要同时对照两种语言的测试用。 */
export const EN = messagesFor('en');
