import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { tokenize, scopesOf } from './harness';

const SCOPE = 'text.xml.panorama-vxml';
// vitest 走 ESM，没有 __dirname
const GRAMMAR = fileURLToPath(
  new URL('../../../syntaxes/panorama-vxml.tmLanguage.json', import.meta.url),
);

const tok = (line: string) => tokenize(SCOPE, GRAMMAR, line);

describe('VXML 语法高亮', () => {
  it('面板标签有独立作用域', async () => {
    const tokens = await tok('<Label text="hi" />');
    expect(scopesOf(tokens, 'Label')).toContain('entity.name.tag.panel.panorama-vxml');
  });

  it('结构元素与面板区分开', async () => {
    const tokens = await tok('<root>');
    expect(scopesOf(tokens, 'root')).toContain('entity.name.tag.structural.panorama-vxml');
  });

  it('属性名与属性值分别着色', async () => {
    const tokens = await tok('<Panel class="hud-root">');
    expect(scopesOf(tokens, 'class')).toContain('entity.other.attribute-name.panorama-vxml');
    expect(scopesOf(tokens, 'hud-root')).toContain('string.quoted.double.panorama-vxml');
  });

  it('事件属性有独立作用域（便于主题标记出自定义内容不可用的写法）', async () => {
    const tokens = await tok('<Button onactivate="Go()" />');
    expect(scopesOf(tokens, 'onactivate')).toContain(
      'entity.other.attribute-name.event.panorama-vxml',
    );
  });

  it('{s:} 数据绑定的变量名被单独识别', async () => {
    const tokens = await tok('<Label text="{s:score}" />');
    expect(scopesOf(tokens, 's')).toContain('keyword.other.binding-prefix.panorama-vxml');
    expect(scopesOf(tokens, 'score')).toContain('variable.other.binding.panorama-vxml');
  });

  it('绑定可与静态文本混排', async () => {
    const tokens = await tok('<Label text="Score: {s:score}" />');
    expect(scopesOf(tokens, 'score')).toContain('variable.other.binding.panorama-vxml');
  });

  it('本地化 token 有独立作用域', async () => {
    const tokens = await tok('<Label text="#SFUI_Settings" />');
    expect(scopesOf(tokens, '#SFUI_Settings')).toContain(
      'constant.language.localization-token.panorama-vxml',
    );
  });

  it('s2r:// 资源路径有独立作用域', async () => {
    const tokens = await tok('<include src="s2r://panorama/styles/base.vcss_c" />');
    expect(scopesOf(tokens, 's2r://panorama/styles/base.vcss_c')).toContain(
      'markup.underline.link.resource.panorama-vxml',
    );
  });

  it('注释被识别', async () => {
    const tokens = await tok('<!-- 根面板不能有 id -->');
    expect(tokens[0].scopes).toContain('comment.block.panorama-vxml');
  });
});
