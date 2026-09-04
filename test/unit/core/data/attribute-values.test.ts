import { describe, it, expect } from 'vitest';
import { attributeValuesFor } from '../../../../src/core/data/attribute-values';

describe('attributeValuesFor', () => {
  it('Image 的 scaling 给出官方文档记载的六个取值', () => {
    const v = attributeValuesFor('Image', 'scaling');
    expect([...v].sort()).toEqual(
      [
        'none',
        'stretch',
        'stretch-to-cover-preserve-aspect',
        'stretch-to-fit-preserve-aspect',
        'stretch-to-fit-x-preserve-aspect',
        'stretch-to-fit-y-preserve-aspect',
      ].sort(),
    );
  });

  it('布尔型属性给 true / false，且不限定面板', () => {
    expect([...attributeValuesFor('Panel', 'hittest')].sort()).toEqual(['false', 'true']);
    expect([...attributeValuesFor('Label', 'html')].sort()).toEqual(['false', 'true']);
  });

  it('未收录的属性返回空数组而不是抛异常', () => {
    expect(attributeValuesFor('Panel', 'class')).toEqual([]);
    expect(attributeValuesFor('NotAPanel', 'nope')).toEqual([]);
  });

  it('原型链键不会漏出值', () => {
    expect(attributeValuesFor('constructor', 'toString')).toEqual([]);
    expect(attributeValuesFor('Panel', '__proto__')).toEqual([]);
  });

  // 上面这条用的 'constructor' / 'Panel' 都不是 byPanel 的真实 key，perPanel
  // 从头到尾是 undefined，根本没走到「按 tag 查到具体面板后再按 attr 取值」
  // 那一段代码——查 byPanel[tag] 内层对象时若把 Object.hasOwn 误写成 `in`
  // （会顺着原型链走），这条测试测不出来，因为它压根没执行到那段代码。
  // 'Image' 是真实存在的 byPanel key，藉此才能真正压到内层对象上。
  it('原型链键不会漏出值——即便 tag 是 byPanel 里真实存在的面板', () => {
    expect(attributeValuesFor('Image', 'constructor')).toEqual([]);
    expect(attributeValuesFor('Image', '__proto__')).toEqual([]);
  });

  // 上面两条都压不到**外层**那次查表（byPanel[tag]）。把外层的 Object.hasOwn
  // 误写成 `in` 时它们仍然全绿：data.byPanel['constructor'] 拿到的是 Object
  // 这个函数，而 Object.hasOwn(Object, 'toString') 恰好是 false，于是照样返回
  // undefined。要让外层的改坏暴露出来，tag 取的键必须让原型链上真的挂着同名成员：
  //   byPanel['__proto__']   -> Object.prototype，其上确实有 toString
  //   byPanel['constructor'] -> Object 函数，其上确实有 keys
  // 这两条是外层守卫的唯一防线，别删。
  it('原型链键不会漏出值——外层按 tag 查表这一次也要挡', () => {
    expect(attributeValuesFor('__proto__', 'toString')).toEqual([]);
    expect(attributeValuesFor('constructor', 'keys')).toEqual([]);
  });
});

// 顾虑 2（评审派修）：AnimatedImageStrip / ItemImage 按 data/panels.json 与
// Image 共享同一个名为 "Image" 的属性集（AnimatedImageStrip.sets / ItemImage.sets
// 里都显式列着 "Image"，不是三份属性列表恰好长得一样），也确实都声明了
// scaling，但字面 tag 精确匹配查不到——加一层回退：查不到时用
// PanelRegistry.declarerOf(tag, attr) 找到真正声明这个属性的集合名，
// 如果那个集合名本身也是 byPanel 的 key，就用它的数据。
describe('attributeValuesFor · 顺着共享属性集回退（顾虑 2）', () => {
  const SCALING_VALUES = [
    'none',
    'stretch',
    'stretch-to-cover-preserve-aspect',
    'stretch-to-fit-preserve-aspect',
    'stretch-to-fit-x-preserve-aspect',
    'stretch-to-fit-y-preserve-aspect',
  ].sort();

  it('AnimatedImageStrip 与 Image 共享同一个属性集，scaling 顺着这层关系补得出来，且与 Image 的值一致', () => {
    const v = attributeValuesFor('AnimatedImageStrip', 'scaling');
    expect([...v].sort()).toEqual(SCALING_VALUES);
  });

  it('ItemImage 同理（与 AnimatedImageStrip 是同一层关系，非仅测一个就代表全部）', () => {
    const v = attributeValuesFor('ItemImage', 'scaling');
    expect([...v].sort()).toEqual(SCALING_VALUES);
  });

  // Image 自己在 byPanel 里就有直接条目，valuesFromByPanel('Image', 'scaling')
  // 第一步就命中并返回，代码里 declarerOf 根本不会被调用（见 attribute-values.ts
  // 的 if (direct) return direct; 短路）。这条测试确认加了回退之后 Image 自己
  // 的直接命中路径的结果没有被扰动——不是长度变成 12（direct 6 个再被回退
  // 多拼 6 个）之类的联动 bug。
  it('Image 自己已有直接条目，不需要经过回退，行为不变（不是被回退多拼接一份）', () => {
    const v = attributeValuesFor('Image', 'scaling');
    expect(v.length).toBe(6);
    expect([...v].sort()).toEqual(SCALING_VALUES);
  });

  // AnimatedImageStrip 经共享属性集真的有 texturewidth / animate（都在
  // data/panels.json 的 "Image" 属性集里），但这两个属性没被收进
  // data/vxml-attribute-values.json（只整理了 scaling 与 9 个布尔属性）。
  // 回退必须锚定在「declarer 对应的 byPanel 条目里，attr 本身是否真被收录」，
  // 不能变成「只要找得到 declarer，就把它 byPanel 条目下随便什么数据都吐出来」。
  it('AnimatedImageStrip 经共享属性集能查到 scaling，但没被收录的其它属性依旧返回空——回退不是查不到就到处翻', () => {
    expect(attributeValuesFor('AnimatedImageStrip', 'texturewidth')).toEqual([]);
    expect(attributeValuesFor('AnimatedImageStrip', 'animate')).toEqual([]);
  });

  // 回退多一跳查询正是最容易把原型链漏进来的地方：declarer 名字本身若被
  // 错误地当成可信任的 key 直接索引（而不经 Object.hasOwn），或者 attr 本身
  // 是 'constructor'/'__proto__' 时被 declarerOf 内部的 attributeSets[s]
  // 顺着原型链吐出意外结果，都可能漏值。用真实存在、真的共享属性集的 tag
  // （而非 brief 原有测试用的假标签）来压这条路径。
  it('回退路径同样不会漏出原型链上的值', () => {
    expect(attributeValuesFor('AnimatedImageStrip', 'constructor')).toEqual([]);
    expect(attributeValuesFor('AnimatedImageStrip', '__proto__')).toEqual([]);
  });
});
