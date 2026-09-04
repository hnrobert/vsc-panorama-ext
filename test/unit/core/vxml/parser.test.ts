import { describe, it, expect, beforeAll } from 'vitest';
import { parseVxml } from '../../../../src/core/vxml/parser';

describe('parseVxml · 正常结构', () => {
  it('解析嵌套元素与父子关系', () => {
    const doc = parseVxml('<root><Panel><Label /></Panel></root>');
    expect(doc.roots).toHaveLength(1);
    const root = doc.roots[0];
    expect(root.tag).toBe('root');
    expect(root.children[0].tag).toBe('Panel');
    expect(root.children[0].children[0].tag).toBe('Label');
    expect(root.children[0].children[0].parent?.tag).toBe('Panel');
  });

  it('自闭合标签不吞掉后续兄弟节点', () => {
    const doc = parseVxml('<root><Label /><Image /></root>');
    expect(doc.roots[0].children.map((c) => c.tag)).toEqual(['Label', 'Image']);
    expect(doc.roots[0].children[0].selfClosing).toBe(true);
  });

  it('记录属性名与属性值的区间', () => {
    const text = '<Panel class="hud-root" />';
    const doc = parseVxml(text);
    const attr = doc.roots[0].attributes[0];
    expect(attr.name).toBe('class');
    expect(text.slice(attr.nameStart, attr.nameEnd)).toBe('class');
    expect(attr.value).toBe('hud-root');
    expect(text.slice(attr.valueStart!, attr.valueEnd!)).toBe('hud-root');
  });

  it('注释不产生元素', () => {
    const doc = parseVxml('<root><!-- <Panel /> --><Label /></root>');
    expect(doc.roots[0].children.map((c) => c.tag)).toEqual(['Label']);
  });

  it('单引号属性值同样识别', () => {
    const doc = parseVxml("<Panel class='a' />");
    expect(doc.roots[0].attributes[0].value).toBe('a');
  });
});

describe('parseVxml · 容错（编辑中途的半成品）', () => {
  it('只敲了一半的标签名不抛异常，且能取到该名字', () => {
    const doc = parseVxml('<root><Pa');
    expect(doc.roots[0].children[0].tag).toBe('Pa');
    expect(doc.roots[0].children[0].unclosed).toBe(true);
  });

  it('属性写了名字还没写值', () => {
    const doc = parseVxml('<Panel class=');
    const attr = doc.roots[0].attributes[0];
    expect(attr.name).toBe('class');
    expect(attr.value).toBeUndefined();
  });

  it('属性值引号未闭合', () => {
    const doc = parseVxml('<Panel class="hud');
    const attr = doc.roots[0].attributes[0];
    expect(attr.value).toBe('hud');
    expect(attr.unterminated).toBe(true);
  });

  it('未闭合的元素延伸到文档末尾而不是丢失', () => {
    const doc = parseVxml('<root><Panel><Label /></root>');
    const panel = doc.roots[0].children[0];
    expect(panel.tag).toBe('Panel');
    expect(panel.children.map((c) => c.tag)).toEqual(['Label']);
  });

  it('多余的闭合标签被忽略而不是抛异常', () => {
    expect(() => parseVxml('<root></Panel></root>')).not.toThrow();
  });

  it('空文档与纯空白不抛异常', () => {
    expect(parseVxml('').roots).toEqual([]);
    expect(parseVxml('   \n\t ').roots).toEqual([]);
  });
});

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE } from '../../../../tools/paths.mjs';

function allXml(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allXml(p, out);
    else if (name.endsWith('.xml')) out.push(p);
  }
  return out;
}

const LAYOUT_DIR = `${ARCHIVE}/20260829/panorama/layout`;

describe.skipIf(!existsSync(LAYOUT_DIR))('parseVxml · 真实语料', () => {
  let files: string[] = [];

  // `describe.skipIf` 只跳过 `it`，**回调体照常执行**——扫语料留在回调体里
  // 会让没有归档的机器（CI）在收集阶段 ENOENT 崩掉整份文件，连本文件里不依赖
  // 归档的断言也一起陪葬。放进 `beforeAll`（套件被 skip 时不执行）才真的做到
  // 「有归档就跑、没归档就跳过」。同一处缺陷在 corpus.test.ts 里也有，Task 10
  // 一并收掉。
  beforeAll(() => {
    files = allXml(LAYOUT_DIR);
  });

  it('解析全部真实布局不崩溃，且每份都解析出根元素', () => {
    expect(files.length).toBeGreaterThan(200);
    for (const f of files) {
      const doc = parseVxml(readFileSync(f, 'utf8'));
      expect(doc.roots.length, `${f} 未解析出根元素`).toBeGreaterThan(0);
      expect(doc.roots.some((r) => r.tag === 'root'), `${f} 缺少 <root>`).toBe(true);
    }
  });
});
