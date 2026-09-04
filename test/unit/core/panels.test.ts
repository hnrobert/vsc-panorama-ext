import { describe, it, expect } from 'vitest';
import { PanelRegistry } from '../../../src/core/data/panels';

const registry = PanelRegistry.load('zh-cn');

describe('PanelRegistry', () => {
  it('已知面板存在，编造的不存在', () => {
    expect(registry.has('Label')).toBe(true);
    expect(registry.has('DefinitelyNotAPanel')).toBe(false);
  });

  it('attributesOf 返回声明者集合的并集（含继承）', () => {
    const attrs = registry.attributesOf('Label');
    expect(attrs).toContain('text');   // from Label
    expect(attrs).toContain('id');     // from Panel，继承而来
    expect(attrs).toContain('class');  // from Panel
  });

  it('attributesOf 结果已排序且无重复', () => {
    const attrs = registry.attributesOf('Label');
    expect([...attrs]).toEqual([...new Set(attrs)].sort());
  });

  it('Button 没有 text，TextButton 有', () => {
    expect(registry.hasAttribute('Button', 'text')).toBe(false);
    expect(registry.hasAttribute('TextButton', 'text')).toBe(true);
  });

  it('未知面板的属性集为空而不是抛异常', () => {
    expect(registry.attributesOf('DefinitelyNotAPanel')).toEqual([]);
    expect(registry.hasAttribute('DefinitelyNotAPanel', 'id')).toBe(false);
  });

  it('三个面板集合的规模符合 XSD', () => {
    expect(registry.allPanels()).toHaveLength(245);
    expect(registry.childPanels()).toHaveLength(202);
    expect(registry.rootOnlyPanels()).toHaveLength(43);
  });

  it('rootOnly 集合与 child 集合互斥且并集为全集', () => {
    const child = new Set(registry.childPanels());
    for (const p of registry.rootOnlyPanels()) {
      expect(child.has(p)).toBe(false);
    }
    expect(registry.childPanels().length + registry.rootOnlyPanels().length).toBe(245);
  });

  it('PopupCustomLayout 只能作根面板', () => {
    expect(registry.get('PopupCustomLayout')?.rootOnly).toBe(true);
  });

  /*
   * 两种 locale 都断言，而不是只保留一种：
   * en 走 panels.json 里 Valve 的原文，zh-cn 走 data/attribute-docs.zh-cn.json
   * 的对照。只断言其中一边的话，另一条链路断了也不会红。
   *
   * 'class' 那条是反例：它是样板属性，XSD 里没有描述，两种 locale 下都该是
   * undefined——sidecar 不能凭空给它造一条中文出来。
   */
  it('docFor 返回 XSD 里的真实描述，两种 locale 各取各的；样板属性返回 undefined', () => {
    expect(PanelRegistry.load('en').docFor('texturewidth')).toContain(
      'override the size of vector graphics',
    );
    expect(PanelRegistry.load('zh-cn').docFor('texturewidth')).toContain('覆盖矢量图形的尺寸');
    expect(PanelRegistry.load('en').docFor('class')).toBeUndefined();
    expect(PanelRegistry.load('zh-cn').docFor('class')).toBeUndefined();
  });

  it('继承链可读', () => {
    expect(registry.get('Label')?.derivedFrom).toBe('Panel');
  });

  it('declarerOf 返回真正声明该属性的类型，而非查询的面板本身', () => {
    // text 由 Label 自己声明
    expect(registry.declarerOf('Label', 'text')).toBe('Label');
    // id 是从基础 Panel 继承来的，声明者应是 Panel 而不是 Label
    expect(registry.declarerOf('Label', 'id')).toBe('Panel');
    expect(registry.declarerOf('Label', 'nope')).toBeUndefined();
    expect(registry.declarerOf('NotAPanel', 'id')).toBeUndefined();
  });

  // 直接用 [] 索引不存在的面板名会顺着原型链拿到 Object.prototype 上的
  // 同名成员（函数），不是 undefined。get / attributesOf / declarerOf 必须
  // 先过一遍 Object.hasOwn，否则下游把它当 PanelInfo 用（如 for...of .sets）
  // 会直接抛异常——这正是 completeVxml 遇到 <constructor> 标签会崩的根因（Finding 3）。
  describe('原型链键安全（Finding 3）', () => {
    const POISONED = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

    for (const key of POISONED) {
      it(`get('${key}') 返回 undefined 而不是原型链上的函数`, () => {
        expect(registry.get(key)).toBeUndefined();
      });

      it(`attributesOf('${key}') 返回空数组而不是抛异常`, () => {
        expect(() => registry.attributesOf(key)).not.toThrow();
        expect(registry.attributesOf(key)).toEqual([]);
      });

      it(`declarerOf('${key}', 'id') 返回 undefined 而不是抛异常`, () => {
        expect(() => registry.declarerOf(key, 'id')).not.toThrow();
        expect(registry.declarerOf(key, 'id')).toBeUndefined();
      });
    }
  });
});
