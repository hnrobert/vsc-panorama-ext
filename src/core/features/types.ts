export type CompletionKind =
  | 'panel'
  | 'structural'
  | 'attribute'
  | 'value'
  | 'property'
  | 'function'
  | 'pseudoClass'
  | 'atRule'
  | 'binding';

export interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail?: string;
  readonly documentation?: string;
  /** 排序键。挖掘来的弱可靠取值用更大的前缀排到后面 */
  readonly sortText?: string;
  readonly insertText?: string;
  /**
   * 显式替换区间（文档绝对偏移）。不给则由编辑器按语言 wordPattern 推导——
   * 那条路径依赖 wordPattern 恰好包含触发字符，脆弱且不可测。
   *
   * 不变式：**新增任何产出候选的分支，都必须给出显式区间。**
   *
   * 这条不变式在 Task 9 立下时只落到了当时改的那一支，没有随分支扩散，
   * 于是 '.'/'#' 选择器补全与 src= 路径补全两支各自漏掉，直到最终评审才
   * 暴露——两处都是「三层单元测试全绿、真实编辑器里 100% 不可用」：
   *
   * - 区间决定的不只是「替换掉哪一段」，还决定 VSCode 拿哪一段文本去
   *   过滤候选（区间起点到光标之间的文本就是过滤用的当前词）。区间缺席时
   *   这个词由 wordPattern 推导，而 VCSS 的 wordPattern 把前导 '.' / '#'
   *   算进当前词——裸名候选与 '.fo' 恒不匹配，整批被滤掉，用户什么都看不到。
   * - 区间与 label / insertText 必须配套：区间吃掉了触发字符（'.'、'#'、
   *   ':'、'{'），插入文本就得把它带回来；区间只覆盖当前路径段，插入文本
   *   就只能是当前段。三者中任一处单独改动都会插出错误结果。
   *
   * core 层与适配层的测试都直接调函数，够不到上面这段编辑器语义，只有
   * test/e2e 里真走 triggerSuggest + acceptSelectedSuggestion 的用例才测得到。
   * 新增分支时请一并在那里加用例。
   */
  readonly replaceStart?: number;
  readonly replaceEnd?: number;
  /**
   * 接受该候选后立刻再次触发补全。逐段路径补全用：接受一个目录段之后，
   * 下一段的候选才有意义，不重新触发的话用户得手动再按一次 Ctrl+Space。
   */
  readonly retriggerSuggest?: boolean;
}

export interface HoverInfo {
  readonly title: string;
  readonly body: string;
}

export interface SymbolInfo {
  readonly name: string;
  readonly kind: 'panel' | 'rule' | 'define' | 'keyframes';
  readonly detail?: string;
  readonly start: number;
  readonly end: number;
  readonly children: SymbolInfo[];
}
