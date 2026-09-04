import raw from '../../../data/vcss-observed-values.json';

interface ObservedData {
  readonly values: Readonly<Record<string, ReadonlyArray<{ value: string; count: number }>>>;
}

const EMPTY: readonly string[] = Object.freeze([]);

/**
 * 从语料挖掘的候选取值。**弱可靠**：只用于补全建议，排序权重低于人工整理的值，
 * 永远不作为诊断依据（规格 §5.3）。
 */
export class ObservedValues {
  private readonly data: ObservedData;

  private constructor(data: ObservedData) {
    this.data = data;
  }

  static load(): ObservedValues {
    return new ObservedValues(raw as unknown as ObservedData);
  }

  /**
   * 按频次降序的候选值。
   * 先用 Object.hasOwn 挡一道——不存在的 key 直接 [] 索引会顺着原型链
   * 拿到 Object.prototype 上的同名成员（如 'constructor'），那不是数组，
   * 对它 .map 会抛异常。
   */
  valuesOf(property: string): readonly string[] {
    return Object.hasOwn(this.data.values, property)
      ? this.data.values[property].map((v) => v.value)
      : EMPTY;
  }
}
