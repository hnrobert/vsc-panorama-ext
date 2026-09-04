import type { HudMessages } from '../types-hud';

/* 与 zh-cn/hud.ts 逐条对应，顺序相同。 */
export const hud: HudMessages = {
  panelNotAllowed: (tag) => `CustomHudLayout does not support <${tag}>`,
  panelNotAllowedFix: () =>
    'CustomHudLayout exposes only four panel types: <Panel> / <Label> / <Image> / <Button> ' +
    '(spec §6.2). Use <Panel> for containers, <Label> for text, <Image> for pictures and ' +
    '<Button> for anything clickable; the engine will not instantiate any other panel type ' +
    'inside a custom HUD',

  inlineStyle: () => 'CustomHudLayout does not support the inline style attribute',
  inlineStyleFix: () =>
    'Styling has to go through .vcss + class: move these declarations into your own stylesheet ' +
    'as a class rule, pull it in with <styles><include src="s2r://…css" /></styles>, then attach ' +
    'it with class="…". CustomHudLayout places no restrictions on styling itself — the full VCSS ' +
    'feature set is available',

  eventAttribute: (attr) => `CustomHudLayout does not support the event attribute ${attr}`,
  eventAttributeFix: () =>
    'There is no client-side scripting environment in a custom HUD, so every on* event attribute ' +
    'and the <scripts> block are unavailable. For dynamic content use {s:variable} pushed from ' +
    'the server, and for interactive effects use VCSS pseudo-classes such as :hover',

  buttonText: () => '<Button> does not support a text attribute; put the button label in a child <Label>',
  buttonTextFix: () =>
    '<Button class="…"><Label text="OK" /></Button> — the CustomHudLayout whitelist for <Button> ' +
    'is only id and class (spec §6.2), and the text is always carried by a child <Label>',

  attributeNotAllowed: (tag, attr) =>
    `<${tag}> does not support the ${attr} attribute in CustomHudLayout`,
  attributeNotAllowedFix: (tag, allowed) =>
    `<${tag}> may only use ${allowed} (spec §6.2). ` +
    'Almost anything you need visually can be done with class + .vcss — the whitelist governs ' +
    'layout attributes, not styling',

  binding: (kind) => `CustomHudLayout does not expose ${kind} bindings`,
  bindingFix: () =>
    '{d:} / {g:} / {t:} are driven by client-side script or by the engine and are not exposed to ' +
    'custom content; only {s:variable} is available, filled in by SetDialogVariableString on the ' +
    'server',

  scripts: () => 'CustomHudLayout does not support the <scripts> block',
  scriptsFix: () =>
    'There is no client-side scripting environment in a custom HUD. Use {s:variable} pushed from ' +
    'the server for dynamic content, and VCSS pseudo-classes such as :hover for interactive effects',

  snippetsOrFrame: (tag) => `CustomHudLayout does not support <${tag}>`,
  snippetsOrFrameFix: () =>
    'Reuse mechanisms such as snippets (<snippets> / <snippet>) and <Frame> are unavailable in a ' +
    'custom HUD; repeated structure has to be written out one by one. Share a single class to ' +
    'give them the same appearance',
};
