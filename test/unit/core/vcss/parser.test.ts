import { describe, it, expect, beforeAll } from 'vitest';
import { parseVcss } from '../../../../src/core/vcss/parser';
import type { VcssRule } from '../../../../src/core/vcss/ast';

describe('parseVcss · Panorama 专属 at-rule', () => {
  it('@define 记录名字、值与区间', () => {
    const text = '@define blueColor: #3281AC;';
    const doc = parseVcss(text);
    expect(doc.defines).toHaveLength(1);
    expect(doc.defines[0].name).toBe('blueColor');
    expect(doc.defines[0].value).toBe('#3281AC');
    expect(text.slice(doc.defines[0].nameStart, doc.defines[0].nameEnd)).toBe('blueColor');
  });

  it('@define 的值可以是渐变等含括号与逗号的复杂表达式', () => {
    const doc = parseVcss(
      '@define bg: gradient( linear, 0% 0%, 0% 100%, from(#14202b), to(#1e2d3d) );',
    );
    expect(doc.defines[0].value).toContain('gradient(');
    expect(doc.defines[0].value).toContain('to(#1e2d3d)');
  });

  it('@keyframes 名字带引号时记录去引号的名字并标记 quoted', () => {
    const doc = parseVcss("@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}");
    expect(doc.keyframes).toHaveLength(1);
    expect(doc.keyframes[0].name).toBe('fade');
    expect(doc.keyframes[0].quoted).toBe(true);
  });

  it('@keyframes 名字漏了引号仍能解析，但 quoted 为 false（供 M4 诊断）', () => {
    const doc = parseVcss('@keyframes fade\n{\n\tfrom { opacity: 0; }\n}');
    expect(doc.keyframes[0].name).toBe('fade');
    expect(doc.keyframes[0].quoted).toBe(false);
  });

  it('@import 记录目标路径', () => {
    const doc = parseVcss('@import url("s2r://panorama/styles/csgostyles.vcss_c");');
    expect(doc.imports[0].target).toBe('s2r://panorama/styles/csgostyles.vcss_c');
  });
});

describe('parseVcss · 规则块', () => {
  it('花括号另起一行仍能解析（解包库 615 个规则块全是这种排版）', () => {
    const doc = parseVcss('.fontSize-xxxl\n{\n\tfont-size: 64px;\n}');
    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].selector).toBe('.fontSize-xxxl');
    expect(doc.rules[0].declarations).toHaveLength(1);
    expect(doc.rules[0].declarations[0].property).toBe('font-size');
    expect(doc.rules[0].declarations[0].value).toBe('64px');
  });

  it('花括号同行也能解析', () => {
    const doc = parseVcss('.row { flow-children: right; }');
    expect(doc.rules[0].selector).toBe('.row');
    expect(doc.rules[0].declarations[0].property).toBe('flow-children');
  });

  it('多条声明与并列选择器', () => {
    const doc = parseVcss('.a, .b\n{\n\twidth: 10px;\n\theight: 20px;\n}');
    expect(doc.rules[0].selector).toBe('.a, .b');
    expect(doc.rules[0].declarations.map((d) => d.property)).toEqual(['width', 'height']);
  });

  it('值里含分号的字符串不会被误当作声明结束', () => {
    const doc = parseVcss('.x { sound: "ui;click"; width: 1px; }');
    expect(doc.rules[0].declarations.map((d) => d.property)).toEqual(['sound', 'width']);
    expect(doc.rules[0].declarations[0].value).toBe('"ui;click"');
  });

  it('注释不产生规则也不干扰声明', () => {
    const doc = parseVcss('/* .fake { a: b; } */\n.real\n{\n\twidth: 1px;\n}');
    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].selector).toBe('.real');
  });

  it('@keyframes 的内层块归入其 children，不污染顶层 rules', () => {
    const doc = parseVcss("@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n\tto { opacity: 1; }\n}\n.after\n{\n\twidth: 1px;\n}");
    expect(doc.keyframes[0].rule.children.map((c) => c.selector)).toEqual(['from', 'to']);
    expect(doc.rules.map((r) => r.selector)).toEqual(['.after']);
  });
});

