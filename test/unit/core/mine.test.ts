import { describe, it, expect } from 'vitest';
import { DECOMPILER_ARTIFACTS, mineValues } from '../../../src/core/data/mine';

describe('mineValues', () => {
  it('只收关键字型取值，忽略颜色、数字与 url', () => {
    const out = mineValues([
      '.a { flow-children: right; color: #fff; width: 10px; background-image: url("s2r://x"); }',
    ]);
    expect(out['flow-children'].map((v) => v.value)).toEqual(['right']);
    expect(out.color).toBeUndefined();
    expect(out.width).toBeUndefined();
    expect(out['background-image']).toBeUndefined();
  });

  it('按频次降序排列', () => {
    const out = mineValues([
      '.a { flow-children: down; }',
      '.b { flow-children: right; }',
      '.c { flow-children: right; }',
    ]);
    expect(out['flow-children'].map((v) => v.value)).toEqual(['right', 'down']);
    expect(out['flow-children'][0].count).toBe(2);
  });

  it('排除已知的反编译器产物', () => {
    // clip_then_cover 在 panorama.dll 里查无此字符串，是 Source 2 Viewer
    // 给某个枚举值起的标签，不是引擎关键字
    expect(DECOMPILER_ARTIFACTS).toContain('clip_then_cover');
    const out = mineValues(['.a { background-size: clip_then_cover; }']);
    expect(out['background-size']).toBeUndefined();
  });

  it('含函数调用的值不计入关键字', () => {
    const out = mineValues(['.a { width: fill-parent-flow(1); }']);
    expect(out.width).toBeUndefined();
  });

  it('多词取值整体忽略（只收单个裸标识符）', () => {
    const out = mineValues(['.a { overflow: squish scroll; }']);
    expect(out.overflow).toBeUndefined();
  });

  it('排除同文件内声明过的 @define 常量名', () => {
    // myDur 是 @define 名，不是引擎关键字；语法上与裸标识符不可区分，
    // 但只在声明它的文件里有效，原样推荐给用户会产出无法解析的代码
    const out = mineValues(['@define myDur: 0.3s;\n.a { animation-duration: myDur; }']);
    expect(out['animation-duration']).toBeUndefined();
  });

  it('@define 排除对跨文件同样生效（证明常量名是全语料收集的）', () => {
    const out = mineValues([
      '@define myDur: 0.3s;',
      '.a { animation-duration: myDur; }',
    ]);
    expect(out['animation-duration']).toBeUndefined();
  });

  it('不是 @define 名的真实关键字不受影响', () => {
    const out = mineValues(['@define myDur: 0.3s;\n.a { flow-children: right; }']);
    expect(out['flow-children'].map((v) => v.value)).toEqual(['right']);
  });
});
