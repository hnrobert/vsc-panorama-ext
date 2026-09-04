import { describe, it, expect } from 'vitest';
import { PanelRegistry } from '../../../../src/core/data/panels';
import rawPanels from '../../../../data/panels.json';
import zhDocs from '../../../../data/attribute-docs.zh-cn.json';

const CJK = /[一-龥]/;
const EN_DOCS = rawPanels.attributeDocs as Record<string, string>;
const ZH_DOCS = zhDocs.docs as Record<string, string>;

describe('PanelRegistry 按 locale 解析属性文档', () => {
  it('en 拿到 Valve 原文', () => {
    expect(PanelRegistry.load('en').docFor('audible-seconds')).toBe(EN_DOCS['audible-seconds']);
  });

  it('zh-cn 拿到中文对照', () => {
    expect(PanelRegistry.load('zh-cn').docFor('audible-seconds')).toBe(ZH_DOCS['audible-seconds']);
  });

  /*
   * 中英必须真的不同。只断言「两边都非空」抓不住「sidecar 里直接抄了英文原文」——
   * 那种情况下中文用户看到的还是英文，而所有非空断言照常绿。
   *
   * 这批 14 条全是散文说明，不存在「本身就是代码所以中英同形」的情形，
   * 因此可以逐条断言不等，不需要像 vcss-properties 那样用比例阈值。
   */
  it('中文对照不是英文原文的复制', () => {
    const en = PanelRegistry.load('en');
    const zh = PanelRegistry.load('zh-cn');
    const attrs = Object.keys(EN_DOCS);
    expect(attrs.length, 'attributeDocs 是空的，本条会空转').toBeGreaterThanOrEqual(14);
    for (const attr of attrs) {
      expect(zh.docFor(attr), `${attr} 的中文与英文相同，疑似直接抄了原文`).not.toBe(
        en.docFor(attr),
      );
    }
  });

  it('英文那一份里没有汉字，中文那一份里有', () => {
    const en = PanelRegistry.load('en');
    const zh = PanelRegistry.load('zh-cn');
    for (const attr of Object.keys(EN_DOCS)) {
      expect(CJK.test(en.docFor(attr)!), `${attr} 的英文里有汉字`).toBe(false);
      expect(CJK.test(zh.docFor(attr)!), `${attr} 的中文里没有汉字`).toBe(true);
    }
  });

  it('docFor 不会顺原型链返回内建成员', () => {
    const r = PanelRegistry.load('en');
    for (const k of ['toString', 'constructor', 'valueOf']) {
      expect(r.docFor(k), `docFor('${k}') 不该有值`).toBeUndefined();
    }
  });

  /*
   * locale 只影响 attributeDocs，不能影响结构数据。两种 locale 下面板集合、
   * 继承关系、属性集必须完全一致——否则说明 resolveDocs 的展开动作误伤了别的字段。
   */
  it('locale 不影响任何结构数据', () => {
    const en = PanelRegistry.load('en');
    const zh = PanelRegistry.load('zh-cn');
    expect(zh.allPanels()).toEqual(en.allPanels());
    expect(zh.childPanels()).toEqual(en.childPanels());
    for (const p of en.allPanels().slice(0, 40)) {
      expect(zh.attributesOf(p), `${p} 的属性集受 locale 影响了`).toEqual(en.attributesOf(p));
    }
  });
});

describe('sidecar 与生成文件的一致性', () => {
  /*
   * 这一组是 sidecar 方案的核心保障。
   *
   * panels.json 由 tools/gen-panel-data.mjs 从 XSD 全量重建，中文译文不能写在
   * 那里（会被无声抹掉），所以放在独立的 sidecar 里。代价是两个文件可能失配——
   * 下面两条正反都查，让失配在开发期就红。
   */
  it('attributeDocs 每个 key 在 sidecar 里都有中文', () => {
    const keys = Object.keys(EN_DOCS);
    expect(keys.length, 'attributeDocs 是空的，本条会空转').toBeGreaterThanOrEqual(14);
    const missing = keys.filter((k) => !Object.hasOwn(ZH_DOCS, k));
    expect(
      missing,
      `以下属性缺中文对照，请补进 data/attribute-docs.zh-cn.json：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  /*
   * 反向也要查：sidecar 里有、panels.json 里没有的条目是死条目——可能是 Valve
   * 删了属性，也可能是手写时把名字打错了。留着会让人误以为覆盖是完整的。
   */
  it('sidecar 里没有多余的死条目', () => {
    const stale = Object.keys(ZH_DOCS).filter((k) => !Object.hasOwn(EN_DOCS, k));
    expect(stale, `以下条目在 panels.json 里已不存在：\n${stale.join('\n')}`).toEqual([]);
  });

  it('sidecar 的每条中文都非空', () => {
    for (const [k, v] of Object.entries(ZH_DOCS)) {
      expect(typeof v, `${k} 不是字符串`).toBe('string');
      expect(v.trim(), `${k} 是空串`).not.toBe('');
    }
  });
});
