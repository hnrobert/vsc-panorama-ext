export interface VcssDeclaration {
  readonly property: string;
  readonly propertyStart: number;
  readonly propertyEnd: number;
  readonly value: string;
  readonly valueStart: number;
  readonly valueEnd: number;
}

export interface VcssRule {
  readonly selector: string;
  readonly selectorStart: number;
  readonly selectorEnd: number;
  /** '{' 的位置 */
  readonly blockStart: number;
  /** '}' 的位置；未闭合为 -1 */
  blockEnd: number;
  readonly declarations: VcssDeclaration[];
  /** 嵌套块（@keyframes 内的 from / to / 百分比块） */
  readonly children: VcssRule[];
}

export interface VcssDefine {
  readonly name: string;
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly value: string;
  readonly valueStart: number;
  readonly valueEnd: number;
}

export interface VcssKeyframes {
  /** 去掉引号后的名字 */
  readonly name: string;
  /** 名字是否带引号——Panorama 要求带，不带是错的（M4 诊断用） */
  readonly quoted: boolean;
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly rule: VcssRule;
}

export interface VcssImport {
  readonly target: string;
  readonly targetStart: number;
  readonly targetEnd: number;
}

export interface VcssDocument {
  readonly defines: VcssDefine[];
  readonly imports: VcssImport[];
  readonly keyframes: VcssKeyframes[];
  /** 顶层规则；@keyframes 的内层块不在此列 */
  readonly rules: VcssRule[];
  readonly text: string;
}
