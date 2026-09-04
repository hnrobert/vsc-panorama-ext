import { describe, it, expect } from 'vitest';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { contextAt, hoverTargetAt } from '../../../../src/core/vcss/context';

function at(marked: string) {
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  return { doc: parseVcss(text), offset };
}

describe('contextAt', () => {
  it('块外是选择器上下文', () => {
    const { doc, offset } = at('.item|');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'selector', prefix: '.item' });
  });

  it('块内、冒号之前是属性名上下文', () => {
    const { doc, offset } = at('.x\n{\n\tflow-ch|\n}');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'propertyName', prefix: 'flow-ch' });
  });

  it('块内、冒号之后是属性值上下文并带属性名', () => {
    const { doc, offset } = at('.x\n{\n\tflow-children: ri|\n}');
    expect(contextAt(doc, offset)).toMatchObject({
      kind: 'propertyValue',
      property: 'flow-children',
      prefix: 'ri',
    });
  });

  it('同一声明写完分号后回到属性名上下文', () => {
    const { doc, offset } = at('.x\n{\n\twidth: 1px;\n\thei|\n}');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'propertyName', prefix: 'hei' });
  });

  it('@ 之后是 at-rule 上下文', () => {
    const { doc, offset } = at('@def|');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'atRule', prefix: '@def' });
  });

  it('花括号另起一行时块内判定仍正确', () => {
    const { doc, offset } = at('.fontSize-xxxl\n{\n\tfont-si|\n}');
    expect(contextAt(doc, offset).kind).toBe('propertyName');
  });

  it('嵌套的 @keyframes 内层块里仍是属性名上下文', () => {
    const { doc, offset } = at("@keyframes 'f'\n{\n\tfrom { opa| }\n}");
    expect(contextAt(doc, offset).kind).toBe('propertyName');
  });

  it('注释内不给出补全上下文', () => {
    const { doc, offset } = at('.x { /* wid| */ }');
    expect(contextAt(doc, offset).kind).toBe('none');
  });

  it('字符串内不给出补全上下文', () => {
    const { doc, offset } = at('.x { sound: "ui.cl|ick"; }');
    expect(contextAt(doc, offset).kind).toBe('none');
  });

  it('空文档是 selector 上下文（可直接开始写选择器）', () => {
    expect(contextAt(parseVcss(''), 0).kind).toBe('selector');
  });

  it('未闭合注释在EOF处不给补全上下文', () => {
    const { doc, offset } = at('/* abc|');
    expect(contextAt(doc, offset).kind).toBe('none');
  });

  it('光标在未闭合注释中间不给补全上下文', () => {
    const { doc, offset } = at('.x {\n\t/* wid|');
    expect(contextAt(doc, offset).kind).toBe('none');
  });

  it('闭合注释后立即是选择器上下文（回归测试）', () => {
    const { doc, offset } = at('/* c */|.x');
    // 关键是 kind 是 selector 而非 none，说明闭合注释没有误伤光标位置
    expect(contextAt(doc, offset).kind).toBe('selector');
  });

  it('取值内部嵌的 @ 不会被误判成 at-rule（Finding 6）', () => {
    // at-rule 匹配原本没有锚定"记号开头"，'@' 前面是单词字符（这里是 'a'）
    // 时也会被从字符串末尾贪婪匹配上，抢在 propertyValue 之前把
    // url(a@b 误判成前缀 '@b' 的 at-rule。
    const { doc, offset } = at('.x\n{\n\tbackground-image: url(a@b|)\n}');
    const ctx = contextAt(doc, offset);
    expect(ctx.kind).not.toBe('atRule');
    expect(ctx).toMatchObject({ kind: 'propertyValue', property: 'background-image' });
  });

  it('@ 前面是空白或语句边界时仍正确识别为 at-rule（Finding 6 的正常路径不受影响）', () => {
    const { doc, offset } = at('.x { width: 1px; }\n@keyfram|');
    expect(contextAt(doc, offset)).toMatchObject({ kind: 'atRule', prefix: '@keyfram' });
  });
});

