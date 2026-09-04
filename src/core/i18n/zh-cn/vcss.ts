import type { VcssMessages } from '../types-vcss';

/*
 * 逐字搬自 src/core/diagnostics/vcss.ts 的原文，一个字都没改。
 *
 * 搬运而不是重写是刻意的：改动任何一个字都等于在本地化改造里混进行为变更，
 * 而这批文案里多数条目没有测试咬住（M4 终评的 M-8），改坏了不会红。
 */
export const vcss: VcssMessages = {
  webOnlyProperty: (prop) => `${prop} 是 Web 独有属性，Panorama 引擎不支持`,
  webOnlyPropertyFixFlex: () =>
    'Panorama 没有这个 flex 相关属性。改用 flow-children 控制排列方向，配合 width/height: fill-parent-flow(权重) 分配剩余空间',
  webOnlyPropertyFixGrid: () =>
    'Panorama 没有这个 grid 相关属性。改用嵌套 Panel + flow-children 搭出行列结构',

  positionKeyword: (value) =>
    `position: ${value} 是 Web 的定位关键字，Panorama 的 position 是 x y z 三轴偏移量`,
  positionKeywordFix: () =>
    'Panorama 没有 static/relative/absolute/fixed/sticky 这套定位模型。改用 position: x y z（或单独写 x / y / z），配合 flow-children: none 使用',

  webUnit: (unit) => `单位 ${unit} 是 Web 专属单位，Panorama 不支持`,
  webUnitFixViewport: (unit) =>
    `Panorama 没有 ${unit}。改用 % 相对父级尺寸，或 width-percentage() / height-percentage() 锁定宽高比`,
  webUnitFixFontRelative: (unit) => `Panorama 没有 ${unit}。改用 px 绝对尺寸，或 % 相对父级尺寸`,

  pseudoElement: (text) => `${text} 是 Web 伪元素，Panorama 不支持`,
  pseudoElementFix: () => 'Panorama 没有 ::before / ::after。改用真实的子 Panel 承载这部分内容',

  visibilityHidden: () => 'visibility: hidden 在 Panorama 不存在',
  visibilityHiddenFix: () =>
    'Panorama 没有 hidden。改用 visibility: collapse（隐藏并从布局中移除，不占位）；只想保留占位则用 opacity: 0',

  customProperty: (prop) => `${prop} 是 CSS 自定义属性写法，Panorama 用 @define`,
  customPropertyFix: (prop) =>
    `改用 @define 名字: 值; 定义常量，然后直接按名字引用（不需要 ${prop} 或 var()）`,

  varReference: (name) => `var(${name}) 是 CSS 自定义属性引用写法，Panorama 用 @define`,
  varReferenceFix: () => '改用 @define 定义常量后直接写常量名引用，不需要 var()',

  keyframesUnquoted: (name) => `@keyframes ${name} 的名字未加引号`,
  keyframesUnquotedFix: (name) => `@keyframes 的名字必须加引号，例如 '${name}'`,

  boxShadowColorFirst: () => 'box-shadow 首个取值不是颜色，Panorama 的颜色写在最前面',
  boxShadowColorFirstFix: () =>
    '改成颜色在前：box-shadow: [fill|hollow|inset] 颜色 x y blur spread（和 Web 顺序相反）',

  clipThenCover: () =>
    'background-size: clip_then_cover 不是引擎关键字，是反编译器给某个背景缩放枚举值起的标签',
  clipThenCoverFix: () => '改用 background-size: contain / auto，或直接写像素 / 百分比',

  unknownDefine: (name) => `${name} 不是工作区中已定义的 @define 常量`,
  unknownDefineFix: (name) =>
    `检查拼写是否正确，或在某个被这个样式表引入的文件里用 @define ${name}: 值; 定义它`,

  unknownKeyframes: (name) => `animation-name 引用的 '${name}' 不是工作区中已定义的 @keyframes`,
  unknownKeyframesFix: (name) =>
    `检查拼写是否正确，或在某个被这个样式表引入的文件里用 @keyframes '${name}' { ... } 定义它`,

  unknownProperty: (property) => `${property} 不在已知的 VCSS 属性清单里`,
  unknownPropertyFix: () =>
    'data/vcss-properties.json 的属性清单是人工整理的、已知不全（规格 §5.2），' +
    '引擎实际支持的属性比它多。先检查拼写；确认无误可以忽略这条提示',

  unknownValue: (value, property) => `${value} 不在 ${property} 的已知取值集合里`,
  unknownValueFix: (property, known) =>
    `${property} 的已知取值：${known.join(' / ')}。这份清单是人工整理的、` +
    '可能不全（规格 §5.2）——先检查拼写，确认无误可以忽略这条提示',
};
