import type { VcssMessages } from '../types-vcss';

/*
 * 与 zh-cn/vcss.ts 逐条对应，顺序相同——两份并排打开就能逐行比对。
 *
 * 每条 fix 都必须回答「改成什么」。规格 §10.1 对所有 warning 都要求给出替代
 * 写法，那是产品承诺而不是文风偏好：把 fix 压成一句 "not supported" 等于把
 * 这条规则的价值抹掉。
 */
export const vcss: VcssMessages = {
  webOnlyProperty: (prop) =>
    `${prop} is a Web-only property; the Panorama engine does not support it`,
  webOnlyPropertyFixFlex: () =>
    'Panorama has no flex-family properties. Use flow-children to control the layout direction, and width/height: fill-parent-flow(weight) to divide up the remaining space',
  webOnlyPropertyFixGrid: () =>
    'Panorama has no grid-family properties. Build rows and columns out of nested Panels with flow-children',

  positionKeyword: (value) =>
    `position: ${value} is a Web positioning keyword; Panorama's position is an x y z offset on three axes`,
  positionKeywordFix: () =>
    'Panorama has no static/relative/absolute/fixed/sticky positioning model. Use position: x y z (or write x / y / z separately), inside a parent with flow-children: none',

  webUnit: (unit) => `${unit} is a Web-only unit; Panorama does not support it`,
  webUnitFixViewport: (unit) =>
    `Panorama has no ${unit}. Use % to size relative to the parent, or width-percentage() / height-percentage() to lock an aspect ratio`,
  webUnitFixFontRelative: (unit) =>
    `Panorama has no ${unit}. Use px for absolute sizes, or % to size relative to the parent`,

  pseudoElement: (text) => `${text} is a Web pseudo-element; Panorama does not support it`,
  pseudoElementFix: () =>
    'Panorama has no ::before / ::after. Use a real child Panel to hold that content',

  visibilityHidden: () => 'visibility: hidden does not exist in Panorama',
  visibilityHiddenFix: () =>
    'Panorama has no hidden. Use visibility: collapse, which hides the panel and removes it from layout so it takes up no space; to keep the space reserved, use opacity: 0 instead',

  customProperty: (prop) => `${prop} is CSS custom-property syntax; Panorama uses @define`,
  customPropertyFix: (prop) =>
    `Declare the constant with @define name: value; then reference it by name directly (no ${prop} and no var())`,

  varReference: (name) =>
    `var(${name}) is CSS custom-property reference syntax; Panorama uses @define`,
  varReferenceFix: () =>
    'Declare the constant with @define and reference it by name directly; var() is not needed',

  keyframesUnquoted: (name) => `The @keyframes name ${name} is not quoted`,
  keyframesUnquotedFix: (name) => `@keyframes names must be quoted, for example '${name}'`,

  boxShadowColorFirst: () =>
    "box-shadow's first value is not a color; in Panorama the color comes first",
  boxShadowColorFirstFix: () =>
    'Put the color first: box-shadow: [fill|hollow|inset] color x y blur spread — the reverse of the Web order',

  clipThenCover: () =>
    'background-size: clip_then_cover is not an engine keyword; it is a label the decompiler gave to one of the background-scaling enum values',
  clipThenCoverFix: () =>
    'Use background-size: contain / auto, or write pixels / percentages directly',

  unknownDefine: (name) => `${name} is not an @define constant defined anywhere in the workspace`,
  unknownDefineFix: (name) =>
    `Check the spelling, or define it with @define ${name}: value; in a file that this stylesheet imports`,

  unknownKeyframes: (name) =>
    `animation-name refers to '${name}', which is not a @keyframes defined anywhere in the workspace`,
  unknownKeyframesFix: (name) =>
    `Check the spelling, or define it with @keyframes '${name}' { ... } in a file that this stylesheet imports`,

  unknownProperty: (property) => `${property} is not in the known VCSS property list`,
  unknownPropertyFix: () =>
    'The property list in data/vcss-properties.json is maintained by hand and is known to be incomplete (spec §5.2); ' +
    'the engine supports more properties than it lists. Check the spelling first — if it is correct, this hint can be ignored',

  unknownValue: (value, property) => `${value} is not in the known set of values for ${property}`,
  unknownValueFix: (property, known) =>
    `Known values for ${property}: ${known.join(' / ')}. This list is maintained by hand and ` +
    'may be incomplete (spec §5.2) — check the spelling first; if it is correct, this hint can be ignored',
};