describe('parseVcss · 容错', () => {
  it('未闭合的块不抛异常，blockEnd 为 -1', () => {
    const doc = parseVcss('.x\n{\n\twidth: 1px;');
    expect(doc.rules[0].blockEnd).toBe(-1);
    expect(doc.rules[0].declarations[0].property).toBe('width');
  });

  it('只写了属性名和冒号', () => {
    const doc = parseVcss('.x { flow-children: }');
    expect(doc.rules[0].declarations[0].property).toBe('flow-children');
    expect(doc.rules[0].declarations[0].value).toBe('');
  });

  it('@define 漏了分号不吞掉后续内容', () => {
    const doc = parseVcss('@define a: 1px\n.x { width: 2px; }');
    expect(doc.rules.map((r) => r.selector)).toContain('.x');
  });

  it('@define 空名字（@define : #fff;）不记录，与声明路径的 if (property) 守卫保持一致（Finding 2）', () => {
    const doc = parseVcss('@define : #fff;');
    expect(doc.defines).toEqual([]);
  });

  it('@define 空名字不影响后续内容解析', () => {
    const doc = parseVcss('@define : #fff;\n.x { width: 1px; }');
    expect(doc.defines).toEqual([]);
    expect(doc.rules.map((r) => r.selector)).toEqual(['.x']);
  });

  it('空文档不抛异常', () => {
    const doc = parseVcss('');
    expect(doc.rules).toEqual([]);
    expect(doc.defines).toEqual([]);
  });

  it('嵌套块的选择器范围包含正确的文本（Finding 1）', () => {
    const doc = parseVcss("@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}");
    const child = doc.keyframes[0].rule.children[0];
    const extracted = doc.text.slice(child.selectorStart, child.selectorEnd);
    expect(extracted).toBe(child.selector);
    expect(child.selector).toBe('from');
  });

  it('声明值范围包含正确的文本，去除尾部空白（Finding 2a）', () => {
    const doc = parseVcss('.x { width: 1px  ; }');
    const decl = doc.rules[0].declarations[0];
    const extracted = doc.text.slice(decl.valueStart, decl.valueEnd);
    expect(extracted).toBe(decl.value);
    expect(decl.value).toBe('1px');
  });

  it('@define 值范围包含正确的文本，去除尾部空白（Finding 2b）', () => {
    const doc = parseVcss('@define color: #fff  ;');
    const def = doc.defines[0];
    const extracted = doc.text.slice(def.valueStart, def.valueEnd);
    expect(extracted).toBe(def.value);
    expect(def.value).toBe('#fff');
  });

  it('未闭合字符串在 EOF 时不超出边界（Finding 3a）', () => {
    const doc = parseVcss('.x { value: "unterminated');
    expect(doc.rules[0].declarations[0].value).toBe('"unterminated');
    // 确保所有索引都在范围内
    const decl = doc.rules[0].declarations[0];
    expect(decl.valueEnd).toBeLessThanOrEqual(doc.text.length);
  });

  it('@keyframes 未闭合引号在换行处停止，不吞掉后续规则（Finding 3b）', () => {
    const doc = parseVcss("@keyframes '\n.later { width: 1px; }");
    // @keyframes 扫描在换行处停止，不找到 {，跳过
    // 顶层规则应该仍然能解析 .later
    expect(doc.rules.map((r) => r.selector)).toContain('.later');
  });
});

