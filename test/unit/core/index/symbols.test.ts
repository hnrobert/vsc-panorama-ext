import { describe, it, expect } from 'vitest';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';

const vxml = (text: string) => symbolsOfVxml('file:///a/main.xml', parseVxml(text));
const vcss = (text: string) => symbolsOfVcss('file:///a/main.css', parseVcss(text));

describe('symbolsOfVxml', () => {
  it('class 属性里的每个类名单独成一条引用，各自带区间', () => {
    const text = '<root><Panel class="a b" /></root>';
    const s = symbolsOfVxml('file:///a/main.xml', parseVxml(text));
    expect(s.classRefs.map((c) => c.name)).toEqual(['a', 'b']);
    expect(text.slice(s.classRefs[0].start, s.classRefs[0].end)).toBe('a');
    expect(text.slice(s.classRefs[1].start, s.classRefs[1].end)).toBe('b');
  });

  it('多余空白不产生空类名', () => {
    expect(vxml('<root><Panel class="  a   b  " /></root>').classRefs.map((c) => c.name)).toEqual([
      'a',
      'b',
    ]);
  });

  it('id 属性算定义（服务端按 id 寻址）', () => {
    const text = '<root><Panel><Label id="Score" /></Panel></root>';
    const s = symbolsOfVxml('file:///a/main.xml', parseVxml(text));
    expect(s.idDefs.map((i) => i.name)).toEqual(['Score']);
    expect(text.slice(s.idDefs[0].start, s.idDefs[0].end)).toBe('Score');
  });

  it('include 与 src 分开收集', () => {
    const s = vxml(
      '<root><styles><include src="s2r://panorama/styles/a.vcss_c" /></styles>' +
        '<Panel><Image src="s2r://panorama/images/b.vsvg" /></Panel></root>',
    );
    expect(s.includes.map((r) => r.target)).toEqual(['s2r://panorama/styles/a.vcss_c']);
    expect(s.resources.map((r) => r.target)).toEqual(['s2r://panorama/images/b.vsvg']);
  });

  it('收集全部四种数据绑定前缀', () => {
    const s = vxml(
      '<root><Panel><Label text="{s:a}" /><Label text="x {d:b} y" />' +
        '<Label text="{g:c:1}" /><Label text="{t:d}" /></Panel></root>',
    );
    expect(s.bindings.map((b) => b.name)).toEqual(['s:a', 'd:b', 'g:c:1', 't:d']);
  });

  it('VXML 不产生 class 定义 —— 类名在 VCSS 里定义', () => {
    expect(vxml('<root><Panel class="a" /></root>').classDefs).toEqual([]);
  });
});