describe('contextAt · selector 的 prefixStart（Task 9 Fix round 1）', () => {
  // 评审发现：Fix round 1 之前这里用 `offset - sel.trim().length`——trim()
  // 连尾随空白也削掉，一旦削掉，prefix 就不再是「以 offset 结尾的 before
  // 后缀」，用长度反推起点会算错。本文件之前所有 selector 断言都走
  // toMatchObject 或只查 kind，从没有一条直接看过 prefixStart，这正是
  // bug 能一路活到评审才被抓到的原因——下面五条把这个字段的具体数值钉死，
  // 覆盖「无空白 / 冒号后空白 / 前导空白 / 前导+尾随都有 / 尾随 tab」五种
  // 形态，每一条在旧公式下都会算出与断言不同的错误数值（第二条是评审给出
  // 的原始复现场景）。

  it('基础情形（无空白）：prefixStart 指向选择器本身的起点', () => {
    const { doc, offset } = at('.btn:hov|');
    const ctx = contextAt(doc, offset) as { prefix: string; prefixStart: number };
    expect(ctx.prefix).toBe('.btn:hov');
    expect(ctx.prefixStart).toBe(0);
  });

  it('冒号后跟空白（评审的原始复现场景）：prefixStart 不能指向那个空格', () => {
    const { doc, offset } = at('.btn: |');
    const ctx = contextAt(doc, offset) as { prefix: string; prefixStart: number };
    // 旧公式在这里算出 prefix='.btn:'、prefixStart=1；vcss.ts 的伪类分支据此算出
    // colonAt = prefixStart + prefix.lastIndexOf(':') = 1 + 4 = 5，
    // end = prefixStart + prefix.length = 1 + 5 = 6，用它切出的区间是
    // text.slice(5, 6) === ' '，覆盖的是那个空格而不是冒号。修复后 prefix
    // 保留尾随空格（'.btn: '），prefixStart 回到 0，text.slice(0, 6) 与
    // prefix 本身一致。
    expect(ctx.prefix).toBe('.btn: ');
    expect(ctx.prefixStart).toBe(0);
  });

  it('前导空白：prefixStart 跳过前导空白，指向选择器真正的起点', () => {
    const { doc, offset } = at('  .btn:hov|');
    const ctx = contextAt(doc, offset) as { prefix: string; prefixStart: number };
    expect(ctx.prefix).toBe('.btn:hov');
    expect(ctx.prefixStart).toBe(2);
  });

  it('前导与尾随空白都有：只削前导，prefixStart 不受尾随空白影响', () => {
    const { doc, offset } = at('  .btn:hov  |');
    const ctx = contextAt(doc, offset) as { prefix: string; prefixStart: number };
    // 旧公式：sel.trim() 两端都削，prefix='.btn:hov'（8 字符），
    // prefixStart = 12 - 8 = 4——错的，选择器实际从 2 开始。
    expect(ctx.prefix).toBe('.btn:hov  ');
    expect(ctx.prefixStart).toBe(2);
  });

  it('尾随空白是 tab 而不是空格，结论一致', () => {
    const { doc, offset } = at('.btn:hov\t|');
    const ctx = contextAt(doc, offset) as { prefix: string; prefixStart: number };
    expect(ctx.prefix).toBe('.btn:hov\t');
    expect(ctx.prefixStart).toBe(0);
  });
});

describe('hoverTargetAt', () => {
  it('悬停在属性名上返回完整属性名', () => {
    const { doc, offset } = at('.x { flow-chi|ldren: right; }');
    expect(hoverTargetAt(doc, offset)).toMatchObject({ kind: 'property', name: 'flow-children' });
  });

  it('悬停在 @define 定义的名字上', () => {
    const { doc, offset } = at('@define blue|Color: #3281AC;');
    expect(hoverTargetAt(doc, offset)).toMatchObject({ kind: 'define', name: 'blueColor' });
  });

  it('悬停在值中引用的 @define 名字上', () => {
    const { doc, offset } = at('@define blueColor: #333;\n.x { background-color: blue|Color; }');
    expect(hoverTargetAt(doc, offset)).toMatchObject({ kind: 'define', name: 'blueColor' });
  });

  it('悬停在函数名上', () => {
    const { doc, offset } = at('.x { width: fill-parent|-flow(1); }');
    expect(hoverTargetAt(doc, offset)).toMatchObject({
      kind: 'function',
      name: 'fill-parent-flow',
    });
  });

  it('悬停在无意义处返回 none', () => {
    const { doc, offset } = at('.x { width: 1|px; }');
    expect(hoverTargetAt(doc, offset).kind).toBe('none');
  });
});
