export interface VxmlAttribute {
  readonly name: string;
  readonly nameStart: number;
  readonly nameEnd: number;
  /** 属性值（不含引号）；只写了 `name=` 尚未写值时为 undefined */
  readonly value?: string;
  readonly valueStart?: number;
  readonly valueEnd?: number;
  /** 引号未闭合（编辑中途） */
  readonly unterminated: boolean;
}

export interface VxmlElement {
  readonly tag: string;
  /** '<' 的位置 */
  readonly tagStart: number;
  readonly tagNameStart: number;
  readonly tagNameEnd: number;
  /** 开始标签 '>' 之后的位置；开始标签未闭合时为 -1 */
  openEnd: number;
  /** 元素结束位置；未闭合时为文档末尾 */
  end: number;
  selfClosing: boolean;
  /** 开始标签缺 '>'（编辑中途） */
  readonly unclosed: boolean;
  readonly attributes: VxmlAttribute[];
  readonly children: VxmlElement[];
  parent?: VxmlElement;
}

export interface VxmlDocument {
  readonly roots: VxmlElement[];
  readonly text: string;
}
