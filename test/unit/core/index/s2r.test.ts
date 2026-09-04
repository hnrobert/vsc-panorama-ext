import { describe, it, expect } from 'vitest';
import {
  contentRootCandidates,
  resolveS2r,
  sourceCandidatesFor,
} from '../../../../src/core/index/s2r';

/** 用一组虚拟路径构造 exists 谓词，避免测试依赖真实磁盘 */
const envOf = (paths: string[], contentRoots?: string[]) => ({
  exists: (p: string) => paths.includes(p.replace(/\\/g, '/')),
  contentRoots,
});

describe('sourceCandidatesFor', () => {
  it('编译产物后缀映射回源文件后缀，带回退顺序', () => {
    expect(sourceCandidatesFor('/a/x.vcss_c')).toEqual(['/a/x.css', '/a/x.vcss']);
    expect(sourceCandidatesFor('/a/x.vxml_c')).toEqual(['/a/x.xml', '/a/x.vxml']);
    expect(sourceCandidatesFor('/a/x.vsvg')).toEqual(['/a/x.svg']);
    expect(sourceCandidatesFor('/a/x.vtex_c')).toEqual(['/a/x.png']);
  });

  it('无法识别的后缀原样返回', () => {
    expect(sourceCandidatesFor('/a/x.txt')).toEqual(['/a/x.txt']);
  });
});

describe('contentRootCandidates', () => {
  it('显式 contentRoots 排在最前', () => {
    const env = envOf([], ['/explicit']);
    const c = contentRootCandidates('/w/panorama/layout/a.xml', env);
    expect(c[0]).toMatchObject({ kind: 'explicit', root: '/explicit' });
  });

  it('候选 B（同时含 layout/ 与 styles/ 的祖先）会被识别，且剥掉 panorama 前缀', () => {
    const env = envOf(['/w/pack/layout', '/w/pack/styles']);
    const c = contentRootCandidates('/w/pack/layout/hud/a.xml', env);
    const b = c.find((x) => x.kind === 'B');
    expect(b).toMatchObject({ root: '/w/pack', stripPanoramaPrefix: true });
  });

  it('候选 A（文件相对该目录以 panorama/ 开头）会被识别，且保留前缀', () => {
    const env = envOf([]);
    const c = contentRootCandidates('/w/addon/panorama/layout/a.xml', env);
    const a = c.find((x) => x.kind === 'A');
    expect(a).toMatchObject({ root: '/w/addon', stripPanoramaPrefix: false });
  });

  it('候选按距离近到远排序', () => {
    const env = envOf(['/w/a/panorama/layout', '/w/a/panorama/styles']);
    const c = contentRootCandidates('/w/a/panorama/layout/hud/x.xml', env);
    for (let i = 1; i < c.length; i++) {
      expect(c[i].distance).toBeGreaterThanOrEqual(c[i - 1].distance);
    }
  });
});

describe('resolveS2r · 四种真实形态', () => {
  it('20260829 形态：多包一层 panorama', () => {
    const files = [
      '/V/20260829/panorama/layout',
      '/V/20260829/panorama/styles',
      '/V/20260829/panorama/styles/csgostyles.css',
    ];
    const got = resolveS2r(
      '/V/20260829/panorama/layout/hud/hud.xml',
      'panorama/styles/csgostyles.vcss_c',
      envOf(files),
    );
    expect(got).toBe('/V/20260829/panorama/styles/csgostyles.css');
  });

  it('20260716 形态：祖先目录重名 panorama —— 这条只靠优先级排不掉，必须验存在性', () => {
    // 关键：/V/panorama 存在（是归档目录名），会让候选 A 在此「成功」，
    // 但 /V/panorama/styles/csgostyles.css 并不存在。
    const files = [
      '/V/panorama/20260716/layout',
      '/V/panorama/20260716/styles',
      '/V/panorama/20260716/styles/csgostyles.css',
    ];
    const got = resolveS2r(
      '/V/panorama/20260716/styles/hud/hud.css',
      'panorama/styles/csgostyles.vcss_c',
      envOf(files),
    );
    expect(got).toBe('/V/panorama/20260716/styles/csgostyles.css');
  });

  it('生产 addon 形态', () => {
    const files = [
      '/addon/panorama/layout',
      '/addon/panorama/styles',
      '/addon/panorama/styles/custom_game/kxnrl/shared/global.css',
    ];
    const got = resolveS2r(
      '/addon/panorama/layout/custom_game/kxnrl/notification/main.xml',
      'panorama/styles/custom_game/kxnrl/shared/global.vcss_c',
      envOf(files),
    );
    expect(got).toBe('/addon/panorama/styles/custom_game/kxnrl/shared/global.css');
  });

  it('引用不存在的资源返回 undefined —— M4 可据此报诊断', () => {
    const files = ['/addon/panorama/layout', '/addon/panorama/styles'];
    const got = resolveS2r(
      '/addon/panorama/layout/a.xml',
      'panorama/styles/nope.vcss_c',
      envOf(files),
    );
    expect(got).toBeUndefined();
  });

  it('.vcss 回退：源文件用新后缀时也能解析', () => {
    const files = ['/p/layout', '/p/styles', '/p/styles/x.vcss'];
    expect(resolveS2r('/p/layout/a.xml', 'panorama/styles/x.vcss_c', envOf(files))).toBe(
      '/p/styles/x.vcss',
    );
  });

  it('显式 contentRoots 优先于自动探测', () => {
    const files = ['/p/layout', '/p/styles', '/p/styles/x.css', '/forced/panorama/styles/x.css'];
    expect(
      resolveS2r('/p/layout/a.xml', 'panorama/styles/x.vcss_c', envOf(files, ['/forced'])),
    ).toBe('/forced/panorama/styles/x.css');
  });

  it('非 s2r:// 前缀的路径原样不解析', () => {
    expect(resolveS2r('/p/layout/a.xml', 'file:///x.css', envOf([]))).toBeUndefined();
  });
});

import { existsSync } from 'node:fs';
import { ARCHIVE } from '../../../../tools/paths.mjs';

const realEnv = { exists: (p: string) => existsSync(p) };

describe.skipIf(!existsSync(ARCHIVE))('resolveS2r · 真实磁盘', () => {
  it('20260829 形态解析到真实存在的文件', () => {
    const got = resolveS2r(
      `${ARCHIVE}/20260829/panorama/styles/hud/hud.css`,
      'panorama/styles/csgostyles.vcss_c',
      realEnv,
    );
    expect(got).toBe(`${ARCHIVE}/20260829/panorama/styles/csgostyles.css`);
    expect(existsSync(got!)).toBe(true);
  });

  it('20260716 形态解析到真实存在的文件（祖先重名陷阱）', () => {
    const got = resolveS2r(
      `${ARCHIVE}/20260716/styles/hud/hud.css`,
      'panorama/styles/csgostyles.vcss_c',
      realEnv,
    );
    expect(got).toBe(`${ARCHIVE}/20260716/styles/csgostyles.css`);
    expect(existsSync(got!)).toBe(true);
  });
});
