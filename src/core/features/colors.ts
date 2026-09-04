import type { VcssDocument, VcssRule } from '../vcss/ast';

export interface ColorSpot {
  readonly start: number;
  readonly end: number;
  /** 各分量归一化到 0..1，与编辑器取色器的颜色表示一致 */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g;

function fromHex(hex: string): { r: number; g: number; b: number; a: number } {
  const h =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

/** 只扫「值」区间，所以 #Score 这类 id 选择器不会被误认为颜色 */
function scanValue(value: string, base: number, out: ColorSpot[]): void {
  HEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEX.exec(value)) !== null) {
    out.push({ start: base + m.index, end: base + m.index + m[0].length, ...fromHex(m[1]) });
  }

  RGB.lastIndex = 0;
  while ((m = RGB.exec(value)) !== null) {
    out.push({
      start: base + m.index,
      end: base + m.index + m[0].length,
      r: Number(m[1]) / 255,
      g: Number(m[2]) / 255,
      b: Number(m[3]) / 255,
      a: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
}

export function colorsOf(doc: VcssDocument): ColorSpot[] {
  const out: ColorSpot[] = [];

  for (const d of doc.defines) scanValue(d.value, d.valueStart, out);

  const all: VcssRule[] = [...doc.rules, ...doc.keyframes.map((k) => k.rule)];
  for (const rule of all) {
    for (const r of [rule, ...rule.children]) {
      for (const decl of r.declarations) {
        // 字符串里的 # 不是颜色
        if (/^["']/.test(decl.value.trim())) continue;
        scanValue(decl.value, decl.valueStart, out);
      }
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, '0');

export function formatColor(r: number, g: number, b: number, a: number): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a >= 1 ? base : `${base}${hex2(a)}`;
}
