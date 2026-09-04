import { describe, it, expect } from 'vitest';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import {
  vxmlDefinitionsAt,
  vxmlReferencesAt,
  vcssDefinitionsAt,
  vcssReferencesAt,
} from '../../../../src/core/features/navigation';

const LAYOUT = '/p/panorama/layout/a.xml';
const STYLE = '/p/panorama/styles/a.css';
const DIRS = ['/p/panorama/layout', '/p/panorama/styles'];

function fixture(layoutText: string, styleText: string) {
  const files = new Set([LAYOUT, STYLE, ...DIRS]);
  const env = { exists: (p: string) => files.has(p.replace(/\\/g, '/')) };
  const index = new WorkspaceIndex(env);
  index.update(symbolsOfVxml(LAYOUT, parseVxml(layoutText)));
  index.update(symbolsOfVcss(STYLE, parseVcss(styleText)));
  return { index, env };
}

describe('VXML 跳转定义', () => {
  const layout =
    '<root><styles><include src="s2r://panorama/styles/a.vcss_c" /></styles>' +
    '<Panel class="btn" /></root>';
  const style = '.btn\n{\n\twidth: 1px;\n}';

  it('class 名跳到 VCSS 里的规则', () => {
    const { index, env } = fixture(layout, style);
    const doc = parseVxml(layout);
    const offset = layout.indexOf('class="btn') + 'class="'.length + 1;
    const defs = vxmlDefinitionsAt(LAYOUT, doc, offset, index, env);
    expect(defs.map((d) => d.uri)).toEqual([STYLE]);
    expect(style.slice(defs[0].start, defs[0].end)).toBe('btn');
  });

  it('include 的 s2r 路径跳到目标文件（区间为文件开头）', () => {
    const { index, env } = fixture(layout, style);
    const doc = parseVxml(layout);
    const offset = layout.indexOf('s2r://') + 3;
    const defs = vxmlDefinitionsAt(LAYOUT, doc, offset, index, env);
    expect(defs).toEqual([{ uri: STYLE, name: STYLE, start: 0, end: 0 }]);
  });

  it('指向不存在资源的 s2r 不产生跳转目标', () => {
    const bad = '<root><styles><include src="s2r://panorama/styles/nope.vcss_c" /></styles><Panel /></root>';
    const { index, env } = fixture(bad, style);
    const doc = parseVxml(bad);
    const offset = bad.indexOf('s2r://') + 3;
    expect(vxmlDefinitionsAt(LAYOUT, doc, offset, index, env)).toEqual([]);
  });

  it('光标不在可跳转符号上返回空', () => {
    const { index, env } = fixture(layout, style);
    const doc = parseVxml(layout);
    expect(vxmlDefinitionsAt(LAYOUT, doc, 2, index, env)).toEqual([]);
  });

  // s.resources 是非 include 的 src=（Image 等）；此前整份文件没有一个用例
  // 用过它，只测过 s.includes 那半支。两支共用同一个 resourceDefinition()，
  // 但分支选择（el.tag === 'include' ? s.includes : s.resources）本身没人守。
  it('非 include 标签的 src=（如 Image）也能跳到目标文件', () => {
    const layout2 = '<root><Image src="s2r://panorama/images/icon.vtex_c" /></root>';
    const files = new Set([LAYOUT, '/p/panorama/images/icon.png', ...DIRS]);
    const env = { exists: (p: string) => files.has(p.replace(/\\/g, '/')) };
    const index = new WorkspaceIndex(env);
    index.update(symbolsOfVxml(LAYOUT, parseVxml(layout2)));
    const doc = parseVxml(layout2);
    const offset = layout2.indexOf('s2r://') + 3;
    expect(vxmlDefinitionsAt(LAYOUT, doc, offset, index, env)).toEqual([
      { uri: '/p/panorama/images/icon.png', name: '/p/panorama/images/icon.png', start: 0, end: 0 },
    ]);
  });
});

