import type { UiMessages } from '../types';

/*
 * 这一份是从 src/core/features/ 逐字搬过来的原文，不是重写。
 * 改动任何一个字都等于在本地化改造里混进了行为变更——而多数文案没有测试咬住。
 */
export const ui: UiMessages = {
  panoramaOnly: () => 'Panorama 专属',
  values: (list) => `取值：${list.join(' | ')}`,
  webEquivalent: (s) => `Web 对应写法：${s}`,
  panoramaOnlyNote: () => 'Panorama 专属属性，标准 CSS 中不存在或语义不同。',
  defineInCurrentFile: (value) => `${value}（当前文件）`,
  defineFromOtherSheet: () => '其它样式表的 @define',
  keyframesFromOtherSheet: () => '其它样式表的 @keyframes',
  seenInCorpusOnly: () => '语料中出现过（未经核对）',
  defineHover: (value) => `\`@define\` 常量（编译期文本替换）\n\n当前值：\`${value}\``,
  declarationCount: (n) => `${n} 条声明`,
  stylesheetIncluded: (included) => (included ? '已引入的样式表' : '工作区其它样式表'),
  panelType: (derivedFrom) =>
    derivedFrom ? `面板类型，继承自 \`${derivedFrom}\`` : '面板类型（基础类型）',
  rootOnlyNote: () => '⚠️ 只能作根面板，不可用作嵌套子元素',
  whitelistNote: (allowed) =>
    allowed ? '✅ 在 CustomHudLayout 白名单内' : '❌ 不在 CustomHudLayout 白名单内，此处不可用',
  attributeOf: (declarer) => (declarer ? `属性，声明于 \`${declarer}\`` : '属性'),
  bindingDoc: (kind) =>
    ({
      s: '字符串 Dialog 变量，由服务端 SetDialogVariableString 填充',
      d: '另一种 dialog 数据绑定（官方 UI 使用）',
      g: '游戏/全局数据，可带参数段',
      t: 'token / 翻译型绑定',
    })[kind],
  continueCompletion: () => '继续补全下一段',
};
