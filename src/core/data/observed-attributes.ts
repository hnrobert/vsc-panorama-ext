import raw from '../../../data/vxml-observed-attributes.json';

export interface ObservedAttributeData {
  /** 标签 -> 出现次数；只含 `panels.json` 里查不到的标签 */
  readonly tags: Readonly<Record<string, number>>;
  /** 标签 -> 属性 -> 出现次数；只含「标签认识、但属性不在该面板 XSD 属性集里」的组合 */
  readonly attributes: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * 从语料挖掘的观测标签与属性（`tools/mine-vxml-attributes.mts` 生成）。
 * 与 `ObservedValues` 同性质：**弱可靠**——语料里出现过 != 引擎支持。
 *
 * **只用于压制，绝不用于产生**（规格 §5.3 写的是观测层「永远不作为诊断依据」，
 * 这里不违反它）：命中则静默放行，未命中则交回给上游规则按自己的判据处理。
 * 方向不同、风险不同——误压制的后果是漏一条 hint，误产生的后果是对着正确代码
 * 报错。凡是用这一层的地方都只能是「命中则静默」，不能有第二种用法。
 *
 * 存在理由（D-M4-1，用户拍板）：运行期 XSD 的属性集本身不完整——20260829 一个
 * 构建里就有 554 处合法属性不在集内（`Label@value` 一条就 337 次），另有 6 种
 * 标签不在 `panels.json` 里（D-M4-2）。
 *
 * **已知并接受的代价**：Valve 自己的笔误 `Frame@hitest`（少一个 t，4 次）被一并
 * 收录、从此不再提示。频次过滤区分不出它（真属性 `Label@teamnum` 也才 5 次），
 * 不要为此加阈值——加了只会误伤真实低频属性。
 */
export class ObservedAttributes {
  private readonly data: ObservedAttributeData;

  private constructor(data: ObservedAttributeData) {
    this.data = data;
  }

  static load(): ObservedAttributes {
    return new ObservedAttributes(raw as unknown as ObservedAttributeData);
  }

  /** 供测试注入自定义数据 */
  static from(data: ObservedAttributeData): ObservedAttributes {
    return new ObservedAttributes(data);
  }

  /**
   * 这个标签在真实布局里出现过（但 `panels.json` 里没有）。
   *
   * 必须用 `Object.hasOwn` 而不是 `tag in this.data.tags`：`'constructor'`、
   * `'toString'`、`'__proto__'` 这些名字都挂在 `Object.prototype` 上，`in`
   * 会顺着原型链判真，于是任何叫这些名字的标签都会被静默放行。
   */
  hasTag(tag: string): boolean {
    return Object.hasOwn(this.data.tags, tag);
  }

  /**
   * 这个 (面板, 属性) 组合在真实布局里出现过（但不在该面板的 XSD 属性集里）。
   *
   * 两层都要经 `Object.hasOwn`，一层都不能省：外层挡住 `has('constructor', …)`，
   * 内层挡住 `has('Panel', '__proto__')`——`'Panel'` 是 `attributes` 的真实 key，
   * 外层会放行，只有内层的守卫拦得住它。
   *
   * 按面板分域查，不是把全部属性名塌成一个扁平集合：`value` 在 `Label` 上观测到
   * 过、在 `Panel` 上没有，塌平之后「属性用错面板」这类真错误就会被一并压掉。
   */
  has(tag: string, attr: string): boolean {
    if (!Object.hasOwn(this.data.attributes, tag)) return false;
    return Object.hasOwn(this.data.attributes[tag], attr);
  }
}
