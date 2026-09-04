import { describe, it, expect } from 'vitest';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { contextAt, hoverTargetAt } from '../../../../src/core/vxml/context';

/** 用 | 标记光标位置，返回去掉标记的文本与偏移量 */
function at(marked: string) {
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  return { doc: parseVxml(text), offset };
}

describe('contextAt · 标签名', () => {
  it('输入 < 之后是标签名上下文', () => {
    const { doc, offset } = at('<root><|');
    const ctx = contextAt(doc, offset);
    expect(ctx.kind).toBe('tagName');
  });

  it('带前缀时返回已输入的部分', () => {
    const { doc, offset } = at('<root><Pa|');
    const ctx = contextAt(doc, offset);
    expect(ctx).toMatchObject({ kind: 'tagName', prefix: 'Pa' });
  });
});

describe('contextAt · TagSlot 判定', () => {
  it('root 之外是 outside', () => {
    const { doc, offset } = at('<Pa|');
    expect(contextAt(doc, offset)).toMatchObject({ slot: 'outside' });
  });

  it('root 直接子级、尚无根面板时是 rootHeader', () => {
    const { doc, offset } = at('<root><|</root>');
    expect(contextAt(doc, offset)).toMatchObject({ slot: 'rootHeader' });
  });

  it('styles 不算根面板，其后仍是 rootHeader', () => {
    const { doc, offset } = at('<root><styles /><|</root>');
    expect(contextAt(doc, offset)).toMatchObject({ slot: 'rootHeader' });
  });

  it('已有根面板之后的同级位置是 child', () => {
    const { doc, offset } = at('<root><Panel /><|</root>');
    expect(contextAt(doc, offset)).toMatchObject({ slot: 'child' });
  });

  it('嵌套在根面板内部是 child', () => {
    const { doc, offset } = at('<root><Panel><|</Panel></root>');
    expect(contextAt(doc, offset)).toMatchObject({ slot: 'child' });
  });

  it('根面板自身的属性位置是 rootPanel', () => {
    const { doc, offset } = at('<root><Panel |></Panel></root>');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'attributeName', slot: 'rootPanel' });
  });

  it('子面板的属性位置是 child', () => {
    const { doc, offset } = at('<root><Panel><Label |/></Panel></root>');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'attributeName', slot: 'child' });
  });
});

describe('contextAt · 属性名', () => {
  it('标签内空白处是属性名上下文，并带上所属标签', () => {
    const { doc, offset } = at('<Label |/>');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'attributeName', tag: 'Label' });
  });

  it('列出已写过的属性，供补全去重', () => {
    const { doc, offset } = at('<Label class="a" te|/>');
    const ctx = contextAt(doc, offset);
    expect(ctx).toMatchObject({ kind: 'attributeName', prefix: 'te' });
    expect((ctx as { existing: string[] }).existing).toContain('class');
  });
});

describe('contextAt · 属性值', () => {
  it('引号内是属性值上下文，带所属属性名', () => {
    const { doc, offset } = at('<Label text="|" />');
    expect(contextAt(doc, offset)).toMatchObject({
      kind: 'attributeValue',
      tag: 'Label',
      attribute: 'text',
    });
  });

  it('class="a b c" 中 valueOffset 指出光标在第几个类名上', () => {
    const { doc, offset } = at('<Panel class="a b|" />');
    const ctx = contextAt(doc, offset) as { kind: string; value: string; valueOffset: number };
    expect(ctx.kind).toBe('attributeValue');
    expect(ctx.value).toBe('a b');
    // valueOffset 是光标相对值起点的偏移，据此可切出当前那个类名
    expect(ctx.value.slice(0, ctx.valueOffset).split(/\s+/).pop()).toBe('b');
  });
});

describe('contextAt · 其它', () => {
  it('元素之间的文本位置是 text', () => {
    const { doc, offset } = at('<root>|</root>');
    expect(contextAt(doc, offset).kind).toBe('text');
  });

  it('空文档是 none', () => {
    expect(contextAt(parseVxml(''), 0).kind).toBe('none');
  });
});

describe('hoverTargetAt', () => {
  it('悬停在标签名上返回完整标签名，而不是光标前的前缀', () => {
    const { doc, offset } = at('<La|bel />');
    expect(hoverTargetAt(doc, offset)).toMatchObject({ kind: 'tag', name: 'Label' });
  });

  it('悬停在属性名上返回属性与其所属标签', () => {
    const { doc, offset } = at('<Label te|xt="hi" />');
    expect(hoverTargetAt(doc, offset)).toMatchObject({
      kind: 'attribute',
      tag: 'Label',
      name: 'text',
    });
  });

  it('悬停在属性值上不返回目标', () => {
    const { doc, offset } = at('<Label text="h|i" />');
    expect(hoverTargetAt(doc, offset).kind).toBe('none');
  });
});