describe('parseVcss · 未闭合的括号不吞掉后续规则块（Task 3b）', () => {
  it('声明值里一个未闭合的 ( 不再吞到文件尾——三条规则全部解析出来', () => {
    // 复现用例：.a 的 background-color 少了 gradient( 对应的右括号。
    // 旧实现里 scanValue 的括号深度一旦大于 0 就永远不认 `;` 和 `}`，
    // 会一路吞到文件尾，.b 与 .c 整个从解析结果里消失。
    const text = '.a\n{\n\tbackground-color: gradient( linear, 0% 0%;\n}\n.b\n{\n\twidth: 10px;\n}\n.c\n{\n\theight: 5px;\n}';
    const doc = parseVcss(text);

    expect(doc.rules.map((r) => r.selector)).toEqual(['.a', '.b', '.c']);
    expect(doc.rules[0].declarations[0].property).toBe('background-color');
    expect(doc.rules[1].declarations[0]).toMatchObject({ property: 'width', value: '10px' });
    expect(doc.rules[2].declarations[0]).toMatchObject({ property: 'height', value: '5px' });
  });

  it('用户敲到一半（值扫描直接撞上 EOF）不抛异常，也没有可吞的后续内容', () => {
    const text = '.a\n{\n\tbackground-color: gradient(';
    expect(() => parseVcss(text)).not.toThrow();

    const doc = parseVcss(text);
    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].selector).toBe('.a');
    expect(doc.rules[0].blockEnd).toBe(-1);
    expect(doc.rules[0].declarations[0]).toMatchObject({ property: 'background-color', value: 'gradient(' });
  });

  it('合法的多层嵌套括号仍然完整解析，不被新的硬停止规则误伤', () => {
    const doc = parseVcss('.x\n{\n\tbackground-color: gradient( linear, from( rgba(0,0,0,1) ) );\n}');
    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].blockEnd).toBeGreaterThan(-1);
    expect(doc.rules[0].declarations[0]).toMatchObject({
      property: 'background-color',
      value: 'gradient( linear, from( rgba(0,0,0,1) ) )',
    });
  });

  it('真实语料同型缺陷（corpus.test.ts PINNED 注释里 popup_acknowledge_xpgrant.css 第 26/27/36 行）：两条独立的 box-shadow 都要恢复', () => {
    // 逐字摘自 popup_acknowledge_xpgrant.css：.popup__rarity-bar 的
    // background-color 用了 4 个左括号（gradient/from/to/rgba）却只有 3 个
    // 右括号收，深度补不平。旧实现会把第 27 行的 box-shadow、以及后面
    // .popup-acknowledge__item 规则里第 36 行的 box-shadow 一起吞掉，
    // .popup__rarity-bar 的 blockEnd 会停在 -1。
    const text = [
      '.popup__rarity-bar',
      '{',
      '\twidth: 16px;',
      '\theight: 100%;',
      '\tbackground-color: gradient( linear, 0% 0%, 0% 100%, from( white, to(rgba(175, 175, 175, .75) ));',
      '\tbox-shadow: 0px 2px 6px 0px fill rgba(0, 0, 0, 0.5);',
      '}',
      '',
      '.popup-acknowledge__item',
      '{',
      '\tbox-shadow: 0px 2px 6px 0px fill rgba(0, 0, 0, 0.493);',
      '}',
    ].join('\n');
    const doc = parseVcss(text);

    expect(doc.rules.map((r) => r.selector)).toEqual(['.popup__rarity-bar', '.popup-acknowledge__item']);

    const [bar, item] = doc.rules;
    expect(bar.blockEnd).toBeGreaterThan(-1);
    expect(bar.declarations.map((d) => d.property)).toEqual(['width', 'height', 'background-color', 'box-shadow']);
    // 未闭合括号的那条声明允许残留垃圾值，但不能把下一条声明也吞进去
    expect(bar.declarations[2].value).toBe(
      'gradient( linear, 0% 0%, 0% 100%, from( white, to(rgba(175, 175, 175, .75) ))',
    );
    expect(bar.declarations[3]).toMatchObject({ property: 'box-shadow', value: '0px 2px 6px 0px fill rgba(0, 0, 0, 0.5)' });

    expect(item.blockEnd).toBeGreaterThan(-1);
    expect(item.declarations).toHaveLength(1);
    expect(item.declarations[0]).toMatchObject({
      property: 'box-shadow',
      value: '0px 2px 6px 0px fill rgba(0, 0, 0, 0.493)',
    });
  });
});

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE } from '../../../../tools/paths.mjs';

