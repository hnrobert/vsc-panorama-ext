import { describe, it, expect } from 'vitest';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex, type SymbolLocation } from '../../../../src/core/index/workspace-index';

function build(files: Record<string, string>, contentRoots?: string[]): WorkspaceIndex {
  const known = new Set(Object.keys(files));
  // 目录存在性：任何是某个文件前缀的路径都算目录
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));

  const idx = new WorkspaceIndex({ exists, contentRoots });
  for (const [uri, text] of Object.entries(files)) {
    idx.update(
      uri.endsWith('.xml')
        ? symbolsOfVxml(uri, parseVxml(text))
        : symbolsOfVcss(uri, parseVcss(text)),
    );
  }
  return idx;
}

const LAYOUT = '/p/panorama/layout/a.xml';
const STYLE = '/p/panorama/styles/a.css';

describe('WorkspaceIndex · 基本查询', () => {
  const idx = build({
    [STYLE]: '.btn\n{\n\twidth: 1px;\n}\n.btn--big\n{\n\twidth: 2px;\n}',
    [LAYOUT]: '<root><Panel class="btn"><Label id="Title" /></Panel></root>',
  });

  it('类名定义来自 VCSS', () => {
    expect(idx.classDefinitions('btn').map((l) => l.uri)).toEqual([STYLE]);
  });

  it('类名引用来自 VXML', () => {
    expect(idx.classReferences('btn').map((l) => l.uri)).toEqual([LAYOUT]);
  });

  it('id 定义来自 VXML', () => {
    expect(idx.idDefinitions('Title').map((l) => l.uri)).toEqual([LAYOUT]);
  });

  it('列出全部类名', () => {
    expect([...idx.allClassNames()].sort()).toEqual(['btn', 'btn--big']);
  });

  it('查不到的名字返回空数组而不是抛异常', () => {
    expect(idx.classDefinitions('nope')).toEqual([]);
    expect(idx.idDefinitions('nope')).toEqual([]);
  });
});

describe('WorkspaceIndex · 增量更新', () => {
  it('重新 update 同一文件会替换旧符号，不累加', () => {
    const idx = build({ [STYLE]: '.old\n{\n\twidth: 1px;\n}' });
    expect(idx.allClassNames()).toEqual(['old']);

    idx.update(symbolsOfVcss(STYLE, parseVcss('.fresh\n{\n\twidth: 1px;\n}')));
    expect(idx.allClassNames()).toEqual(['fresh']);
  });

  it('remove 会清掉该文件的全部符号', () => {
    const idx = build({ [STYLE]: '.a\n{\n\twidth: 1px;\n}' });
    idx.remove(STYLE);
    expect(idx.allClassNames()).toEqual([]);
    expect(idx.classDefinitions('a')).toEqual([]);
  });

  it('同名类在多个文件里定义，全部返回', () => {
    const other = '/p/panorama/styles/b.css';
    const idx = build({
      [STYLE]: '.dup\n{\n\twidth: 1px;\n}',
      [other]: '.dup\n{\n\twidth: 2px;\n}',
    });
    expect(idx.classDefinitions('dup').map((l) => l.uri).sort()).toEqual([STYLE, other].sort());
  });
});

describe('WorkspaceIndex · @define 与 @keyframes', () => {
  const idx = build({
    [STYLE]: "@define blue: #333;\n@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}\n.a\n{\n\tcolor: blue;\n\tanimation-name: 'fade';\n}",
  });

  it('@define 定义与引用都可查', () => {
    expect(idx.defineDefinitions('blue')).toHaveLength(1);
    expect(idx.defineReferences('blue')).toHaveLength(1);
  });

  it('@keyframes 定义与引用都可查', () => {
    expect(idx.keyframeDefinitions('fade')).toHaveLength(1);
    expect(idx.keyframeReferences('fade')).toHaveLength(1);
  });

  it('列出全部 @define 与 @keyframes 名', () => {
    expect(idx.allDefineNames()).toEqual(['blue']);
    expect(idx.allKeyframeNames()).toEqual(['fade']);
  });
});

describe('WorkspaceIndex · include 解析', () => {
  it('布局 include 的样式表被解析成实际 uri', () => {
    const idx = build({
      [LAYOUT]:
        '<root><styles><include src="s2r://panorama/styles/a.vcss_c" /></styles><Panel /></root>',
      [STYLE]: '.btn\n{\n\twidth: 1px;\n}',
    });
    expect(idx.includedStylesheets(LAYOUT)).toEqual([STYLE]);
  });

  it('include 指向不存在的文件时不进结果，也不抛异常', () => {
    const idx = build({
      [LAYOUT]:
        '<root><styles><include src="s2r://panorama/styles/nope.vcss_c" /></styles><Panel /></root>',
    });
    expect(idx.includedStylesheets(LAYOUT)).toEqual([]);
  });

  it('样式表的 @import 同样被解析', () => {
    const base = '/p/panorama/styles/base.css';
    const idx = build({
      [STYLE]: '@import url("s2r://panorama/styles/base.vcss_c");\n.a\n{\n\twidth: 1px;\n}',
      [base]: '.b\n{\n\twidth: 1px;\n}',
    });
    expect(idx.includedStylesheets(STYLE)).toEqual([base]);
  });
});

describe('WorkspaceIndex · 查询结果不可污染索引', () => {
  it('别名隔离：污染上一次查询结果不影响下一次查询', () => {
    const idx = build({ [STYLE]: '.x\n{\n\twidth: 1px;\n}' });

    const a = idx.classDefinitions('x') as SymbolLocation[];
    a.push({ uri: 'fake', name: 'x', start: 0, end: 0 });

    const b = idx.classDefinitions('x');
    expect(b).toHaveLength(1);
    expect(a).not.toBe(b);
  });

  it('空结果同样不可写：查不到的名字返回冻结数组', () => {
    const idx = build({ [STYLE]: '.x\n{\n\twidth: 1px;\n}' });

    const empty = idx.classDefinitions('nope');
    expect(empty).toEqual([]);
    expect(() =>
      (empty as SymbolLocation[]).push({ uri: 'fake', name: 'nope', start: 0, end: 0 }),
    ).toThrow();
  });
});
