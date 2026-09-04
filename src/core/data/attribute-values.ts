import raw from '../../../data/vxml-attribute-values.json';
import { PanelRegistry } from './panels';

interface AttributeValueData {
  readonly byPanel: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly byPanelEvidence: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly anyPanel: Readonly<Record<string, readonly string[]>>;
  readonly anyPanelEvidence: Readonly<Record<string, string>>;
}

const data = raw as unknown as AttributeValueData;
const EMPTY: readonly string[] = Object.freeze([]);

// 只用来查 declarerOf——复用已经过测试的「属性由哪个集合声明」逻辑，不重新
// 加载整份 panels.json 自己再实现一遍。这是 attribute-values.ts 自己的实例，
// 与调用方（如 vxml.ts）注入的 PanelRegistry 是两个独立对象，但都读同一份
// 已在模块加载时解析好的 panels.json（ES 模块导入天然只解析一次），
// 不存在数据不一致的问题。
//
// locale 传 en 是任意的、且**无关紧要**：这个实例只调 declarerOf（已核实，
// 全文件仅第 60 行一处调用），从不读 attributeDocs——而 locale 只影响
// attributeDocs 的解析。给它接一个真实 locale 反而会把 core 的这个纯结构
// 查询和「用户界面语言」绑在一起，语义上是错的。
const panels = PanelRegistry.load('en');

/** byPanel[tag][attr]，两层都经 Object.hasOwn 防原型链；查不到给 undefined 而非 [] ——调用方靠这个区分「查不到，继续试下一种途径」与「查到了但是空」 */
function valuesFromByPanel(tag: string, attr: string): readonly string[] | undefined {
  // 直接用 [] 索引不存在的 key 会顺着原型链拿到 Object.prototype 上的同名成员
  // （如 'constructor' / '__proto__'）——那些不是 string[]，被当数据用（比如
  // 调用方 .map 遍历）会抛异常。两层都要经 Object.hasOwn 先挡一道，不能省。
  const perPanel = Object.hasOwn(data.byPanel, tag) ? data.byPanel[tag] : undefined;
  if (perPanel && Object.hasOwn(perPanel, attr)) return perPanel[attr];
  return undefined;
}

/**
 * 属性的固定取值（补全用）。运行时 XSD 的 xs:enumeration 数量为 0——不只是没有
 * 枚举，全部属性一律声明成 type="xs:string"，取值域信息一个都不提供，所以这份
 * 数据与 vcss-properties.json 同性质：人工从文档 + 真实语料核对整理，需手工
 * 维护，不是从任何机器可读来源生成的（详见 data/vxml-attribute-values.json 的
 * source/byPanelEvidence/anyPanelEvidence 字段——后两者逐条区分了哪些值有语料
 * 或文档实证、哪些是按同类属性的惯例推断出来的，证据强度不一样）。
 *
 * 查找顺序：
 * 1. byPanel[tag][attr] —— 字面标签精确匹配，最具体。
 * 2. 字面标签查不到时，顺着 panels.json 记录的属性集共享关系回退一次：
 *    PanelRegistry.declarerOf(tag, attr) 算出真正声明这个属性的那个集合名
 *    （比如 AnimatedImageStrip/ItemImage 的 scaling 都是 "Image" 这个集合
 *    声明的，AnimatedImageStrip.sets 与 ItemImage.sets 里都显式列着
 *    "Image"——不是两份属性列表恰好长得一样，是同一个集合被多个面板引用）。
 *    这个集合名在 panels.json 里恰好也是声明它的那个面板自己的标签
 *    （已核实：全部 78 个属性集名字都能在 panels 表里查到同名面板，不是巧
 *    合而是生成器的既有约定）——如果这个名字本身也是 byPanel 的 key，就
 *    用它的数据再查一次。这一步不产出任何新字符串，只是多查一跳已经存在
 *    的数据，用 declarerOf 精确定位「哪个集合声明了这个属性」，不是「随便
 *    看这个 tag 有没有其它数据就照抄」——回退必须锚定在 attr 本身真的由
 *    这个集合声明这件事上，否则会把一个面板毫不相干的其它属性的取值错误
 *    地安到另一个属性头上。
 * 3. anyPanel[attr] —— 与面板无关的通用取值（如各类布尔属性），兜底。
 */
export function attributeValuesFor(tag: string, attr: string): readonly string[] {
  const direct = valuesFromByPanel(tag, attr);
  if (direct) return direct;

  const declarer = panels.declarerOf(tag, attr);
  if (declarer) {
    const shared = valuesFromByPanel(declarer, attr);
    if (shared) return shared;
  }

  if (Object.hasOwn(data.anyPanel, attr)) return data.anyPanel[attr];
  return EMPTY;
}