describe('symbolsOfVcss', () => {
  it('选择器里的类名算定义，区间落在选择器内', () => {
    const text = '.a .b\n{\n\twidth: 1px;\n}';
    const s = symbolsOfVcss('file:///a/main.css', parseVcss(text));
    expect(s.classDefs.map((c) => c.name)).toEqual(['a', 'b']);
    expect(text.slice(s.classDefs[0].start, s.classDefs[0].end)).toBe('a');
    expect(text.slice(s.classDefs[1].start, s.classDefs[1].end)).toBe('b');
  });

  it('复合选择器的每一段都算一次', () => {
    expect(vcss('.a.b\n{\n\twidth: 1px;\n}').classDefs.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('id 选择器算引用而非定义 —— id 在 VXML 里定义', () => {
    const s = vcss('#Score\n{\n\twidth: 1px;\n}');
    expect(s.idRefs.map((i) => i.name)).toEqual(['Score']);
    expect(s.idDefs).toEqual([]);
  });

  it('伪类不被当成类名', () => {
    expect(vcss('.btn:hover\n{\n\twidth: 1px;\n}').classDefs.map((c) => c.name)).toEqual(['btn']);
  });

  it('@define 的定义与值中的引用分开收集', () => {
    const s = vcss('@define blue: #333;\n.a\n{\n\tcolor: blue;\n}');
    expect(s.defineDefs.map((d) => d.name)).toEqual(['blue']);
    expect(s.defineRefs.map((d) => d.name)).toEqual(['blue']);
  });

  it('候选噪音是刻意的：没被 @define 过的标识符也留在 defineRefs 里，真正的判定推迟到索引层按名字反查（原「值里的属性关键字不被误当作引用」的断言与此冲突，已改写为新语义——反向索引里没人 @define 过 right，就没人会去查它，噪音自然被过滤，不要在抽取层把这条过滤加回来）', () => {
    const s = vcss('@define blue: #333;\n.a\n{\n\tflow-children: right;\n}');
    expect(s.defineRefs.map((d) => d.name)).toContain('right');
  });

  it('跨文件场景：本文件没有任何 @define，声明值里的标识符仍要留作候选（改之前这里是空的——常量定义在别的文件时，只看本文件 @define 表的过滤会把候选提前丢光，索引层再怎么合并各文件符号表也拿不回来）', () => {
    const s = vcss('.a\n{\n\tcolor: sharedBlue;\n}');
    expect(s.defineRefs.map((d) => d.name)).toEqual(['sharedBlue']);
  });

  it('引号包裹的片段不产生候选：url("blue.png") 里的 blue 不是标识符引用', () => {
    const s = vcss('.a\n{\n\tbackground-image: url("blue.png");\n}');
    expect(s.defineRefs.map((d) => d.name)).toEqual(['url']);
  });

  it('新增候选（含一条声明里出现多个标识符）的区间同样满足 slice(start, end) === name', () => {
    const text = '.a\n{\n\ttransition: sharedBlue linear, otherColor ease;\n}';
    const s = vcss(text);
    expect(s.defineRefs.map((d) => d.name)).toEqual(['sharedBlue', 'linear', 'otherColor', 'ease']);
    for (const d of s.defineRefs) {
      expect(text.slice(d.start, d.end), `${d.name} 区间错位`).toBe(d.name);
    }
  });

  it('@keyframes 定义与 animation-name 引用分开收集', () => {
    const text = "@keyframes 'fade'\n{\n\tfrom { opacity: 0; }\n}\n.a\n{\n\tanimation-name: 'fade';\n}";
    const s = vcss(text);
    expect(s.keyframeDefs.map((k) => k.name)).toEqual(['fade']);
    expect(s.keyframeRefs.map((k) => k.name)).toEqual(['fade']);
    // 名字带引号时 VcssKeyframes.nameStart/nameEnd 连引号一起框住；keyframeDefs
    // 的区间必须落在去引号后的裸名字上，否则 text.slice(start,end) 会切出
    // 'fade' 而不是 fade（真实语料里的 @keyframes 全部带引号，参见语料回归）
    expect(text.slice(s.keyframeDefs[0].start, s.keyframeDefs[0].end)).toBe('fade');
    expect(text.slice(s.keyframeRefs[0].start, s.keyframeRefs[0].end)).toBe('fade');
  });

  it('animation-name 可以是逗号分隔的多个动画名，每个各自成一条引用（真实语料 hudgameicons.css 的写法）', () => {
    const text =
      "@keyframes 'a'\n{\n\tfrom { opacity: 0; }\n}\n@keyframes 'b'\n{\n\tfrom { opacity: 0; }\n}\n" +
      '.x\n{\n\tanimation-name: a, b;\n}';
    const s = vcss(text);
    expect(s.keyframeRefs.map((k) => k.name)).toEqual(['a', 'b']);
    expect(text.slice(s.keyframeRefs[0].start, s.keyframeRefs[0].end)).toBe('a');
    expect(text.slice(s.keyframeRefs[1].start, s.keyframeRefs[1].end)).toBe('b');
  });

  it('@import 目标进 includes', () => {
    const s = vcss('@import url("s2r://panorama/styles/base.vcss_c");');
    expect(s.includes.map((r) => r.target)).toEqual(['s2r://panorama/styles/base.vcss_c']);
  });

  it('@keyframes 内层块的选择器（from/to）不被当作类名', () => {
    const s = vcss("@keyframes 'f'\n{\n\tfrom { opacity: 0; }\n\tto { opacity: 1; }\n}");
    expect(s.classDefs).toEqual([]);
  });
});

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE } from '../../../../tools/paths.mjs';

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (n.endsWith(ext)) out.push(p);
  }
  return out;
}

const LAYOUT = `${ARCHIVE}/20260829/panorama/layout`;
const STYLE = `${ARCHIVE}/20260829/panorama/styles`;

describe.skipIf(!existsSync(LAYOUT))('符号抽取 · 真实语料', () => {
  it('全部真实布局抽取不崩溃，且抽出大量类名引用与绑定', () => {
    let classRefs = 0;
    let bindings = 0;
    for (const f of walk(LAYOUT, '.xml')) {
      const s = symbolsOfVxml(f, parseVxml(readFileSync(f, 'utf8')));
      classRefs += s.classRefs.length;
      bindings += s.bindings.length;
    }
    expect(classRefs).toBeGreaterThan(1000);
    expect(bindings).toBeGreaterThan(100);
  });

  it('全部真实样式表抽取不崩溃，且抽出大量类名定义', () => {
    let classDefs = 0;
    let defineDefs = 0;
    for (const f of walk(STYLE, '.css')) {
      const s = symbolsOfVcss(f, parseVcss(readFileSync(f, 'utf8')));
      classDefs += s.classDefs.length;
      defineDefs += s.defineDefs.length;
    }
    expect(classDefs).toBeGreaterThan(1000);
    expect(defineDefs).toBeGreaterThan(100);
  });

  it('每一条符号的区间都真的索引到它自己的名字', () => {
    for (const f of walk(STYLE, '.css').slice(0, 30)) {
      const text = readFileSync(f, 'utf8');
      const s = symbolsOfVcss(f, parseVcss(text));
      // defineRefs 现在收的是候选（不再按同文件 @define 表过滤），数量比之前
      // 多得多——这正是这条不变式检查最该覆盖到的地方，一并加进来
      for (const d of [...s.classDefs, ...s.defineDefs, ...s.keyframeDefs, ...s.defineRefs]) {
        expect(text.slice(d.start, d.end), `${f} 的 ${d.name} 区间错位`).toBe(d.name);
      }
    }
  });
});