describe('VCSS 跳转定义', () => {
  it('@define 引用跳到定义处', () => {
    const style = '@define blue: #333;\n.a\n{\n\tcolor: blue;\n}';
    const { index, env } = fixture('<root><Panel /></root>', style);
    const doc = parseVcss(style);
    const offset = style.lastIndexOf('blue') + 1;
    const defs = vcssDefinitionsAt(STYLE, doc, offset, index, env);
    expect(defs).toHaveLength(1);
    expect(style.slice(defs[0].start, defs[0].end)).toBe('blue');
    expect(defs[0].start).toBe(style.indexOf('blue'));
  });

  it('@import 跳到目标文件', () => {
    const style = '@import url("s2r://panorama/styles/a.vcss_c");';
    const files = new Set([STYLE, ...DIRS]);
    const env = { exists: (p: string) => files.has(p.replace(/\\/g, '/')) };
    const index = new WorkspaceIndex(env);
    index.update(symbolsOfVcss(STYLE, parseVcss(style)));
    const doc = parseVcss(style);
    const offset = style.indexOf('s2r://') + 3;
    expect(vcssDefinitionsAt(STYLE, doc, offset, index, env)).toEqual([
      { uri: STYLE, name: STYLE, start: 0, end: 0 },
    ]);
  });

  // defineRefs 只是候选桶（Task 1 裁决）：animation-name 的值会同时落进 defineRefs
  // 与 keyframeRefs 两个候选桶（同一个偏移）。这里的名字只有 @keyframes 定义、
  // 没有 @define 定义——如果 vcssDefinitionsAt 的守卫（「索引里查得到定义才算数」）
  // 被删掉，defineDefinitions('foo') 查不到东西会让函数在这里就短路返回 []，
  // 永远走不到下面的 keyframeRefs 分支，@keyframes 定义就再也跳不过去了。
  it('animation-name 的值撞进 defineRefs 候选桶，但只有 @keyframes 定义时仍跳到 @keyframes（守卫回归）', () => {
    const style =
      '@keyframes foo\n{\n\tfrom { opacity: 0; }\n}\n.a\n{\n\tanimation-name: foo;\n}';
    const { index, env } = fixture('<root><Panel /></root>', style);
    const doc = parseVcss(style);
    const offset = style.lastIndexOf('foo') + 1; // animation-name: foo 的 foo 内部
    const defs = vcssDefinitionsAt(STYLE, doc, offset, index, env);
    expect(defs).toHaveLength(1);
    expect(style.slice(defs[0].start, defs[0].end)).toBe('foo');
    expect(defs[0].start).toBe(style.indexOf('foo')); // @keyframes 那个 foo，不是 animation-name 自身
  });

  // vcssDefinitionsAt 的 idRefs 分支（VCSS #id 选择器跳到 VXML id= 定义）此前
  // 零覆盖——整份文件没有一个用例写过 #id 选择器或 id= 属性。
  it('#id 引用跳到 VXML 里的 id= 定义', () => {
    const layout2 = '<root><Panel id="RootPanel" /></root>';
    const style = '#RootPanel\n{\n\twidth: 1px;\n}';
    const { index, env } = fixture(layout2, style);
    const doc = parseVcss(style);
    const offset = style.indexOf('RootPanel') + 1;
    const defs = vcssDefinitionsAt(STYLE, doc, offset, index, env);
    expect(defs).toHaveLength(1);
    expect(defs[0].uri).toBe(LAYOUT);
    expect(layout2.slice(defs[0].start, defs[0].end)).toBe('RootPanel');
  });
});

describe('查找引用', () => {
  const layout =
    '<root><Panel class="btn"><Label class="btn" /></Panel></root>';
  const style = '.btn\n{\n\twidth: 1px;\n}';

  it('从 VCSS 的类名定义查出 VXML 里的全部使用点，含定义本身', () => {
    const { index } = fixture(layout, style);
    const doc = parseVcss(style);
    const refs = vcssReferencesAt(STYLE, doc, 1, index);
    expect(refs.filter((r) => r.uri === LAYOUT)).toHaveLength(2);
    // 与下面 VXML 侧的对称用例保持一致：查找引用的结果必须含定义本身，
    // 不能只有使用点。之前这半句没人断言过。
    expect(refs.filter((r) => r.uri === STYLE)).toHaveLength(1);
  });

  it('从 VXML 的类名使用点查出全部使用点与定义', () => {
    const { index } = fixture(layout, style);
    const doc = parseVxml(layout);
    const offset = layout.indexOf('class="btn') + 'class="'.length + 1;
    const refs = vxmlReferencesAt(LAYOUT, doc, offset, index);
    expect(refs.filter((r) => r.uri === LAYOUT)).toHaveLength(2);
    expect(refs.filter((r) => r.uri === STYLE)).toHaveLength(1);
  });

  it('@define 的引用可查', () => {
    const style2 = '@define blue: #333;\n.a\n{\n\tcolor: blue;\n}\n.b\n{\n\tcolor: blue;\n}';
    const { index } = fixture('<root><Panel /></root>', style2);
    const doc = parseVcss(style2);
    const refs = vcssReferencesAt(STYLE, doc, style2.indexOf('blue') + 1, index);
    expect(refs).toHaveLength(3); // 1 定义 + 2 引用
  });

  // vxmlReferencesAt 的 idDefs 分支（从 VXML id= 使用点查定义+引用）此前零覆盖。
  it('从 VXML 的 id 使用点查出定义与 VCSS 里的引用', () => {
    const layout2 = '<root><Panel id="RootPanel" /></root>';
    const style2 = '#RootPanel\n{\n\twidth: 1px;\n}';
    const { index } = fixture(layout2, style2);
    const doc = parseVxml(layout2);
    const offset = layout2.indexOf('id="RootPanel') + 'id="'.length + 1;
    const refs = vxmlReferencesAt(LAYOUT, doc, offset, index);
    expect(refs.filter((r) => r.uri === LAYOUT)).toHaveLength(1); // idDefinitions：定义本身
    expect(refs.filter((r) => r.uri === STYLE)).toHaveLength(1); // idReferences：VCSS 的 #RootPanel
  });

  // vcssReferencesAt 的 keyframe 分支（keyframeDefs ?? keyframeRefs）此前零覆盖——
  // 整份文件没有一个用例在 @keyframes 上调用过 vcssReferencesAt。
  it('@keyframes 的定义与全部 animation-name 引用可查', () => {
    const style2 =
      '@keyframes fade\n{\n\tfrom { opacity: 0; }\n}\n.a\n{\n\tanimation-name: fade;\n}\n.b\n{\n\tanimation-name: fade;\n}';
    const { index } = fixture('<root><Panel /></root>', style2);
    const doc = parseVcss(style2);
    const refs = vcssReferencesAt(STYLE, doc, style2.indexOf('fade') + 1, index);
    expect(refs).toHaveLength(3); // 1 定义 + 2 引用
  });
});
