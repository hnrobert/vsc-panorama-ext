import type { HudMessages } from '../types-hud';

/* 逐字搬自 src/core/diagnostics/custom-hud.ts 的原文，一个字都没改。 */
export const hud: HudMessages = {
  panelNotAllowed: (tag) => `CustomHudLayout 不支持 <${tag}>`,
  panelNotAllowedFix: () =>
    'CustomHudLayout 只开放 <Panel> / <Label> / <Image> / <Button> 四种面板' +
    '（规格 §6.2）。容器用 <Panel>，文字用 <Label>，图片用 <Image>，可点击的用 <Button>；' +
    '这四种之外的面板类型在自定义 HUD 里不会被引擎实例化',

  inlineStyle: () => 'CustomHudLayout 不支持 style 内联属性',
  inlineStyleFix: () =>
    '样式必须走 .vcss + class：把这段写进自己的样式表里做成一条 class 规则，' +
    '用 <styles><include src="s2r://…css" /></styles> 引进来，再用 class="…" 挂上。' +
    'CustomHudLayout 对样式本身没有任何限制，VCSS 全套能力都可用',

  eventAttribute: (attr) => `CustomHudLayout 不支持事件属性 ${attr}`,
  eventAttributeFix: () =>
    '自定义 HUD 里没有客户端脚本环境，全部 on* 事件属性与 <scripts> 块都不可用。' +
    '需要动态内容时改用服务端下发的 {s:变量}，交互效果用 VCSS 的伪类（:hover 等）',

  buttonText: () => '<Button> 不支持 text 属性，按钮文字请用子 <Label>',
  buttonTextFix: () =>
    '<Button class="…"><Label text="确定" /></Button>——CustomHudLayout 的 <Button> ' +
    '白名单只有 id 与 class（规格 §6.2），文字一律由子 <Label> 承载',

  attributeNotAllowed: (tag, attr) => `<${tag}> 在 CustomHudLayout 里不支持 ${attr} 属性`,
  attributeNotAllowedFix: (tag, allowed) =>
    `<${tag}> 只能用 ${allowed}（规格 §6.2）。` +
    '需要的表现能力基本都能用 class + .vcss 做出来——白名单管的是布局属性，样式不受限',

  binding: (kind) => `CustomHudLayout 不开放 ${kind} 绑定`,
  bindingFix: () =>
    '{d:} / {g:} / {t:} 由客户端脚本或引擎驱动，不对自定义内容开放；' +
    '只有 {s:变量} 可用（由服务端 SetDialogVariableString 填充）',

  scripts: () => 'CustomHudLayout 不支持 <scripts> 块',
  scriptsFix: () =>
    '自定义 HUD 里没有客户端脚本环境。动态内容改用服务端下发的 {s:变量}，' +
    '交互效果用 VCSS 的伪类（:hover 等）',

  snippetsOrFrame: (tag) => `CustomHudLayout 不支持 <${tag}>`,
  snippetsOrFrameFix: () =>
    '片段（<snippets> / <snippet>）与 <Frame> 这类复用机制在自定义 HUD 里不可用，' +
    '重复的结构需要逐个写出来。相同的外观用同一个 class 共享',
};
