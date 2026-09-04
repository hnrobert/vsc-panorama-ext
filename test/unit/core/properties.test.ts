import { describe, it, expect } from 'vitest';
import { PropertyRegistry } from '../../../src/core/data/properties';

const registry = PropertyRegistry.load('zh-cn');

describe('PropertyRegistry', () => {
  it('收录了 Panorama 专属属性并带取值', () => {
    expect(registry.has('flow-children')).toBe(true);
    expect(registry.valuesOf('flow-children')).toContain('down-wrap-left');
    expect(registry.valuesOf('flow-children')).toHaveLength(10);
  });

  it('区分 Panorama 专属与标准属性', () => {
    expect(registry.isPanoramaOnly('wash-color')).toBe(true);
    expect(registry.isPanoramaOnly('margin')).toBe(false);
  });

  it('Web 独有属性带替代写法提示', () => {
    expect(registry.webOnlyHint('display')).toContain('flow-children');
    expect(registry.webOnlyHint('float')).toBeDefined();
    // 合法的 Panorama 属性不应出现在 webOnly 里
    expect(registry.webOnlyHint('flow-children')).toBeUndefined();
  });

  it('visibility 的取值是 collapse 而非 hidden', () => {
    const values = registry.valuesOf('visibility');
    expect(values).toContain('collapse');
    expect(values).not.toContain('hidden');
  });

  it('overflow 的四个官方取值齐全', () => {
    expect([...registry.valuesOf('overflow')].sort()).toEqual([
      'clip', 'noclip', 'scroll', 'squish',
    ]);
  });

  it('收录 Panorama 函数及签名', () => {
    const names = registry.functions().map((f) => f.name);
    expect(names).toContain('fill-parent-flow');
    expect(names).toContain('mipmapgaussian');
    const fn = registry.functions().find((f) => f.name === 'fill-parent-flow');
    expect(fn?.signature).toBe('fill-parent-flow(权重)');
  });

  it('收录伪类', () => {
    expect(registry.pseudoClasses()).toContain(':hover');
    expect(registry.pseudoClasses()).toContain(':descendantfocus');
  });

  it('未知属性安全降级，不抛异常', () => {
    expect(registry.has('definitely-not-a-property')).toBe(false);
    expect(registry.valuesOf('definitely-not-a-property')).toEqual([]);
  });

  it('属性总数覆盖解包库统计出的全部条目', () => {
    expect(registry.allProperties().length).toBeGreaterThanOrEqual(85);
  });

  // 直接用 [] 索引不存在的属性名会顺着原型链拿到 Object.prototype 上的
  // 同名成员（函数，或 __proto__ 时是 Object.prototype 本身），不是
  // undefined。get / valuesOf 必须先过一遍 Object.hasOwn，否则下游把它当
  // PropertyInfo 用（如对 .values 取 .join）会直接抛异常——这正是
  // completeVcss / hoverVcss 遇到 constructor 属性名会崩的根因（Finding 3）。
  describe('原型链键安全（Finding 3）', () => {
    const POISONED = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

    for (const key of POISONED) {
      it(`get('${key}') 返回 undefined 而不是原型链上的函数`, () => {
        expect(registry.get(key)).toBeUndefined();
      });

      it(`valuesOf('${key}') 返回空数组而不是抛异常`, () => {
        expect(() => registry.valuesOf(key)).not.toThrow();
        expect(registry.valuesOf(key)).toEqual([]);
      });

      it(`has('${key}') 为 false`, () => {
        expect(registry.has(key)).toBe(false);
      });
    }
  });
});
