import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseXsd } from '../../tools/gen-panel-data.mjs';
import { XSD_PATH } from '../../tools/paths.mjs';

// vitest 走 ESM，没有 __dirname
const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/mini-layout.xsd', import.meta.url)),
  'utf8',
);

describe('parseXsd（夹具）', () => {
  const data = parseXsd(fixture);

  it('过滤掉 Internal_* 内部类型', () => {
    expect(Object.keys(data.panels).sort()).toEqual(['Label', 'Panel', 'Popup']);
  });

  it('从类型注释解析出继承链', () => {
    expect(data.panels.Label.derivedFrom).toBe('Panel');
    expect(data.panels.Panel.derivedFrom).toBeNull();
  });

  it('属性按声明者分组去重', () => {
    // Label 与 Panel 都列了 id，但 id 只应记在声明者 Panel 名下一次
    expect(data.attributeSets).toEqual({
      Label: ['text'],
      Panel: ['id'],
      Popup: ['popupwidth'],
    });
    expect(data.panels.Label.sets).toEqual(['Label', 'Panel']);
  });

  it('只出现在 root choice、不在 Internal_BaseType 的类型标记为 rootOnly', () => {
    expect(data.panels.Popup.rootOnly).toBe(true);
    expect(data.panels.Panel.rootOnly).toBe(false);
    expect(data.panels.Label.rootOnly).toBe(false);
  });

  it('提取真实描述并解码 HTML 实体，样板描述不记录', () => {
    expect(data.attributeDocs.popupwidth).toBe("How wide the popup is. Default is '100px'");
    // id / text 的 documentation 在 <br /><br /> 之后为空，属样板，不应记录
    expect(data.attributeDocs).not.toHaveProperty('id');
    expect(data.attributeDocs).not.toHaveProperty('text');
  });
});

describe.skipIf(!existsSync(XSD_PATH))('parseXsd（真实 XSD）', () => {
  let data: ReturnType<typeof parseXsd>;

  // `describe.skipIf` 只跳过 `it`，**回调体照常执行**——扫语料留在回调体里
  // 会让没有归档的机器（CI）在收集阶段 ENOENT 崩掉整份文件，连本文件里不依赖
  // 归档的断言也一起陪葬。放进 `beforeAll`（套件被 skip 时不执行）才真的做到
  // 「有归档就跑、没归档就跳过」。同一处缺陷在 corpus.test.ts 里也有，Task 10
  // 一并收掉。
  beforeAll(() => {
    data = parseXsd(readFileSync(XSD_PATH, 'utf8'));
  });

  it('恰好 245 个面板类型（249 个 complexType 减去 4 个 Internal_*）', () => {
    expect(Object.keys(data.panels)).toHaveLength(245);
  });

  it('恰好 43 个 rootOnly 类型（245 根位置 - 202 子元素位置）', () => {
    const rootOnly = Object.values(data.panels).filter((p) => p.rootOnly);
    expect(rootOnly).toHaveLength(43);
    expect(data.panels.PopupCustomLayout.rootOnly).toBe(true);
    expect(data.panels.Panel.rootOnly).toBe(false);
  });

  it('去重后共 303 个属性名', () => {
    const names = new Set(Object.values(data.attributeSets).flat());
    expect(names.size).toBe(303);
  });

  it('Button 没有 text 属性（规格 §10.3 的去重依据）', () => {
    const buttonAttrs = new Set(data.panels.Button.sets.flatMap((s) => data.attributeSets[s]));
    expect(buttonAttrs.has('text')).toBe(false);
    const textButtonAttrs = new Set(
      data.panels.TextButton.sets.flatMap((s) => data.attributeSets[s]),
    );
    expect(textButtonAttrs.has('text')).toBe(true);
  });

  it('保留了 XSD 里少数带真实描述的属性', () => {
    expect(data.attributeDocs.texturewidth).toContain('override the size of vector graphics');
  });
});