function allCss(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allCss(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** 递归数一棵规则树（含嵌套 children）里的声明总数 */
function countDeclarations(rule: VcssRule): number {
  let n = rule.declarations.length;
  for (const child of rule.children) n += countDeclarations(child);
  return n;
}

const STYLE_DIR = `${ARCHIVE}/20260829/panorama/styles`;

describe.skipIf(!existsSync(STYLE_DIR))('parseVcss · 真实语料', () => {
  let files: string[] = [];

  // `describe.skipIf` 只跳过 `it`，**回调体照常执行**——扫语料留在回调体里
  // 会让没有归档的机器（CI）在收集阶段 ENOENT 崩掉整份文件，连本文件里不依赖
  // 归档的断言也一起陪葬。放进 `beforeAll`（套件被 skip 时不执行）才真的做到
  // 「有归档就跑、没归档就跳过」。同一处缺陷在 corpus.test.ts 里也有，Task 10
  // 一并收掉。
  beforeAll(() => {
    files = allCss(STYLE_DIR);
  });

  it('解析全部真实样式表不崩溃', () => {
    expect(files.length).toBeGreaterThan(200);
    for (const f of files) {
      expect(() => parseVcss(readFileSync(f, 'utf8')), f).not.toThrow();
    }
  });

  it('csgostyles.css 的 @define 与规则数量符合实际', () => {
    const doc = parseVcss(readFileSync(`${STYLE_DIR}/csgostyles.css`, 'utf8'));
    // 该文件顶部有上百个 @define 常量，正文有数百个规则块
    expect(doc.defines.length).toBeGreaterThan(100);
    expect(doc.rules.length).toBeGreaterThan(400);
  });

  /**
   * Task 3b 的聚合闸门：守「语料里没有任何文件因为括号不平衡而丢内容」这条
   * 性质本身，不钉哪个文件、哪一行——钉具体文件/行号的表格太脆（归档一换
   * 就全部作废），钉的还是症状不是性质。
   *
   * 指标选了声明总数、没选规则总数：两者都对 Task 3b 修的那个 bug（未闭合
   * 的 `(` 让 `scanValue` 永远不认识 `;`/`}`，把光标之后的内容整个吞掉）
   * 敏感，但在 STYLE_DIR（20260829 单构建，225 个文件）上实测声明总数的
   * 信号更强：改动前 33076 条、改动后 34174 条，差 1098 条（占改动后总数
   * 3.21%）；规则总数改动前 10465、改动后 10756，只差 291（2.71%）。用
   * 「更敏感的那个」，选声明总数。
   *
   * 下界钉的是改动后的精确实测值（34174），不是留了余量的估计数——`)`
   * `toBeGreaterThanOrEqual` 而不是 `toBe`，是为了让语料未来自然增长
   * （新增不相关文件、新增声明）不会无谓地把这条测试弄红；但下界本身贴着
   * 当前实测值，不留 slack，一旦解析器再度吞掉内容，总数只会往下掉，不
   * 会因为「凑巧还有余量」而被掩盖。
   *
   * 自证 tamper（细节与真实报错文本见 task-3b-report.md 的 Addendum）：
   * 把 `scanValue` 还原成 Task 3b 之前带括号深度门控的版本，这条测试从
   * 34174 掉到 33076，稳稳报错；换回修复后的版本，立刻转绿。
   */
  it('声明总数不低于修复后的实测值——语料没有再因括号不平衡丢内容（Task 3b 聚合闸门）', () => {
    let totalDeclarations = 0;
    for (const f of files) {
      const doc = parseVcss(readFileSync(f, 'utf8'));
      for (const r of doc.rules) totalDeclarations += countDeclarations(r);
      for (const k of doc.keyframes) totalDeclarations += countDeclarations(k.rule);
    }
    expect(totalDeclarations).toBeGreaterThanOrEqual(34174);
  });
});
