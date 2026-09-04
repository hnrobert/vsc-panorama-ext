import { describe, it, expect } from 'vitest';
import { localeOf } from '../../../../src/core/i18n/locale';

describe('localeOf：显示语言到文案语言的归并', () => {
  it('简体中文归到 zh-cn', () => {
    expect(localeOf('zh-cn')).toBe('zh-cn');
  });

  /*
   * 繁中给简体中文而不是英文：同为中文读者，简体的可读性远高于英文。
   * VSCode 的中文语言包发布 zh-cn 与 zh-tw 两种，两者都会出现在
   * vscode.env.language 里。
   */
  it('繁体中文也归到 zh-cn', () => {
    expect(localeOf('zh-tw')).toBe('zh-cn');
    expect(localeOf('zh-hk')).toBe('zh-cn');
  });

  it('大小写不敏感——env.language 的大小写形态不由我们决定', () => {
    expect(localeOf('ZH-CN')).toBe('zh-cn');
    expect(localeOf('Zh-Tw')).toBe('zh-cn');
  });

  it('其余语言一律 en', () => {
    for (const l of ['en', 'en-us', 'ja', 'de', 'ko', 'ru', 'pt-br']) {
      expect(localeOf(l), `${l} 应归到 en`).toBe('en');
    }
  });

  /*
   * 空串形态：vscode.env.language 在正常运行下总有值，但测试宿主与未来可能的
   * CLI 入口不保证。回落 en 而不是抛异常——本地化拿不到语言不该让整个扩展起不来。
   */
  it('空串回落 en', () => {
    expect(localeOf('')).toBe('en');
  });

  /*
   * 反例，咬住「用 includes('zh') 而不是前缀匹配」这个实现错误。
   * 'en-zh' 含 zh 但不以 zh 开头，子串实现会把它误判成中文。
   */
  it('只认前缀，不认子串', () => {
    expect(localeOf('en-zh')).toBe('en');
  });
});
