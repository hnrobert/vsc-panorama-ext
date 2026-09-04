import { describe, it, expect } from 'vitest';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import rawData from '../../../../data/vcss-properties.json';

const CJK = /[一-龥]/;

describe('PropertyRegistry 按 locale 解析文案', () => {
  it('zh-cn 拿到中文', () => {
    expect(PropertyRegistry.load('zh-cn').get('flow-children')?.description).toBe(
      '子元素排列方向，替代 Web 的 flex / grid',
    );
  });

  it('en 拿到英文', () => {
    expect(PropertyRegistry.load('en').get('flow-children')?.description).toBe(
      'Direction in which children are laid out; replaces Web flex / grid',
    );
  });

  /*
   * 解析后的类型必须是 string，不能是残留的 { 'zh-cn', en } 对象。
   *
   * 只断言 toBeDefined 抓不住「忘了解析、把整个双语对象透传下去」——那种情况下
   * 悬停会显示 "[object Object]"，而所有 toBeDefined 照样绿。这条对全部 105 个
   * 属性、10 个函数、3 个 at-rule 逐个查类型。
   */
  it('解析后是字符串，不是残留的双语对象', () => {
    const r = PropertyRegistry.load('en');
    const props = r.allProperties();
    expect(props.length, '属性集合为空，本条会空转').toBeGreaterThanOrEqual(100);
    for (const p of props) {
      const info = r.get(p)!;
      expect(typeof info.description, `${p} 的 description 未解析`).toBe('string');
      if (info.webEquivalent !== undefined) {
        expect(typeof info.webEquivalent, `${p} 的 webEquivalent 未解析`).toBe('string');
      }
    }
    expect(r.functions().length, '函数集合为空，本条会空转').toBeGreaterThanOrEqual(10);
    for (const f of r.functions()) {
      expect(typeof f.signature, `${f.name} 的 signature 未解析`).toBe('string');
      expect(typeof f.description, `${f.name} 的 description 未解析`).toBe('string');
    }
  });

  it('webOnly 的提示也按 locale 解析', () => {
    expect(PropertyRegistry.load('zh-cn').webOnlyHint('display')).toBe(
      'Panorama 没有 display。用 flow-children 控制子元素排列方向',
    );
    expect(PropertyRegistry.load('en').webOnlyHint('display')).toBe(
      'Panorama has no display. Use flow-children to control the direction children are laid out in',
    );
  });

  it('atRule 也按 locale 解析', () => {
    expect(PropertyRegistry.load('zh-cn').atRule('@keyframes')?.signature).toBe(
      "@keyframes '名字' { ... }",
    );
    expect(PropertyRegistry.load('en').atRule('@keyframes')?.signature).toBe(
      "@keyframes 'name' { ... }",
    );
  });

  /*
   * webOnlyHint / atRule 此前是裸 [] 索引，'toString' 会顺着原型链返回一个函数。
   * webOnlyHint 的唯一调用方 webOnlyFixFor 用 typeof 挡住了，所以那不是活 bug；
   * 守卫收到上游之后，那道 typeof 从「承重」降为「双保险」。
   */
  it('查不到的名字一律 undefined，不会顺原型链返回内建成员', () => {
    const r = PropertyRegistry.load('en');
    for (const k of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(r.webOnlyHint(k), `webOnlyHint('${k}') 不该有值`).toBeUndefined();
      expect(r.atRule(k), `atRule('${k}') 不该有值`).toBeUndefined();
      expect(r.get(k), `get('${k}') 不该有值`).toBeUndefined();
    }
  });
});

describe('数据文件的双语完整性', () => {
  /*
   * 这一组是 JSON 的编译期检查替身。tsc 兜得住 Messages 接口，兜不住数据文件——
   * 漏译一条只会在用户悬停时才暴露。
   *
   * 三条断言缺一不可：
   *   1. 两种语言都在且非空（漏译）
   *   2. 英文里没有汉字（把中文抄进 en 冒充译文）
   *   3. 集合非空（数据路径写错、字段改名会让所有循环零迭代而全部通过）
   */
  const LOCALES = ['zh-cn', 'en'] as const;

  function ok(v: unknown, where: string): void {
    for (const l of LOCALES) {
      const s = (v as Record<string, unknown> | undefined)?.[l];
      expect(typeof s, `${where} 缺 ${l}`).toBe('string');
      expect((s as string).trim(), `${where} 的 ${l} 是空串`).not.toBe('');
    }
    const en = (v as Record<string, string>).en;
    expect(CJK.test(en), `${where} 的英文里有汉字：${en}`).toBe(false);
  }

  it('扫描到的条目数与文件规模相符——集合不能是空的', () => {
    expect(Object.keys(rawData.properties).length).toBeGreaterThanOrEqual(100);
    expect(rawData.functions.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(rawData.atRules).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(rawData.webOnly).length).toBeGreaterThanOrEqual(15);
  });

  it('每条 property 的 description / webEquivalent 都有两种语言', () => {
    for (const [name, info] of Object.entries(rawData.properties)) {
      const i = info as { description: unknown; webEquivalent?: unknown };
      ok(i.description, `properties.${name}.description`);
      if (i.webEquivalent !== undefined) ok(i.webEquivalent, `properties.${name}.webEquivalent`);
    }
  });

  it('每个 function 的 signature / description 都有两种语言', () => {
    for (const f of rawData.functions) {
      const g = f as { name: string; signature: unknown; description: unknown };
      ok(g.signature, `functions.${g.name}.signature`);
      ok(g.description, `functions.${g.name}.description`);
    }
  });

  it('每条 atRule 与 webOnly 都有两种语言', () => {
    for (const [name, info] of Object.entries(rawData.atRules)) {
      const a = info as { signature: unknown; description: unknown };
      ok(a.signature, `atRules.${name}.signature`);
      ok(a.description, `atRules.${name}.description`);
    }
    for (const [name, v] of Object.entries(rawData.webOnly)) ok(v, `webOnly.${name}`);
  });

  /*
   * 反向：中文那一半也不能是英文的复制。少数条目中英同形是合理的（如
   * webEquivalent 的值 "display: flex + flex-direction" 本身就是 CSS 代码），
   * 所以这里不逐条断言不等，只要求整体上「大部分条目的中文含汉字」。
   * 阈值取 90%：105 条属性说明里，纯代码/纯符号的极少。
   */
  it('中文那一半确实是中文，不是英文的复制', () => {
    const zh = Object.values(rawData.properties).map(
      (i) => (i as { description: Record<string, string> }).description['zh-cn'],
    );
    const withCjk = zh.filter((s) => CJK.test(s)).length;
    expect(withCjk / zh.length, `只有 ${withCjk}/${zh.length} 条属性说明含汉字`).toBeGreaterThan(
      0.9,
    );
  });
});
