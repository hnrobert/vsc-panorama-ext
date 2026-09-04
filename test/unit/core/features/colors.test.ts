import { describe, it, expect } from 'vitest';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { colorsOf, formatColor } from '../../../../src/core/features/colors';

const spots = (text: string) => colorsOf(parseVcss(text));

describe('colorsOf', () => {
  it('识别六位十六进制颜色', () => {
    const text = '.a\n{\n\tcolor: #3281AC;\n}';
    const [c] = spots(text);
    expect(text.slice(c.start, c.end)).toBe('#3281AC');
    expect([c.r, c.g, c.b, c.a]).toEqual([0x32 / 255, 0x81 / 255, 0xac / 255, 1]);
  });

  it('识别八位十六进制颜色 —— Panorama 的 alpha 写法，标准 CSS 取色器不认', () => {
    const [c] = spots('.a\n{\n\twash-color: #39b0d325;\n}');
    expect(c.a).toBeCloseTo(0x25 / 255, 5);
  });

  it('识别三位缩写', () => {
    const [c] = spots('.a\n{\n\tcolor: #fff;\n}');
    expect([c.r, c.g, c.b]).toEqual([1, 1, 1]);
  });

  it('识别 rgb() 与 rgba()', () => {
    const [rgb] = spots('.a\n{\n\tcolor: rgb(150, 200, 250);\n}');
    expect([rgb.r, rgb.g, rgb.b, rgb.a]).toEqual([150 / 255, 200 / 255, 250 / 255, 1]);
    const [rgba] = spots('.a\n{\n\tcolor: rgba(1, 29, 54, 0.5);\n}');
    expect(rgba.a).toBe(0.5);
  });

  it('@define 的值里的颜色同样识别', () => {
    const text = '@define blue: #3281AC;';
    const [c] = spots(text);
    expect(text.slice(c.start, c.end)).toBe('#3281AC');
  });

  it('一条声明里的多个颜色都识别（如渐变）', () => {
    const text = '.a\n{\n\tbackground-color: gradient( linear, 0% 0%, 0% 100%, from(#14202b), to(#1e2d3d) );\n}';
    expect(spots(text)).toHaveLength(2);
  });

  it('字符串里即使是真颜色写法也不误报（引号守卫）', () => {
    // "#notacolor" 本身就不匹配十六进制正则的首字符，删掉 colors.ts 的引号
    // 守卫这条测试也会照样绿——空转。换成引号里包着真颜色串 #3281AC，
    // 只有引号守卫真的在场时才排除得掉，删掉守卫必须变红。
    expect(spots('.a\n{\n\tsound: "#3281AC";\n}')).toEqual([]);
  });

  it('不把十六进制形状的 id 选择器当颜色', () => {
    // #Score 里的 S/c/o/r 本来就不是合法十六进制字符，就算 colorsOf 真去扫
    // selector 也认不出来——空转。换成 #Abcdef（六个合法十六进制字符），
    // 只有当 colorsOf 结构上确实不扫选择器时这条才会绿。
    expect(spots('#Abcdef\n{\n\twidth: 1px;\n}')).toEqual([]);
  });
});

describe('formatColor', () => {
  it('alpha 为 1 时输出六位', () => {
    expect(formatColor(0x32 / 255, 0x81 / 255, 0xac / 255, 1)).toBe('#3281ac');
  });

  it('alpha 不为 1 时输出八位', () => {
    expect(formatColor(1, 1, 1, 0x25 / 255)).toBe('#ffffff25');
  });

  it('取色器给的浮点值被正确取整', () => {
    expect(formatColor(0.5, 0.5, 0.5, 1)).toBe('#808080');
  });
});
