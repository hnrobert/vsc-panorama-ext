import { describe, it, expect } from 'vitest';
import { messagesFor } from '../../../../src/core/i18n';
import type { UiMessages } from '../../../../src/core/i18n';

/*
 * 只用 CJK 区间 U+4E00–U+9FA5，不要扩大到「所有非 ASCII」：
 * 文案里合法地含有 ⚠️(U+26A0) / ✅(U+2705) / ❌(U+274C)，扩大区间会把它们
 * 当成未翻译的残留误报。已实测三者都在区间外。
 */
const CJK = /[一-龥]/;

/**
 * 用一组通吃的实参把每个成员都调一遍。
 *
 * 这里查的是**译文本身**有没有汉字、是不是空串，不是格式化逻辑，所以实参用
 * 什么值不重要——只要每种参数形态都能接住。UiMessages 的参数只有
 * string / readonly string[] / number / boolean / null | undefined / 'sdgt' 六种。
 */
function callAll(ui: UiMessages): Array<[string, string]> {
  return [
    ['panoramaOnly', ui.panoramaOnly()],
    ['values', ui.values(['a', 'b'])],
    ['webEquivalent', ui.webEquivalent('display: flex')],
    ['panoramaOnlyNote', ui.panoramaOnlyNote()],
    ['defineInCurrentFile', ui.defineInCurrentFile('#fff')],
    ['defineFromOtherSheet', ui.defineFromOtherSheet()],
    ['keyframesFromOtherSheet', ui.keyframesFromOtherSheet()],
    ['seenInCorpusOnly', ui.seenInCorpusOnly()],
    ['defineHover', ui.defineHover('#fff')],
    ['declarationCount(1)', ui.declarationCount(1)],
    ['declarationCount(3)', ui.declarationCount(3)],
    ['stylesheetIncluded(true)', ui.stylesheetIncluded(true)],
    ['stylesheetIncluded(false)', ui.stylesheetIncluded(false)],
    ['panelType(Image)', ui.panelType('Image')],
    ['panelType(null)', ui.panelType(null)],
    ['rootOnlyNote', ui.rootOnlyNote()],
    ['whitelistNote(true)', ui.whitelistNote(true)],
    ['whitelistNote(false)', ui.whitelistNote(false)],
    ['attributeOf(Image)', ui.attributeOf('Image')],
    ['attributeOf(undefined)', ui.attributeOf(undefined)],
    ['bindingDoc(s)', ui.bindingDoc('s')],
    ['bindingDoc(d)', ui.bindingDoc('d')],
    ['bindingDoc(g)', ui.bindingDoc('g')],
    ['bindingDoc(t)', ui.bindingDoc('t')],
    ['continueCompletion', ui.continueCompletion()],
  ];
}

describe('messagesFor', () => {
  it('两种 locale 各拿到自己那份', () => {
    expect(messagesFor('zh-cn').ui.panoramaOnly()).toBe('Panorama 专属');
    expect(messagesFor('en').ui.panoramaOnly()).toBe('Panorama-only');
  });

  /*
   * 覆盖面断言。callAll 是手写的，新增接口成员时很容易忘了往里加——忘了的话
   * 下面的无汉字/非空检查就悄悄漏掉那一条。这里拿接口实现对象的 key 数与
   * callAll 覆盖的成员数对账，缺一个就红。
   */
  it('callAll 覆盖 UiMessages 的全部成员', () => {
    const declared = Object.keys(messagesFor('en').ui);
    const covered = new Set(callAll(messagesFor('en').ui).map(([k]) => k.replace(/\(.*\)$/, '')));
    expect(declared.length, 'ui 目录是空的，本组会空转').toBeGreaterThanOrEqual(15);
    const missing = declared.filter((k) => !covered.has(k));
    expect(missing, `callAll 漏了这些成员：\n${missing.join('\n')}`).toEqual([]);
  });

  /*
   * 英文目录零汉字、零空串。
   *
   * 非空这一半是必需的：空串同样不含汉字，只查汉字会让「把 en 实现写成空串」
   * 蒙混过关。
   */
  it('英文 ui 目录零汉字且零空串', () => {
    for (const [name, out] of callAll(messagesFor('en').ui)) {
      expect(typeof out, `ui.${name} 没返回字符串`).toBe('string');
      expect(CJK.test(out), `ui.${name} 的英文里有汉字：${out}`).toBe(false);
      expect(out.trim(), `ui.${name} 的英文是空串`).not.toBe('');
    }
  });

  /* 反向：中文目录不能是英文的复制品。逐条要求含汉字——ui 这批全是散文，
   * 没有「本身就是代码所以中英同形」的成员。 */
  it('中文 ui 目录确实是中文', () => {
    for (const [name, out] of callAll(messagesFor('zh-cn').ui)) {
      expect(CJK.test(out), `ui.${name} 的中文里没有汉字：${out}`).toBe(true);
    }
  });

  /* 两份目录的成员集合必须一致——tsc 已经保证了，这条是防止有人给某一份
   * 加了接口之外的额外成员（那会让「英文零汉字」的遍历漏掉它）。 */
  it('两份目录的成员集合完全相同', () => {
    expect(Object.keys(messagesFor('zh-cn').ui).sort()).toEqual(
      Object.keys(messagesFor('en').ui).sort(),
    );
  });

  /* 英文的单复数：'1 declarations' 是最常见的 i18n 低级错误 */
  it('英文 declarationCount 处理了单复数', () => {
    expect(messagesFor('en').ui.declarationCount(1)).toBe('1 declaration');
    expect(messagesFor('en').ui.declarationCount(2)).toBe('2 declarations');
  });
});
