import type { VcssDocument } from '../vcss/ast';
import type { VxmlDocument } from '../vxml/ast';
import type { PropertyRegistry } from '../data/properties';
import type { PanelRegistry } from '../data/panels';
import type { ObservedAttributes } from '../data/observed-attributes';
import type { LayoutMode } from '../mode';
import type { WorkspaceIndex } from '../index/workspace-index';
import type { Diagnostic, DiagnosticSettings } from './types';
import type { Messages } from '../i18n/types';
import { RULE_GROUP } from './types';
import {
  checkVcssWarnings,
  checkVcssCrossFileWarnings,
  checkVcssHints,
  checkVcssCrossFileHints,
} from './vcss';
import {
  checkVxmlCrossFileWarnings,
  checkVxmlStructure,
  checkVxmlTagsAndAttributes,
} from './vxml';
import { checkCustomHudWhitelist } from './custom-hud';

/**
 * `index` 是可选的：没有工作区索引时，跨文件规则（vcss.unknownDefine /
 * vcss.unknownKeyframes）整体跳过，不是报错——「引用的常量/关键帧找不到
 * 定义」这个判断在没有索引时根本不成立（单文件视野下什么都可能在别处被
 * 定义）。Task 5 之后不再变形状。
 */
export interface VcssDiagCtx {
  readonly uri: string;
  readonly props: PropertyRegistry;
  readonly index?: WorkspaceIndex;
  /**
   * 消息目录。**必填**，与 props / panels / observed 同理——理由见 VxmlDiagCtx
   * 上面那段注释，但这里的后果更重：可选或带默认值的话，某个调用点漏接线的
   * 表现是「英文用户静默收到中文」。诊断照常出现、条数照常正确、990 文件语料
   * 闸门照常全绿，只有真实用户看得见。必填则漏接线在 tsc 阶段就报错。
   */
  readonly msg: Messages;
}

/**
 * `index` 同上：没有索引时 vxml.unknownClass 整体跳过。
 *
 * `panels` / `observed` 则是**必填**，与 VcssDiagCtx 的 `props` 同理：
 * vxml.unknownTag / vxml.unknownAttribute 是单文件判据，没有「判断的前提不
 * 成立」这种情形，缺数据只可能是接线漏了。做成可选会让漏接线的后果变成
 * 「规则静默不生效」——一条 warning 级规则就这么消失了，而且所有测试照常
 * 全绿。必填则漏接线在 tsc 阶段就报错。
 */
export interface VxmlDiagCtx {
  readonly uri: string;
  readonly mode: LayoutMode;
  readonly panels: PanelRegistry;
  readonly observed: ObservedAttributes;
  readonly index?: WorkspaceIndex;
  /**
   * 消息目录。**必填**，与 props / panels / observed 同理——理由见 VxmlDiagCtx
   * 上面那段注释，但这里的后果更重：可选或带默认值的话，某个调用点漏接线的
   * 表现是「英文用户静默收到中文」。诊断照常出现、条数照常正确、990 文件语料
   * 闸门照常全绿，只有真实用户看得见。必填则漏接线在 tsc 阶段就报错。
   */
  readonly msg: Messages;
}

/**
 * 按配置组过滤与改级。规则产出时带自己的默认级别，这里统一覆盖：
 * 组设为 off 则整组消失，否则组的取值就是最终级别。
 */
export function applySettings(
  items: readonly Diagnostic[],
  settings: DiagnosticSettings,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of items) {
    const level = settings[RULE_GROUP[d.ruleId]];
    if (level === 'off') continue;
    out.push(d.severity === level ? d : { ...d, severity: level });
  }
  return out;
}

// 规则族从 Task 3 起逐个接进来。
//
// 规格 §10.1 的 9 条 VCSS warning（webOnlyProperty ... clipThenCover）已接入
// （Task 3）。跨文件的两条（unknownDefine / unknownKeyframes）已接入
// （Task 4）：只有 ctx.index 存在时才跑，没有索引时「找不到定义」这个判断
// 根本不成立，规则整体跳过而不是报错。
//
// 规格 §10.2 的两条 VCSS hint（unknownProperty / unknownValue）已接入
// （Task 5）：前者不依赖索引，后者依赖——它的「取值是不是工作区里某个
// @define 的名字」这层豁免没有索引就不成立，语料实测会多出 72 处误报，
// 因此与 §10.1 的两条跨文件规则一样，没有索引时整条跳过。
//
// 本任务先不接用户配置：这里直接返回规则族的原始输出（每条诊断自带自己的
// 默认 severity），不调用 applySettings。配置读取与 applySettings 编排留给
// Task 10——届时 ctx 或调用方会带上 DiagnosticSettings。
export function diagnoseVcss(doc: VcssDocument, ctx: VcssDiagCtx): Diagnostic[] {
  const base = [
    ...checkVcssWarnings(doc, ctx.props, ctx.msg),
    ...checkVcssHints(doc, ctx.props, ctx.msg),
  ];
  if (!ctx.index) return base;
  return [
    ...base,
    ...checkVcssCrossFileWarnings(doc, ctx.props, ctx.index, ctx.msg),
    ...checkVcssCrossFileHints(doc, ctx.props, ctx.index, ctx.msg),
  ];
}

