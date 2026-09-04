import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { tokenize, tokenizeLines, scopesOf } from './harness';

const SCOPE = 'source.css.panorama-vcss';
// vitest 走 ESM，没有 __dirname
const GRAMMAR = fileURLToPath(
  new URL('../../../syntaxes/panorama-vcss.tmLanguage.json', import.meta.url),
);

const tok = (line: string) => tokenize(SCOPE, GRAMMAR, line);

describe('VCSS 语法高亮 · Panorama 专属语法', () => {
  it('@define 常量声明：关键字与常量名分开', async () => {
    const tokens = await tok('@define blueColor: #3281AC;');
    expect(scopesOf(tokens, '@define')).toContain('keyword.control.at-rule.define.panorama-vcss');
    expect(scopesOf(tokens, 'blueColor')).toContain('variable.other.constant.panorama-vcss');
    expect(scopesOf(tokens, '#3281AC')).toContain('constant.other.color.rgb-value.panorama-vcss');
  });

  it('@keyframes 的引号名字被识别为实体名', async () => {
    const tokens = await tok("@keyframes 'advertising-ring-active'");
    expect(scopesOf(tokens, '@keyframes')).toContain(
      'keyword.control.at-rule.keyframes.panorama-vcss',
    );
    expect(scopesOf(tokens, "'advertising-ring-active'")).toContain(
      'entity.name.function.keyframe.panorama-vcss',
    );
  });

  it('@import 的编译路径被识别', async () => {
    const tokens = await tok('@import url("s2r://panorama/styles/csgostyles.vcss_c");');
    expect(scopesOf(tokens, '@import')).toContain('keyword.control.at-rule.import.panorama-vcss');
  });

  it('Panorama 函数有独立作用域', async () => {
    const tokens = await tok('.row { width: fill-parent-flow(1.0); }');
    expect(scopesOf(tokens, 'fill-parent-flow')).toContain('support.function.panorama.panorama-vcss');
  });

  it('world-blur 的 mipmapgaussian 也被识别', async () => {
    const tokens = await tok('.bg { world-blur: mipmapgaussian(6, 6, 4); }');
    expect(scopesOf(tokens, 'mipmapgaussian')).toContain('support.function.panorama.panorama-vcss');
  });

  it('八位颜色 #RRGGBBAA 被识别', async () => {
    const tokens = await tok('.x { wash-color: #39b0d325; }');
    expect(scopesOf(tokens, '#39b0d325')).toContain('constant.other.color.rgb-value.panorama-vcss');
  });
});

describe('VCSS 语法高亮 · 选择器与声明', () => {
  it('类选择器', async () => {
    const tokens = await tok('.item-tile { }');
    expect(scopesOf(tokens, '.item-tile')).toContain(
      'entity.other.attribute-name.class.panorama-vcss',
    );
  });

  it('id 选择器', async () => {
    const tokens = await tok('#HealthBar { }');
    expect(scopesOf(tokens, '#HealthBar')).toContain('entity.other.attribute-name.id.panorama-vcss');
  });

  it('按面板类型选择', async () => {
    const tokens = await tok('CSColorPicker { }');
    expect(scopesOf(tokens, 'CSColorPicker')).toContain('entity.name.tag.panel.panorama-vcss');
  });

  it('伪类', async () => {
    const tokens = await tok('.btn:hover { }');
    expect(scopesOf(tokens, ':hover')).toContain(
      'entity.other.attribute-name.pseudo-class.panorama-vcss',
    );
  });

  it('属性名与关键字取值', async () => {
    const tokens = await tok('.row { flow-children: right; }');
    expect(scopesOf(tokens, 'flow-children')).toContain('support.type.property-name.panorama-vcss');
  });

  it('Panorama 专属关键字取值有独立作用域', async () => {
    const tokens = await tok('.x { height: fit-children; }');
    expect(scopesOf(tokens, 'fit-children')).toContain(
      'support.constant.panorama-keyword.panorama-vcss',
    );
  });

  it('注释被识别', async () => {
    const tokens = await tok('/* Prettified by Source 2 Viewer */');
    expect(tokens[0].scopes).toContain('comment.block.panorama-vcss');
  });
});

// 解包库里 615 个规则块全部把 { 单独放在下一行（Source 2 Viewer 的 prettify 风格）。
// TextMate 逐行匹配，单行写法的测试完全测不到这种结构。
describe('VCSS 语法高亮 · 花括号另起一行的真实排版', () => {
  const multi = (source: string) => tokenizeLines(SCOPE, GRAMMAR, source);

  it('选择器与 { 分行时，选择器仍被识别', async () => {
    const tokens = await multi('.fontSize-xxxl\n{\n\tfont-size: 64px;\n}');
    expect(scopesOf(tokens, '.fontSize-xxxl')).toContain(
      'entity.other.attribute-name.class.panorama-vcss',
    );
  });

  it('选择器与 { 分行时，块内属性名仍被识别', async () => {
    const tokens = await multi('.fontSize-xxxl\n{\n\tfont-size: 64px;\n}');
    expect(scopesOf(tokens, 'font-size')).toContain('support.type.property-name.panorama-vcss');
  });

  it('分行写法下的 id 选择器与面板类型选择器', async () => {
    const byId = await multi('#HealthBar\n{\n\twidth: 100%;\n}');
    expect(scopesOf(byId, '#HealthBar')).toContain(
      'entity.other.attribute-name.id.panorama-vcss',
    );
    const byType = await multi('CSColorPicker\n{\n\twidth: 100%;\n}');
    expect(scopesOf(byType, 'CSColorPicker')).toContain('entity.name.tag.panel.panorama-vcss');
  });

  it('@keyframes 的内层块不会提前吃掉外层的闭合花括号', async () => {
    const tokens = await multi(
      "@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n\tto { opacity: 1; }\n}\n.after\n{\n\twidth: 10px;\n}",
    );
    // 若内层 } 被误当成外层结束，.after 就会落在块内而不被识别为选择器
    expect(scopesOf(tokens, '.after')).toContain(
      'entity.other.attribute-name.class.panorama-vcss',
    );
  });
});