// vxml.unknownClass（Task 4，跨文件，默认 hint）已接入：同样只有 ctx.index
// 存在时才跑。ctx.mode 留给 Task 9（CustomHudLayout 白名单规则）使用。
//
// vxml.unknownTag（§10.1，warning）与 vxml.unknownAttribute（§10.2，hint）已接入
// （Task 7）：它们是**单文件判据**，与 ctx.index 无关，因此无条件跑——放进
// ctx.index 的分支里会让索引关闭（panorama.index.enabled = false）或索引尚未建好
// 时这两条静默消失。
//
// §10.1 的四条结构 warning（vxml.structure / vxml.rootOnlyNested /
// vxml.rootPanelId / vxml.syntax）与 §10.2 的 vxml.duplicateId（hint）已接入
// （Task 8）：同样是单文件判据，同样无条件跑。它们排在标签/属性两条**前面**，
// 因为在同一处重叠时更靠前的那条更具体（例如 `class=裸值` 会先出一条
// vxml.syntax，随后解析器把裸值当成属性名读掉，才有那条 unknownAttribute）。
//
// §10.3 的七条 CustomHudLayout 白名单 error（Task 9）挂在最后：只有
// ctx.mode === 'customHudLayout' 时才跑，且**只在这里**跑——`diagnoseVcss` 一侧
// 连 mode 都不收，规格 §6.2「CustomHudLayout 对样式没有任何限制」因此是结构上
// 成立的，不是靠一个 if 判掉的。
export function diagnoseVxml(doc: VxmlDocument, ctx: VxmlDiagCtx): Diagnostic[] {
  const base = [
    ...checkVxmlStructure(doc, ctx.panels, ctx.msg),
    ...checkVxmlTagsAndAttributes(doc, ctx.panels, ctx.observed, ctx.msg),
  ];
  const generic = ctx.index ? [...base, ...checkVxmlCrossFileWarnings(doc, ctx.index, ctx.msg)] : base;
  if (ctx.mode !== 'customHudLayout') return generic;

  const hud = checkCustomHudWhitelist(doc, ctx.msg);
  return [...hud, ...dropNonHudOverlaps(generic, hud)];
}

/**
 * 规格 §10.3 末段的去重：**同一处只报一条，§10.3 优先**。
 *
 * 判据是**区间重叠**（半开区间 `[start, end)`，相邻不算重叠）：某条非 `hud.*` 的
 * 区间与任何一条 `hud.*` 重叠时，删掉非 `hud.*` 那条。保留 §10.3 是因为它的提示
 * 更具体、更贴合用户当下在做的事——「文字请用子 <Label>」比「Button 不支持 text
 * 属性」有用。
 *
 * 已确认的两处真实重叠（`dedup.test.ts` 各钉一条，且都先证明「不去重时确实是
 * 两条」）：
 *
 * 1. `<Button text="…">` —— XSD 里 `ButtonType` 确实没有 `text`（只有
 *    `TextButtonType` 有），所以 `vxml.unknownAttribute` 命中同一个属性名区间；
 * 2. 43 种 `rootOnly` 类型出现在嵌套位置 —— `vxml.rootOnlyNested` 与
 *    `hud.panelNotAllowed` 都落在标签名上。
 *
 * **`style` 不在重叠之列**：它在 XSD 里是合法的 `Panel` 属性，`vxml.
 * unknownAttribute` 根本不命中，只由 `hud.inlineStyle` 报出。这处**非**重叠同样
 * 钉在测试里——否则去重写宽了（例如「只要有 hud.* 就把非 hud.* 全删掉」）也发现
 * 不了：最终结果照样是「只剩一条 hud.inlineStyle」。
 *
 * 严格模式下 §10.1 / §10.2 **继续生效**（根面板 `id`、未闭合标签、结构顺序都是
 * 通用规则），所以这里删的只能是真正重叠的那些，不能整组丢掉。
 *
 * **前提：`items` 里不含 `hud.*`。** 唯一的调用点传的是
 * `checkVxmlStructure` / `checkVxmlTagsAndAttributes` / `checkVxmlCrossFileWarnings`
 * 拼成的数组，这个前提在结构上成立。交付时这里另有一支
 * `d.ruleId.startsWith('hud.') ||` 作「防御」，评审 M-1 实测它在生产路径上不可达
 * （删掉后 222/222 全绿），而且**有害**：它让「两个参数写反」这种坏法退化成恒等
 * 函数，把一个真实的接线错误藏了起来。已删。同时删掉的还有
 * `if (hud.length === 0) return [...items];` 那句早返回——它只是个微优化（空数组
 * 上的 `some` 本来就恒假），却让 `dedup.test.ts` 里那条自称覆盖 filter 的用例
 * 根本走不进 filter。两处都是「注释宣称了它没做到的事」，一并收掉。
 *
 * 导出是为了让 `dedup.test.ts` 能直接钉区间语义的边界（相邻不算重叠、方向不能
 * 反、items 内部不互删）——这几种边界真实文档产不出来。
 */
export function dropNonHudOverlaps(
  items: readonly Diagnostic[],
  hud: readonly Diagnostic[],
): Diagnostic[] {
  return items.filter((d) => !hud.some((h) => d.start < h.end && h.start < d.end));
}
