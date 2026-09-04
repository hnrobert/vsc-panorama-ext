import { describe, it, expect, beforeAll } from 'vitest';
import { ZH, EN } from '../../../helpers/i18n';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE } from '../../../../tools/paths.mjs';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { diagnoseVxml, diagnoseVcss } from '../../../../src/core/diagnostics';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import rawObserved from '../../../../data/vxml-observed-attributes.json';
import type { VxmlElement } from '../../../../src/core/vxml/ast';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { ALL_RULE_IDS, type RuleId } from '../../../../src/core/diagnostics/types';
import { layoutModeFor } from '../../../../src/core/mode';

const props = PropertyRegistry.load('zh-cn');
// Task 7 起 VxmlDiagCtx 必填这两项（vxml.unknownTag / vxml.unknownAttribute 的数据源）。
// 与下面那条数据不变量里的 panels / observed 是同两份出货数据，只是作用域不同。
const gatePanels = PanelRegistry.load('zh-cn');
const gateObserved = ObservedAttributes.load();

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (n.endsWith(ext)) out.push(p);
  }
  return out;
}

/**
 * 为整个语料建一份共享的 WorkspaceIndex（两个构建、990 个文件合并进同一份
 * 索引——`defineDefinitions` / `keyframeDefinitions` / `classDefinitions`
 * 是按名字查找的全局反向索引，不按 `<include>` 可达性做过滤，因此「常量/
 * 关键帧/类名定义在哪个文件」与「哪个文件引用了它」是否存在显式 include
 * 关系并不影响查询结果——这与 T3 章节 M3 的 vcssDefinitionsAt /
 * vcssReferencesAt 用的是同一种全局按名解析，见 src/core/features/
 * navigation.ts）。M3 实测全量索引 990 文件约 290ms，可接受。
 *
 * WorkspaceIndex 的构造函数需要一个 S2rEnv；这三条跨文件规则只做按名字的
 * 反向查找（defineDefinitions / keyframeDefinitions / classDefinitions），
 * 不调用 includedStylesheets()，因此不需要真正可用的 s2r 解析——`exists`
 * 仍然接到真实的 node:fs existsSync，图的是诚实（不用占位谓词），不是
 * 因为这三条规则真的会走到 s2r 解析那条路径。
 */
function buildWorkspaceIndex(xmlFiles: readonly string[], cssFiles: readonly string[]): WorkspaceIndex {
  const index = new WorkspaceIndex({ exists: existsSync });
  for (const f of xmlFiles) {
    index.update(symbolsOfVxml(f, parseVxml(readFileSync(f, 'utf8'))));
  }
  for (const f of cssFiles) {
    index.update(symbolsOfVcss(f, parseVcss(readFileSync(f, 'utf8'))));
  }
  return index;
}

const BUILDS = ['20260829', '20260716'];

/**
 * 两个构建的目录形态不一样：`20260829` 在 `layout/`、`styles/` 外还包一层
 * `panorama/`，`20260716` 没有这层包装，`layout/`、`styles/` 直接在构建目录
 * 下——这正是 `src/core/index/s2r.ts`（`contentRootCandidates` 的 doc 注释）
 * 与 `src/vscode/index-host.ts` 反复处理过的「20260716 形态」。
 *
 * brief 原文和计划文档把两个构建都硬编码成 `${ARCHIVE}/${b}/panorama`：这条
 * 路径拼接对 20260829 成立，对 20260716 在本机归档上并不存在，会让
 * `ready` 判假、整条语料闸门被 `describe.skipIf` 静默跳过——跳过的闸门等于
 * 没有闸门，与本任务的验收目标直接冲突，故在此按存在性逐构建探测内容根，
 * 不再假设两个构建同形。
 */
function contentRootOf(build: string): string {
  const nested = `${ARCHIVE}/${build}/panorama`;
  return existsSync(`${nested}/layout`) && existsSync(`${nested}/styles`)
    ? nested
    : `${ARCHIVE}/${build}`;
}

const ROOTS = BUILDS.map(contentRootOf);
const ready = ROOTS.every((r) => existsSync(`${r}/layout`) && existsSync(`${r}/styles`));

/**
 * 每条规则在真实语料上的期望命中数。规格 §10 的验收线原写「零 warning」，
 * 但语料本身是反编译产物，`background-size: clip_then_cover` 这条必然命中
 * ——规格自己就说它是反编译器产物。故改为钉死精确数字（D-M4-3）：
 * 数量变化即变红，比整条豁免更能守住「规则不误报」这个性质。
 *
 * 规则落地时在这里填自己的数字，并在下面的 PINNED 里钉死非零项的位置。
 */
const EXPECTED: Partial<Record<RuleId, number>> = {
  // Task 3（规格 §10.1 的 9 条 VCSS warning）。七条在两个构建（540 xml +
  // 450 css）上实测均为 0——已用与规则实现相互独立的 grep 交叉核对过，
  // 不只是「规则没触发」，是语料里确实不存在这些写法：
  // - webOnlyProperty：^\s*(display|float|flex[\w-]*|grid[\w-]*|
  //   justify-content|align-items|align-self|box-sizing)\s*: 全库 0 处
  // - positionKeyword：^\s*position\s*:\s*(absolute|relative|fixed|
  //   sticky|static)\b 全库 0 处（3 处 `position: fixed` 全部属于
  //   `layout-position`，被精确属性名比较排除）
  // - webUnit：(?:^|[\s(,])[-+.]?\d[\d.]*(vw|vh|em|rem)\b 全库 0 处
  // - pseudoElement：`::` 全库 0 处
  // - visibilityHidden：^\s*visibility\s*:\s*hidden\b 全库 0 处
  // - customProperty：^\s*--[\w-]+\s*: 与 var\(\s*-- 全库均 0 处
  // - keyframesUnquoted：@keyframes\s+[^'"] 全库 0 处（226 个 keyframes
  //   全部带引号）
  'vcss.webOnlyProperty': 0,
  'vcss.positionKeyword': 0,
  'vcss.webUnit': 0,
  'vcss.pseudoElement': 0,
  'vcss.visibilityHidden': 0,
  'vcss.customProperty': 0,
  'vcss.keyframesUnquoted': 0,
  // 两条非零规则，位置见下方 PINNED。数字均为两个构建合计的实测值，不是
  // brief 写计划时在单构建上估的参考值乘二——box-shadow 尤其不是（原因见
  // PINNED 里那条长注释）。
  //
  // boxShadowColorFirst 是 40 而不是 44：Task 3 落地时 `src/core/vcss/parser.ts`
  // 有一个未修的括号深度 bug（Task 4 系列开工前发现，Task 3b 已修），会让
  // 两个构建各自的 `popup_acknowledge_xpgrant.css` 丢失 2 处本该报的位置。
  // Task 3b 修完后两处都恢复，实测数字变成 44——这条注释与下面的数字是
  // Task 3b 按修复后的实测更新的，不是 Task 3 遗留的旧值。
  'vcss.boxShadowColorFirst': 44,
  'vcss.clipThenCover': 10,

  // Task 4（10.1 的跨文件两条 + 10.2 的 class= 跨文件一条）。
  //
  // vcss.unknownDefine 是 0：两个构建、990 个文件的真实语料上，排除 CSS 规范
  // 本身封闭的关键字词表（具名颜色 / cursor 关键字 / 方位关键字 / 跨属性
  // 通用关键字）、font-family（取值域本质开放，不存在可穷举的已知取值）、
  // 以及一批「行为模式选择器」属性（font-weight / font-style /
  // horizontal-align / vertical-align / text-align / background-size /
  // transition-property——这些属性的裸标识符取值从不是常量引用，即使
  // vcss-properties.json 对它们的枚举有已知的实证缺口）之后，剩余 2535 个
  // 「取值整体是裸标识符」的候选全部能在索引里查到定义，含 box-shadow 的
  // 100 个候选（真实语料里 63+ 处 @define 常量名全部正确解析）。判据的完整
  // 推导过程见 src/core/diagnostics/vcss.ts 里 isDefineReferenceCandidate
  // 上方的注释，以及 task-4-report.md。
  'vcss.unknownDefine': 0,

  // vcss.unknownKeyframes 是 4，不是 0——与本任务原定「三条期望值都应为 0」
  // 的预期不符，但已排查过两种常见误判成因、确认这是真实存在的语料缺陷，
  // 不是索引或判据的问题：(a) 已用两个构建共享的同一份全量索引，不存在
  // include 链没跟全的问题；(b) animation-name 是无歧义的判定位置（不像
  // defineRefs 需要候选过滤，见 checkAnimationNameKeyframes 上方注释），
  // 不存在判据放得太宽的问题。两处真实的孤立命名不匹配（各自在两个构建里
  // 各出现一次，因为这两个文件在两份归档间逐字节相同）：
  // - friendslist.css:441 的 animation-name: decrease; ——全库不存在任何
  //   名为 decrease 的 @keyframes（已用独立于本规则实现的 grep 交叉核实）。
  // - hud/hudprogressbar.css:306 的
  //   animation-name: hud-progress-bar-sides-animate; ——同一个文件里只
  //   定义了 hud-progress-bar-defuse-animate / -bomb-animate /
  //   -hostage-animate 三个同族关键帧，唯独没有 -sides-animate 这一个，
  //   像是命名遗漏，或对应的 @keyframes 块被删掉后忘了同步改这一行
  //   animation-name。
  // 位置见下方 PINNED。
  'vcss.unknownKeyframes': 4,

  // vxml.unknownClass 是 793，同样不是 0——已按要求先查索引（同一份全量
  // 共享索引，不存在 include 链没跟全的问题）与判据（class= 属性值只可能是
  // 空白分隔的类名列表，不像 defineRefs 存在「候选 vs 引用」的位置歧义，
  // 没有可收紧的空间）。抽样核实了十几个不同的未解析类名（FillWidth、
  // vline、ConsolePanel、text-letterspace-1px、stratum2Font 等），逐个用
  // grep 在两个构建的全部 .css 文件里搜索，结果均为 0 处——这些类名在归档
  // 内容里确实没有任何 CSS 规则定义它们，不是符号抽取遗漏。根因判断：CS2
  // 的 Panorama 引擎大概率还有一层未被这两份按游戏内容打包的归档收录的
  // 「核心/共享」样式（例如引擎自带的工具类），793 处里绝大多数属于这一类；
  // 也有少量像是真实的死代码（模板残留、未接样式的调试面板等）。默认 hint
  // 级别与规格 §10.2「只是没见过」的定位完全吻合——这条规则设计上就是允许
  // 有噪音的，不是 10.1「能证明是错的」warning。
  //
  // 这个 793 **在这里照旧精确生效**：任何数量变化立刻变红。它不在 PINNED 里
  // 逐条钉位置，改在下方 UNVALIDATABLE 里钉「形状」——理由见那张表上方的
  // 长注释（Ruling 10 及其修订）。
  'vxml.unknownClass': 793,

  // Task 5（规格 §10.2 的两条 VCSS hint）。
  //
  // vcss.unknownProperty 是 0，且是**补完数据之后**的 0，不是规则没接上：
  // 接入时朴素残量 100 处 / 13 种（AST 口径，两个构建合计），三类成因逐一
  // 处理干净——
  // (a) 数据缺口 74 处：四个圆角长写法（border-bottom-right-radius 24 /
  //     border-bottom-left-radius 18 / border-top-left-radius 10 /
  //     border-top-right-radius 10）与三个边框宽度长写法
  //     （border-bottom-width 6 / border-right-width 4 /
  //     border-left-width 2）。计划只点了五个，实测另有 border-right-width
  //     与 border-left-width 同样缺失；连同语料里没出现的 border-top-width
  //     一并补全八个，避免同族属性一半报一半不报。
  // (b) 属性名大小写变体 26 处：Width 6 / Padding 6 / Brightness 6 /
  //     Margin-left 4 / Opacity 2 / Height 2，全是 Valve 自己出货的写法。
  //     CSS 属性名本来就大小写不敏感，规则按小写回退解析。
  // (c) 与 §10.1 同区间重叠 0 处（语料里 display/float/flex*/grid*/--x 都是
  //     0），但规则里仍然显式让位，否则同一个属性名区间会挂两条诊断。
  'vcss.unknownProperty': 0,

  // vcss.unknownValue 是 72，不是计划预期的 0。已按要求先查因、再由控制者
  // 裁决（Ruling 14），不是直接填数字。接入时的残量是 224 处、7 个
  // (属性, 取值) 组合，逐个核对了两份来源文档（docs/VCSS-Panorama专属.md、
  // docs/CSS属性清单.md，即 data/vcss-properties.json 的 source 字段）后
  // 一分为二：
  //
  // **判定为人工表的实证缺口、已补进 data/vcss-properties.json（152 处）**：
  //   62  font-weight: lighter                   \
  //    8  font-weight: bolder                     | Ruling 14
  //   44  horizontal-align: center_nopixelsnap    |
  //   36  vertical-align: center_nopixelsnap      |
  //    2  text-align: center_nopixelsnap         /
  // 依据**不是频次**：center_nopixelsnap 在三个同族对齐属性上系统性出现
  // （笔误不会这样跨属性传播，且 _nopixelsnap 是有明确引擎语义、Web CSS 里
  // 没有对应概念的复合词）；lighter / bolder 则是「同一张表的准入标准不能
  // 自相矛盾」——font-weight 是唯一一个来源文档没给取值枚举的属性，表里那
  // 6 个值本来就是从语料统计派生的，而 lighter(31) 比表内已收的 black(23) /
  // light(23) / thin(1) 都更频繁。两条依据都写进了对应属性的 description，
  // 并由 vcss-hint.test.ts 里那两条「Ruling 14 的准入判据」测试钉住。
  //
  // **判定为 Valve 自己的笔误、保留为命中（72 处，即本数字）**：
  //   58  horizontal-align: middle    两份文档都正面写死 left | center | right，
  //                                   而「center 与 middle 同义」这句注解只挂在
  //                                   vertical-align 那一行——作者注意到了这个
  //                                   同义关系却没写在 horizontal 上。middle 是
  //                                   同族属性的合法值，复制粘贴改属性名即产生。
  //   14  font-style: italics         文档明写 normal / italic，CSS 规范里也没有
  //                                   italics 这个拼法，与 italic 精确一字之差；
  //                                   同一构建里 italic 8 处、italics 7 处并存。
  //
  // 已排除的两类误判成因：(a) 不是索引问题——L6「取值是工作区里某个 @define
  // 的名字」用的是两构建全量共享索引，它在语料上实际消掉 72 处，通路是通的；
  // (b) 不是判据太宽——命中全部落在「取值域是封闭关键字集合」的属性上，没有
  // 一处散落在开放取值域的属性上（那才是判据放宽会出现的形态）。位置见下方
  // PINNED。判定过程与逐层降噪数字见 task-5-report.md。
  'vcss.unknownValue': 72,

  // ───────────────────────────────────────────────────────────────────────
  // Task 6 留给 Task 7 的一条声明（Ruling 16 第 2 条），**必须读完再填数字**：
  //
  // `vxml.unknownAttribute` 将来填在这里的 0 是**构造性恒真、不构成证据**。
  // 观测压制层（data/vxml-observed-attributes.json）是从 20260829 挖的，而
  // 20260829 实测是 20260716 的**真超集**（只在 716 里有的属性 0 种；反向多出
  // `ToggleButton@series-button` 3 次与标签 `CSGOInfoHudLayouts`）。也就是说
  // 挖掘源覆盖了被测对象的全部内容——任何实现都不可能在这份语料上报出东西，
  // 「期望 0」在别处是一条断言，在这里只是一句同义反复。**闸门对这条规则一点
  // 活信号都没有**，不要把它读成覆盖。
  //
  // 这比 Ruling 12（`vcss.unknownValue` 那次挖掘源只覆盖被测对象的一半）严重：
  // 那次还剩一半活的，这次一点都不剩。真正的防线只有两处：
  // 1. `test/unit/core/data/observed-attributes.test.ts` 的查询层单元测试；
  // 2. 下面那条「观测属性层 == 语料的 XSD 缺口」的**数据**不变量——它的对象是
  //    数据而不是规则，挖掘脚本坏了、数据文件陈旧了都会变红，是真能失败的。
  // ───────────────────────────────────────────────────────────────────────
  //
  // Task 7 按上面这条声明填数字，**并复核了它的两个前提**（都成立，是自己在
  // 归档上重量的，不是照抄）：
  //
  // vxml.unknownAttribute = 0。这个 0 是上面说的构造性恒真，**不构成证据**。
  // 落地前用一份不 import 任何诊断实现、只依赖 parseVxml + 两份 JSON 的独立
  // 脚本量过：判定顺序里少掉 Ruling 17 那一步时，语料上是 **44** 处
  // （20260829 有 23、20260716 有 21，与 Ruling 17 记的数字逐个吻合），全部
  // 落在观测层收的那 6 种未知标签上——其中 ItemPreviewColorSlider@id 8 处、
  // ItemPreviewPanel@class 4 处这类**任何面板都合法**的属性占了一多半，因为
  // 未知标签在 panels.json 里没有属性集。补上 Ruling 17 之后归零。规则实现
  // 落地后又在这条闸门上做过同一处 tamper 复核，报的正是 44。
  //
  // vxml.unknownTag = 0。这条**不是**构造性恒真的同一回事，值得说清楚差别：
  // 它的压制层（observed.tags）只有 6 条，且那 6 条与语料里的未知标签集合由
  // 下面那条数据不变量双向钉死；但压制源同样是从 20260829 挖的，所以它在语料
  // 上同样报不出东西。两条规则在闸门上都没有活信号，防线都在
  // test/unit/core/diagnostics/vxml-tag-attr.test.ts（逐层独家用例 + 逐层
  // tamper）。
  //
  // 这两个 0 有一件事是真能失败的：**规则层的结构标签集合若与挖掘口径分叉**，
  // 立刻在这里变红。少一个（例如规则忘了排除 <snippet>）→ 540 个布局里每处
  // 结构标签都报 unknownTag；多一个 → 那个标签的真实错误被静默、而它原本在
  // 观测层里没有对应条目，数据不变量那侧也会跟着红。
  'vxml.unknownTag': 0,
  'vxml.unknownAttribute': 0,

  // ─────────────────────────────────────────────────────────────────────────
  // Task 8（§10.1 的四条 VXML 结构 warning + §10.2 的 id 重复 hint）。
  //
  // 四条 warning 全部实测为 0，且**不是构造性恒真**——与上面 unknownTag /
  // unknownAttribute 那两条不同，这五条没有任何一层「从本语料挖出来的压制
  // 数据」，判据全部写死在规则层（骨架顺序表、panels.json 的 rootOnly 位、
  // 解析器的 unclosed / unterminated 字段）。语料对它们是**活信号**：任何
  // 一条误报都会在这里立刻变红。落地前用一份不 import 诊断实现、只依赖
  // parseVxml + panels.json 的独立脚本在 540 个布局上量过，与规则实现落地后
  // 的实测逐条一致。
  //
  // vxml.structure = 0。540 个布局逐个核过：<root> 元素数恰好 1 的有 540 个；
  // <root> 直接子元素里排除 <styles>/<scripts>/<snippets> 后剩下的面板数恰好
  // 1 的也是 540 个（分布表里没有 n=0 与 n>=2 这两档）。骨架排列只出现四种：
  // styles>scripts 194、styles>scripts>snippets 184、styles 130、
  // styles>snippets 30（另有 2 个文件一个骨架元素都没有），全部与规则里
  // SKELETON_TAGS 的顺序相容，没有一处重复、倒置或出现在根面板之后。
  // T8 评审 Minor 1 之后 <include> / <snippet> / 嵌套的 <root> 也从根面板候选里
  // 排掉、各自报一条自己的消息（MISPLACED_UNDER_ROOT）——这个 0 在改动前后都成立，
  // 因为 540 个布局的根位置上一个这三种标签都没有（若有，改动前它顶掉根面板名额、
  // 改动后它自己报一条，两个方向都会让这里立刻变红）。
  //
  // vxml.rootOnlyNested = 0，**这个 0 是本任务最要紧的一个数字**。计划文档写
  // 的是「粗扫报出 rootOnly 嵌套 21 次」，逐例核查后全部是误报：<snippets> 块
  // 里装着 <Panel> 等真面板，而 PopupCustomLayout 出现在 <snippets> **之后**，
  // 于是「文档里第一个面板元素就是根面板」这种朴素写法会把 snippet 模板里的
  // Panel 当成根面板，把真正的根面板判成嵌套。本任务用真解析器复量：朴素定义
  // 两构建合计 **42** 处误报（20260829 21 处 + 20260716 21 处，与计划文档的
  // 单构建 21 吻合），正确定义（<root> 的直接子元素里排除三个骨架标签之后剩
  // 下的那一个）**0** 处。这 42 处里 40 处是 20 个 popup 的 PopupCustomLayout，
  // 另 2 处是 hud/hudweaponselection.xml 的 CSGOWeaponSelectionViewAbstract。
  //
  // vxml.rootPanelId = 0。与规格 §10.1「关于根面板 id 这条」M1 期间在两个构建
  // 全部 540 个布局上的验证结论一致，本任务用真解析器复量仍是 0。这条规则
  // **无法从 XSD 推导**（panels.hasAttribute('Panel','id') 为真），只能硬编码，
  // 因此这个 0 是它唯一的语料证据。
  //
  // vxml.syntax = 0。四个子判据分别量过，全部 0：开始标签缺 > 0 处、属性值
  // 缺引号 0 处、属性值缺右引号 0 处、缺闭合标签 0 处。最后一条用的是「end 之前
  // 必须正好是 </tag>」的原文判据（解析器不单独记这个事实，见 vxml.ts 里
  // closedByEndTag 的注释），它在 540 个布局上零命中——这同时说明这条判据没有
  // 把「被祖先闭合标签顺带收掉」之外的正常写法误判成未闭合。T8 评审 Minor 4 之后
  // 同一条未闭合链只报最内层那一条（直接子元素也没收尾就让位），语料零命中，
  // 这个 0 不受影响。
  'vxml.structure': 0,
  'vxml.rootOnlyNested': 0,
  'vxml.rootPanelId': 0,
  'vxml.syntax': 0,

  // vxml.duplicateId = 244，**不是 0**。计划文档 Task 8 段写「这五条的闸门期望
  // 全部是 0」，那一句是错的，控制者派发前已实测更正（Ruling 20），本任务用真
  // 解析器独立复核，与控制者的正则近似逐个数字吻合：
  //
  //   口径                          20260829   20260716   合计
  //   朴素（同文件字面重复）             259        253      512
  //   按 snippet 分作用域 + 跳过空 id    125        119      244
  //
  // 作用域模型：<snippet> 是模板、各自独立实例化，因此**每个 <snippet> 元素是
  // 一个独立的 id 作用域**，其余算「主树」作用域。同名 id 分处两个不同 snippet
  // 不算重复，同一个 snippet 内才算。另外空 id="" 一律跳过（空 id 不是 id；
  // 两构建合计 80 处）。这两条各自的削减量：朴素 512 → 244，差的 268 处由
  // 「跨 snippet 同名」与「空 id」两类构成。
  //
  // 这 244 处散在 68 个绝对路径、34 个文件名上（两份归档命中的文件名集合相同），
  // 对应 55 个不同的 id 名字。**两组不是逐条成对**：20260829 125 条、
  // 20260716 119 条。34 个文件里有 2 个两构建内容不同（逐字节 cmp 过）：
  // layout/mainmenu.xml（16096 vs 15608 字节，命中数同为 3 但行号不同）与
  // layout/popups/popup_major_store.xml（32965 vs 29680 字节，16 条 vs 10 条）；
  // 差的 6 条正是 125 - 119。另外 32 个文件两构建逐字节相同。
  // （交付时这里写的「逐字节相同、两两成对」是错的，T8 评审 M-2 抓出并更正。）
  // 样例：endofmatch.xml 的
  // matchCancelledTitle（第 45 行首次出现，第 49、53 行各重复一次）、
  // friendslist.xml 的 id-friendslist-counter（第 89 行首次，105/147/163 重复）。
  // 这是 Valve 自己出货的真实情况——同一个 id 在同一棵树里挂多次，脚本的
  // FindChildTraverse 只会拿到第一个，属于真实缺陷而非误报，因此保留为命中。
  //
  // **为什么逐条钉 PINNED 而不进 UNVALIDATABLE**（Ruling 20，理由不是「照规矩
  // 办」）：这条规则存在一种**只有位置能抓住**的坏法——把「报第二次出现」改成
  // 「报第一次出现」，数量仍是 244、distinctFiles 仍是 68、topMessages（id 名字
  // 分布）也一字不变，**只有位置全变**。形状表对这个变体是瞎的。本任务实测过
  // 这个 tamper：EXPECTED 与形状表都不动，只有下面 PINNED 那条断言变红。
  'vxml.duplicateId': 244,

  // ─────────────────────────────────────────────────────────────────────────
  // Task 9（规格 §10.3 的七条 CustomHudLayout 白名单 error）。
  //
  // **这七个 0 的性质必须写明，别读成覆盖。** 它们不是「规则在语料上验证通过」，
  // 而是「**语料根本不进入这条代码路径**」：990 个文件全在 `layout/` 下，没有一个
  // 匹配 `panorama.customHudLayout.include` 的默认 glob（`**/layout/custom_game/**`），
  // 于是下面的跑批对每个文件拿到的 mode 都是 `'full'`，`diagnoseVxml` 里那七条规则
  // 一次都没被调用过。
  //
  // 与 Ruling 16 记的 `vxml.unknownAttribute` 那种构造性恒真**同类不同因**：
  // 那次规则跑了、但压制层是从被测语料自己挖的，所以必然报不出东西；这次是规则
  // **压根没跑**。两种情况下「期望 0」都只是一句同义反复，不是断言。
  //
  // 真正的防线是 `test/unit/core/diagnostics/custom-hud.test.ts`（七条规则逐条
  // 独家用例 + 逐层 tamper）与 `dedup.test.ts`（§10.3 与 §10.1/§10.2 的去重，
  // 每条重叠用例都先证明「不去重时确实是两条」）。
  //
  // 这七行在这里仍有**一件真能失败的事**：跑批用的是 `layoutModeFor(f)` 而不是
  // 硬编码的 `'full'`（Task 9 改的，交付前它是硬编码）。哪天归档里出现
  // `layout/custom_game/` 下的布局，模式判定会把它切进严格模式，这七个数字与
  // 下面那条「语料里没有任何文件进入严格模式」的断言会一起变红——那时该做的是
  // 重新核这七条规则在真实严格模式布局上的表现，而不是把数字改掉。
  // ─────────────────────────────────────────────────────────────────────────
  'hud.panelNotAllowed': 0,
  'hud.attributeNotAllowed': 0,
  'hud.buttonText': 0,
  'hud.scripts': 0,
  'hud.inlineStyle': 0,
  'hud.snippetsOrFrame': 0,
  'hud.binding': 0,
};

/** 允许非零的规则，必须逐个 file:line 钉死 */
const PINNED: Partial<Record<RuleId, readonly string[]>> = {
  // background-size: clip_then_cover——反编译器产物，非引擎关键字。两个
  // 构建里是完全相同的 5 个文件 5 处位置（这 5 个 .css 文件在两份归档间
  // 逐字节相同），因此 10 条位置两两成对、只是构建前缀不同。
  'vcss.clipThenCover': [
    '20260829/panorama/styles/popups/popup_accept_match.css:108',
    '20260829/panorama/styles/popups/popup_acknowledge_item.css:38',
    '20260829/panorama/styles/popups/popup_tournament_journal.css:45',
    '20260829/panorama/styles/popups/popup_tournament_journal.css:56',
    '20260829/panorama/styles/xpshop.css:39',
    '20260716/styles/popups/popup_accept_match.css:108',
    '20260716/styles/popups/popup_acknowledge_item.css:38',
    '20260716/styles/popups/popup_tournament_journal.css:45',
    '20260716/styles/popups/popup_tournament_journal.css:56',
    '20260716/styles/xpshop.css:39',
  ],

  /**
   * box-shadow 颜色在前（官方语法 [fill|hollow|inset] 颜色 x y blur
   * spread；这 44 处是 Web 顺序：长度值打头）。
   *
   * 写计划时（brief task-3-brief.md Step 5）给的参考值是单构建 22 处，
   * 两个构建合计 44——与这里最终钉的数字一致，但中间有一段曲折，记在这里
   * 防止将来有人看见「数字和 brief 对上了」就把下面这段历史脉络删掉：
   *
   * **Task 3 落地时实测是 40，不是 44。** 差的 4 处（每个构建 2 处）当时就
   * 查清了成因，不是规则误判：`popups/popup_acknowledge_xpgrant.css` 的
   * `.popup__rarity-bar` 规则里，第 26 行
   * `background-color: gradient( linear, ..., from( white,
   * to(rgba(175, 175, 175, .75) ));` 本身是反编译产物里的一处真实语法
   * 缺陷——4 个左括号（gradient/from/to/rgba）只有 3 个右括号收，少了一个。
   * 当时的 `src/core/vcss/parser.ts`（M3 产物）里，`scanValue` 靠括号深度
   * 找值的结束边界，深度一旦补不平就再也不认识任何停止符，这一个
   * background-color 的取值扫描会一路吞到文件尾（该规则的 `blockEnd` 停在
   * `-1`），把第 27、36 行本应各自独立的
   * `box-shadow: 0px 2px 6px 0px fill rgba(...)`（Web 顺序，真该报）一起
   * 吞成了那个取值字符串的一部分，两个构建各少 2 处，合计少 4 处。Task 3
   * 把这个已知行为记在案、留给控制者裁决是否值得单独修 parser，未改动
   * `parser.ts` 本身（不在那次任务的文件清单内）。
   *
   * **Task 3b 把这个裁决落了地：改，而且必须改。** 一个未闭合的 `(` 会让
   * `scanValue` 的括号深度计数器永远大于 0，从而永远不认识 `;`/`}` 这些
   * 停止符——这不只影响这一条规则，是 hover/补全/文档符号/颜色装饰/跳转/
   * 诊断共享的解析器组件级缺陷，光标之后的整份文档都会从解析结果里消失。
   * 修法：`scanValue` 不再用括号深度门控停止符匹配——本函数所有调用点的
   * 停止符集合（`:` `;` `{` `}` `\n`）在合法、括号配平的 VCSS 取值里从不会
   * 出现在括号内部，深度门控对格式正确的输入从未起过任何实际作用，只在
   * 格式错误时把行为变糟（吞到文件尾）。修复后第 27、36 行的两条
   * box-shadow 各自独立解析出来，两个构建各恢复 2 处，合计恢复 4 处，
   * 40 → 44，与 brief 当初的参考值重新对上——巧合是结果对上了，不是刻意
   * 凑数：两处独立缺陷（brief 的估算方法 vs parser 的括号深度 bug）方向
   * 相反，只是数值上相互抵消。
   *
   * 独立于本规则实现的原始文本正则交叉核对：全库 `^\s*box-shadow\s*:`
   * 660 处，Task 3 时解析器只切出 626 条声明（差 34，其中 4 条是上面这
   * 两处×两构建）；Task 3b 修复后解析器切出的 box-shadow 声明数与原始文本
   * 正则计数完全相等，均为 660——不只是这条规则要看的 4 处，其余 30 处
   * 「消失」的 box-shadow（分布在另外几个同型畸形文件里，均已是颜色在前
   * 的合法写法）也一并被 parser 修复恢复，只是它们不触发本规则。
   *
   * **对 Task 3 报告的一处更正**：Task 3 报告说两个构建各有 6 个 css 文件
   * 命中这个「吞穿到文件尾」缺陷，是用「文档里是否存在 `blockEnd === -1`
   * 的规则」搜出来的。Task 3b 改动前后对全部 450 个 css 文件（两个构建）
   * 做了逐文件 AST 深度比较（不只是数一数规则数——用 `JSON.stringify`
   * 整棵 AST 逐字节比较，`text` 字段除外），实测受影响的其实是每个构建
   * 7 个文件（多了 `radialmenubase.css`），不是 6 个：这个文件的缺陷出现
   * 在文件极早的位置（第 5 行一个 `@define` 的取值），旧代码把从那里开始
   * 到文件尾的全部内容——包括后面所有的规则——都吞成了那一个 `@define`
   * 的取值，`doc.rules` 直接是空数组。Task 3 的搜索方法是
   * `doc.rules.some(r => r.blockEnd === -1)`，对一个 `rules` 本来就是空
   * 数组的文件必然是「假」（`[].some(...)` 恒为 false），所以系统性地
   * 漏掉了受害最重的这一个文件。已确认它的恢复（0 条规则 → 65 条）不
   * 影响 `boxShadowColorFirst`（也不影响其他任何规则——本文件改动前后跑过
   * 全量 990 文件×全部 RuleId 的诊断结果，只有这一条规则的数字变了）：
   * 这个文件本身没有 Web 顺序的 box-shadow。完整的改动前后逐文件比对
   * 过程与结论见 `task-3b-report.md`。
   *
   * 这条历史记录本身就是 D-M4-3「非零项必须逐 file:line 钉死」规矩的一次
   * 记录在案的例外：本任务改的不是这条规则自己的判据，是它依赖的共享
   * 解析器组件，数字从 40 变成 44 是 Task 3b 的预期成果，不是回归。
   */
  'vcss.boxShadowColorFirst': [
    '20260829/panorama/styles/carousel_nav.css:136',
    '20260829/panorama/styles/csgostyles.css:2933',
    '20260829/panorama/styles/hud/hudteamcounter.css:622',
    '20260829/panorama/styles/mainmenu_play.css:1492',
    '20260829/panorama/styles/mainmenu_play.css:1510',
    '20260829/panorama/styles/mainmenu_play.css:1562',
    '20260829/panorama/styles/mainmenu_play.css:1618',
    '20260829/panorama/styles/mainmenu_play.css:1624',
    '20260829/panorama/styles/mainmenu_watch_eventsched.css:320',
    '20260829/panorama/styles/mainmenu_watch_eventsched.css:335',
    '20260829/panorama/styles/mainmenu_watch_eventsched.css:350',
    '20260829/panorama/styles/mission_tile_playmenu.css:15',
    '20260829/panorama/styles/player_stats_card.css:24',
    '20260829/panorama/styles/popups/popup_acknowledge_item.css:28',
    '20260829/panorama/styles/popups/popup_acknowledge_xpgrant.css:27',
    '20260829/panorama/styles/popups/popup_acknowledge_xpgrant.css:36',
    '20260829/panorama/styles/popups/popup_can_apply_pick_slot.css:362',
    '20260829/panorama/styles/popups/popup_container_open_confirm.css:17',
    '20260829/panorama/styles/stats/playerstats.css:648',
    '20260829/panorama/styles/teamintromenu.css:108',
    '20260829/panorama/styles/tooltips/tooltip_eventsched_team.css:80',
    '20260829/panorama/styles/tournaments/pickem_common.css:878',
    '20260716/styles/carousel_nav.css:136',
    '20260716/styles/csgostyles.css:2933',
    '20260716/styles/hud/hudteamcounter.css:622',
    '20260716/styles/mainmenu_play.css:1492',
    '20260716/styles/mainmenu_play.css:1510',
    '20260716/styles/mainmenu_play.css:1562',
    '20260716/styles/mainmenu_play.css:1618',
    '20260716/styles/mainmenu_play.css:1624',
    '20260716/styles/mainmenu_watch_eventsched.css:320',
    '20260716/styles/mainmenu_watch_eventsched.css:335',
    '20260716/styles/mainmenu_watch_eventsched.css:350',
    '20260716/styles/mission_tile_playmenu.css:15',
    '20260716/styles/player_stats_card.css:24',
    '20260716/styles/popups/popup_acknowledge_item.css:28',
    '20260716/styles/popups/popup_acknowledge_xpgrant.css:27',
    '20260716/styles/popups/popup_acknowledge_xpgrant.css:36',
    '20260716/styles/popups/popup_can_apply_pick_slot.css:362',
    '20260716/styles/popups/popup_container_open_confirm.css:17',
    '20260716/styles/stats/playerstats.css:648',
    '20260716/styles/teamintromenu.css:108',
    '20260716/styles/tooltips/tooltip_eventsched_team.css:80',
    '20260716/styles/tournaments/pickem_common.css:878',
  ],

  // 两处真实的孤立命名不匹配（成因见上方 EXPECTED 里的长注释），两个构建
  // 各一份，文件逐字节相同。
  'vcss.unknownKeyframes': [
    '20260829/panorama/styles/friendslist.css:441',
    '20260829/panorama/styles/hud/hudprogressbar.css:306',
    '20260716/styles/friendslist.css:441',
    '20260716/styles/hud/hudprogressbar.css:306',
  ],

  /**
   * vcss.unknownValue —— 两处 Valve 自己的笔误（horizontal-align: middle 58 +
   * font-style: italics 14），判定依据与被排除的另外 152 处见上方 EXPECTED
   * 里的长注释（Ruling 14）。
   *
   * 72 条 = 每个构建 36 条，两组逐条成对（这 8 个 .css 文件在两份归档之间
   * 逐字节相同），只是构建前缀不同——与 clipThenCover / boxShadowColorFirst
   * 的形态一致。
   */
  'vcss.unknownValue': [
    '20260829/panorama/styles/csgostyles.css:1005',
    '20260829/panorama/styles/csgostyles.css:1015',
    '20260829/panorama/styles/friendlobby.css:178',
    '20260829/panorama/styles/hud/hudchat.css:141',
    '20260829/panorama/styles/hud/hudrosettaselector.css:92',
    '20260829/panorama/styles/hud/hudrosettaselector.css:154',
    '20260829/panorama/styles/hud/hudrosettaselector.css:160',
    '20260829/panorama/styles/hud/hudrosettaselector.css:168',
    '20260829/panorama/styles/hud/hudrosettaselector.css:188',
    '20260829/panorama/styles/hud/hudrosettaselector.css:218',
    '20260829/panorama/styles/hud/hudrosettaselector.css:246',
    '20260829/panorama/styles/hud/hudrosettaselector.css:261',
    '20260829/panorama/styles/hud/hudteamcounter.css:1121',
    '20260829/panorama/styles/hud/hudteamcounter.css:1130',
    '20260829/panorama/styles/hud/hudteamcounter.css:1150',
    '20260829/panorama/styles/hud/hudteamcounter.css:1170',
    '20260829/panorama/styles/hud/hudteamcounter.css:1193',
    '20260829/panorama/styles/itempreview.css:20',
    '20260829/panorama/styles/itempreview.css:40',
    '20260829/panorama/styles/itempreview.css:60',
    '20260829/panorama/styles/itempreview.css:80',
    '20260829/panorama/styles/itempreview.css:197',
    '20260829/panorama/styles/itempreview.css:307',
    '20260829/panorama/styles/itemtile.css:115',
    '20260829/panorama/styles/itemtile.css:500',
    '20260829/panorama/styles/itemtile.css:525',
    '20260829/panorama/styles/mainmenu_play.css:87',
    '20260829/panorama/styles/mainmenu_play.css:1158',
    '20260829/panorama/styles/mapdraft.css:372',
    '20260829/panorama/styles/popups/popup_permissions_settings.css:17',
    '20260829/panorama/styles/popups/popup_permissions_settings.css:61',
    '20260829/panorama/styles/popups/popup_workshop_mode_select.css:22',
    '20260829/panorama/styles/stats/playerstats_weaponsgraph.css:30',
    '20260829/panorama/styles/tooltips/tooltip_inventory_item.css:68',
    '20260829/panorama/styles/tournaments/pickem_common.css:158',
    '20260829/panorama/styles/tournaments/pickem_common.css:860',
    '20260716/styles/csgostyles.css:1005',
    '20260716/styles/csgostyles.css:1015',
    '20260716/styles/friendlobby.css:178',
    '20260716/styles/hud/hudchat.css:141',
    '20260716/styles/hud/hudrosettaselector.css:92',
    '20260716/styles/hud/hudrosettaselector.css:154',
    '20260716/styles/hud/hudrosettaselector.css:160',
    '20260716/styles/hud/hudrosettaselector.css:168',
    '20260716/styles/hud/hudrosettaselector.css:188',
    '20260716/styles/hud/hudrosettaselector.css:218',
    '20260716/styles/hud/hudrosettaselector.css:246',
    '20260716/styles/hud/hudrosettaselector.css:261',
    '20260716/styles/hud/hudteamcounter.css:1121',
    '20260716/styles/hud/hudteamcounter.css:1130',
    '20260716/styles/hud/hudteamcounter.css:1150',
    '20260716/styles/hud/hudteamcounter.css:1170',
    '20260716/styles/hud/hudteamcounter.css:1193',
    '20260716/styles/itempreview.css:20',
    '20260716/styles/itempreview.css:40',
    '20260716/styles/itempreview.css:60',
    '20260716/styles/itempreview.css:80',
    '20260716/styles/itempreview.css:197',
    '20260716/styles/itempreview.css:307',
    '20260716/styles/itemtile.css:115',
    '20260716/styles/itemtile.css:500',
    '20260716/styles/itemtile.css:525',
    '20260716/styles/mainmenu_play.css:87',
    '20260716/styles/mainmenu_play.css:1158',
    '20260716/styles/mapdraft.css:372',
    '20260716/styles/popups/popup_permissions_settings.css:17',
    '20260716/styles/popups/popup_permissions_settings.css:61',
    '20260716/styles/popups/popup_workshop_mode_select.css:22',
    '20260716/styles/stats/playerstats_weaponsgraph.css:30',
    '20260716/styles/tooltips/tooltip_inventory_item.css:68',
    '20260716/styles/tournaments/pickem_common.css:158',
    '20260716/styles/tournaments/pickem_common.css:860',
  ],
  /**
   * vxml.duplicateId —— 244 处同作用域 id 重复（成因、口径与作用域模型见上方
   * EXPECTED 里的长注释）。**20260829 125 条 / 20260716 119 条**，两组**不是**
   * 逐条成对，也**不是**每构建 122 条：命中的 34 个文件名两份归档都有，但
   * mainmenu.xml 与 popups/popup_major_store.xml 两构建内容不同，后者一侧
   * 16 条、另一侧 10 条，差的 6 条正是 125 - 119。（交付时这里写的「每个构建
   * 122 条、34 个文件逐字节相同」两句都是错的，T8 评审 M-2 抓出并按实测更正。）
   *
   * **这张表是本规则唯一能抓住「报第一次出现」那个变体的东西**（Ruling 20）：
   * 那个变体的 EXPECTED 数字、distinctFiles、topMessages 全部不变，只有这里的
   * 行号会整体挪到每组重复的首次出现位置上。所以这 244 行不是形式主义，删掉
   * 它换成形状表就等于把这条规则的位置判据整个放空。
   *
   * 行号取的是 id **取值**的位置（Diagnostic.start 落在引号内的第一个字符上），
   * 与其他几条 PINNED 一样按 lineOf(text, d.start) 算。
   */
  'vxml.duplicateId': [
    '20260829/panorama/layout/endofmatch.xml:49',
    '20260829/panorama/layout/endofmatch.xml:50',
    '20260829/panorama/layout/endofmatch.xml:53',
    '20260829/panorama/layout/endofmatch.xml:54',
    '20260829/panorama/layout/friendslist.xml:105',
    '20260829/panorama/layout/friendslist.xml:109',
    '20260829/panorama/layout/friendslist.xml:139',
    '20260829/panorama/layout/friendslist.xml:140',
    '20260829/panorama/layout/friendslist.xml:147',
    '20260829/panorama/layout/friendslist.xml:151',
    '20260829/panorama/layout/friendslist.xml:152',
    '20260829/panorama/layout/friendslist.xml:156',
    '20260829/panorama/layout/friendslist.xml:163',
    '20260829/panorama/layout/friendslist.xml:167',
    '20260829/panorama/layout/friendslist.xml:168',
    '20260829/panorama/layout/friendslist.xml:169',
    '20260829/panorama/layout/hud/huddemocontroller.xml:80',
    '20260829/panorama/layout/hud/hudvote.xml:14',
    '20260829/panorama/layout/hud/hudvote.xml:18',
    '20260829/panorama/layout/itemtile.xml:51',
    '20260829/panorama/layout/mainmenu.xml:83',
    '20260829/panorama/layout/mainmenu.xml:109',
    '20260829/panorama/layout/mainmenu.xml:126',
    '20260829/panorama/layout/mainmenu_play.xml:223',
    '20260829/panorama/layout/mainmenu_play.xml:227',
    '20260829/panorama/layout/mainmenu_play.xml:239',
    '20260829/panorama/layout/mainmenu_play.xml:243',
    '20260829/panorama/layout/mainmenu_play.xml:247',
    '20260829/panorama/layout/mainmenu_play.xml:331',
    '20260829/panorama/layout/mainmenu_watch_eventsched.xml:71',
    '20260829/panorama/layout/mapdraft.xml:87',
    '20260829/panorama/layout/mission_tile_mainmenu.xml:50',
    '20260829/panorama/layout/playercard.xml:39',
    '20260829/panorama/layout/playercard.xml:115',
    '20260829/panorama/layout/playercard.xml:119',
    '20260829/panorama/layout/playercard.xml:123',
    '20260829/panorama/layout/popups/popup_accept_match.xml:61',
    '20260829/panorama/layout/popups/popup_capability_can_keychain.xml:39',
    '20260829/panorama/layout/popups/popup_capability_can_patch.xml:37',
    '20260829/panorama/layout/popups/popup_capability_can_sticker.xml:46',
    '20260829/panorama/layout/popups/popup_capability_decodable.xml:140',
    '20260829/panorama/layout/popups/popup_inspect_async-bar.xml:37',
    '20260829/panorama/layout/popups/popup_inspect_rental-bar.xml:27',
    '20260829/panorama/layout/popups/popup_inspect_rental-bar.xml:39',
    '20260829/panorama/layout/popups/popup_inspect_rental-bar.xml:47',
    '20260829/panorama/layout/popups/popup_inspect_rental-bar.xml:54',
    '20260829/panorama/layout/popups/popup_inventory_inspect.xml:48',
    '20260829/panorama/layout/popups/popup_inventory_inspect.xml:49',
    '20260829/panorama/layout/popups/popup_major_store.xml:394',
    '20260829/panorama/layout/popups/popup_major_store.xml:395',
    '20260829/panorama/layout/popups/popup_major_store.xml:403',
    '20260829/panorama/layout/popups/popup_major_store.xml:404',
    '20260829/panorama/layout/popups/popup_major_store.xml:407',
    '20260829/panorama/layout/popups/popup_major_store.xml:408',
    '20260829/panorama/layout/popups/popup_major_store.xml:411',
    '20260829/panorama/layout/popups/popup_major_store.xml:412',
    '20260829/panorama/layout/popups/popup_major_store.xml:420',
    '20260829/panorama/layout/popups/popup_major_store.xml:421',
    '20260829/panorama/layout/popups/popup_major_store.xml:424',
    '20260829/panorama/layout/popups/popup_major_store.xml:425',
    '20260829/panorama/layout/popups/popup_major_store.xml:428',
    '20260829/panorama/layout/popups/popup_major_store.xml:429',
    '20260829/panorama/layout/popups/popup_major_store.xml:432',
    '20260829/panorama/layout/popups/popup_major_store.xml:433',
    '20260829/panorama/layout/popups/popup_offers_laptop_interface.xml:164',
    '20260829/panorama/layout/popups/popup_offers_laptop_interface.xml:167',
    '20260829/panorama/layout/popups/popup_shopping_cart_checkout.xml:135',
    '20260829/panorama/layout/popups/popup_shopping_cart_checkout.xml:140',
    '20260829/panorama/layout/popups/popup_shopping_cart_checkout.xml:152',
    '20260829/panorama/layout/popups/popup_tournament_journal.xml:66',
    '20260829/panorama/layout/retakeloadout.xml:38',
    '20260829/panorama/layout/retakeloadout.xml:41',
    '20260829/panorama/layout/retakeloadout.xml:44',
    '20260829/panorama/layout/scoreboard.xml:387',
    '20260829/panorama/layout/scoreboard.xml:391',
    '20260829/panorama/layout/scoreboard.xml:396',
    '20260829/panorama/layout/scoreboard.xml:400',
    '20260829/panorama/layout/settings/settings_audio.xml:186',
    '20260829/panorama/layout/settings/settings_audio.xml:187',
    '20260829/panorama/layout/settings/settings_audio.xml:188',
    '20260829/panorama/layout/settings/settings_audio.xml:195',
    '20260829/panorama/layout/settings/settings_audio.xml:196',
    '20260829/panorama/layout/settings/settings_audio.xml:197',
    '20260829/panorama/layout/settings/settings_audio.xml:198',
    '20260829/panorama/layout/settings/settings_audio.xml:205',
    '20260829/panorama/layout/settings/settings_audio.xml:206',
    '20260829/panorama/layout/settings/settings_audio.xml:207',
    '20260829/panorama/layout/settings/settings_audio.xml:208',
    '20260829/panorama/layout/settings/settings_audio.xml:215',
    '20260829/panorama/layout/settings/settings_audio.xml:216',
    '20260829/panorama/layout/settings/settings_audio.xml:217',
    '20260829/panorama/layout/settings/settings_audio.xml:218',
    '20260829/panorama/layout/settings/settings_game.xml:206',
    '20260829/panorama/layout/settings/settings_game.xml:207',
    '20260829/panorama/layout/settings/settings_game.xml:724',
    '20260829/panorama/layout/settings/settings_game.xml:725',
    '20260829/panorama/layout/settings/settings_game.xml:845',
    '20260829/panorama/layout/settings/settings_game.xml:846',
    '20260829/panorama/layout/settings/settings_game.xml:847',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:264',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:265',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:268',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:269',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:272',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:273',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:276',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:277',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:280',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:281',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:284',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:285',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:288',
    '20260829/panorama/layout/settings/settings_kbmouse.xml:289',
    '20260829/panorama/layout/settings/settings_video.xml:29',
    '20260829/panorama/layout/settings/settings_video.xml:293',
    '20260829/panorama/layout/settings/settings_video.xml:294',
    '20260829/panorama/layout/stats/playerstats_heatmap.xml:95',
    '20260829/panorama/layout/stats/playerstats_heatmap.xml:107',
    '20260829/panorama/layout/stats/playerstats_record.xml:138',
    '20260829/panorama/layout/stats/playerstats_record.xml:144',
    '20260829/panorama/layout/stats/playerstats_record.xml:150',
    '20260829/panorama/layout/teamselectmenu.xml:48',
    '20260829/panorama/layout/tournaments/predictions_group_stage.xml:81',
    '20260829/panorama/layout/tournaments/predictions_group_stage.xml:82',
    '20260829/panorama/layout/xpshop.xml:115',
    '20260716/layout/endofmatch.xml:49',
    '20260716/layout/endofmatch.xml:50',
    '20260716/layout/endofmatch.xml:53',
    '20260716/layout/endofmatch.xml:54',
    '20260716/layout/friendslist.xml:105',
    '20260716/layout/friendslist.xml:109',
    '20260716/layout/friendslist.xml:139',
    '20260716/layout/friendslist.xml:140',
    '20260716/layout/friendslist.xml:147',
    '20260716/layout/friendslist.xml:151',
    '20260716/layout/friendslist.xml:152',
    '20260716/layout/friendslist.xml:156',
    '20260716/layout/friendslist.xml:163',
    '20260716/layout/friendslist.xml:167',
    '20260716/layout/friendslist.xml:168',
    '20260716/layout/friendslist.xml:169',
    '20260716/layout/hud/huddemocontroller.xml:80',
    '20260716/layout/hud/hudvote.xml:14',
    '20260716/layout/hud/hudvote.xml:18',
    '20260716/layout/itemtile.xml:51',
    '20260716/layout/mainmenu.xml:83',
    '20260716/layout/mainmenu.xml:106',
    '20260716/layout/mainmenu.xml:123',
    '20260716/layout/mainmenu_play.xml:223',
    '20260716/layout/mainmenu_play.xml:227',
    '20260716/layout/mainmenu_play.xml:239',
    '20260716/layout/mainmenu_play.xml:243',
    '20260716/layout/mainmenu_play.xml:247',
    '20260716/layout/mainmenu_play.xml:331',
    '20260716/layout/mainmenu_watch_eventsched.xml:71',
    '20260716/layout/mapdraft.xml:87',
    '20260716/layout/mission_tile_mainmenu.xml:50',
    '20260716/layout/playercard.xml:39',
    '20260716/layout/playercard.xml:115',
    '20260716/layout/playercard.xml:119',
    '20260716/layout/playercard.xml:123',
    '20260716/layout/popups/popup_accept_match.xml:61',
    '20260716/layout/popups/popup_capability_can_keychain.xml:39',
    '20260716/layout/popups/popup_capability_can_patch.xml:37',
    '20260716/layout/popups/popup_capability_can_sticker.xml:46',
    '20260716/layout/popups/popup_capability_decodable.xml:140',
    '20260716/layout/popups/popup_inspect_async-bar.xml:37',
    '20260716/layout/popups/popup_inspect_rental-bar.xml:27',
    '20260716/layout/popups/popup_inspect_rental-bar.xml:39',
    '20260716/layout/popups/popup_inspect_rental-bar.xml:47',
    '20260716/layout/popups/popup_inspect_rental-bar.xml:54',
    '20260716/layout/popups/popup_inventory_inspect.xml:48',
    '20260716/layout/popups/popup_inventory_inspect.xml:49',
    '20260716/layout/popups/popup_major_store.xml:378',
    '20260716/layout/popups/popup_major_store.xml:379',
    '20260716/layout/popups/popup_major_store.xml:387',
    '20260716/layout/popups/popup_major_store.xml:388',
    '20260716/layout/popups/popup_major_store.xml:391',
    '20260716/layout/popups/popup_major_store.xml:392',
    '20260716/layout/popups/popup_major_store.xml:395',
    '20260716/layout/popups/popup_major_store.xml:396',
    '20260716/layout/popups/popup_major_store.xml:399',
    '20260716/layout/popups/popup_major_store.xml:400',
    '20260716/layout/popups/popup_offers_laptop_interface.xml:164',
    '20260716/layout/popups/popup_offers_laptop_interface.xml:167',
    '20260716/layout/popups/popup_shopping_cart_checkout.xml:135',
    '20260716/layout/popups/popup_shopping_cart_checkout.xml:140',
    '20260716/layout/popups/popup_shopping_cart_checkout.xml:152',
    '20260716/layout/popups/popup_tournament_journal.xml:66',
    '20260716/layout/retakeloadout.xml:38',
    '20260716/layout/retakeloadout.xml:41',
    '20260716/layout/retakeloadout.xml:44',
    '20260716/layout/scoreboard.xml:387',
    '20260716/layout/scoreboard.xml:391',
    '20260716/layout/scoreboard.xml:396',
    '20260716/layout/scoreboard.xml:400',
    '20260716/layout/settings/settings_audio.xml:186',
    '20260716/layout/settings/settings_audio.xml:187',
    '20260716/layout/settings/settings_audio.xml:188',
    '20260716/layout/settings/settings_audio.xml:195',
    '20260716/layout/settings/settings_audio.xml:196',
    '20260716/layout/settings/settings_audio.xml:197',
    '20260716/layout/settings/settings_audio.xml:198',
    '20260716/layout/settings/settings_audio.xml:205',
    '20260716/layout/settings/settings_audio.xml:206',
    '20260716/layout/settings/settings_audio.xml:207',
    '20260716/layout/settings/settings_audio.xml:208',
    '20260716/layout/settings/settings_audio.xml:215',
    '20260716/layout/settings/settings_audio.xml:216',
    '20260716/layout/settings/settings_audio.xml:217',
    '20260716/layout/settings/settings_audio.xml:218',
    '20260716/layout/settings/settings_game.xml:206',
    '20260716/layout/settings/settings_game.xml:207',
    '20260716/layout/settings/settings_game.xml:724',
    '20260716/layout/settings/settings_game.xml:725',
    '20260716/layout/settings/settings_game.xml:845',
    '20260716/layout/settings/settings_game.xml:846',
    '20260716/layout/settings/settings_game.xml:847',
    '20260716/layout/settings/settings_kbmouse.xml:264',
    '20260716/layout/settings/settings_kbmouse.xml:265',
    '20260716/layout/settings/settings_kbmouse.xml:268',
    '20260716/layout/settings/settings_kbmouse.xml:269',
    '20260716/layout/settings/settings_kbmouse.xml:272',
    '20260716/layout/settings/settings_kbmouse.xml:273',
    '20260716/layout/settings/settings_kbmouse.xml:276',
    '20260716/layout/settings/settings_kbmouse.xml:277',
    '20260716/layout/settings/settings_kbmouse.xml:280',
    '20260716/layout/settings/settings_kbmouse.xml:281',
    '20260716/layout/settings/settings_kbmouse.xml:284',
    '20260716/layout/settings/settings_kbmouse.xml:285',
    '20260716/layout/settings/settings_kbmouse.xml:288',
    '20260716/layout/settings/settings_kbmouse.xml:289',
    '20260716/layout/settings/settings_video.xml:29',
    '20260716/layout/settings/settings_video.xml:293',
    '20260716/layout/settings/settings_video.xml:294',
    '20260716/layout/stats/playerstats_heatmap.xml:95',
    '20260716/layout/stats/playerstats_heatmap.xml:107',
    '20260716/layout/stats/playerstats_record.xml:138',
    '20260716/layout/stats/playerstats_record.xml:144',
    '20260716/layout/stats/playerstats_record.xml:150',
    '20260716/layout/teamselectmenu.xml:48',
    '20260716/layout/tournaments/predictions_group_stage.xml:81',
    '20260716/layout/tournaments/predictions_group_stage.xml:82',
    '20260716/layout/xpshop.xml:115',
  ],

};

/** topMessages 钉多少条 */
const TOP_N = 10;

/**
 * 「命中数非零、但逐 file:line 钉位置钉的是症状而不是缺陷」的规则，改钉形状。
 *
 * 进这张表**不免除 EXPECTED 里的精确数字**（那条一点没松：数量一变立刻红），
 * 免除的只是 PINNED 那张逐条位置表。进表的门槛是下面两个字段都得填实：
 *
 * - `reason`：查了什么、结论是什么（为什么逐条钉位置钉的是症状）
 * - `evidence`：**独立于本语料**的证据。这一条是关键——只在归档语料上论证
 *   「这些命中不是缺陷」是循环论证，必须拿出语料之外的观测。两者都被下面
 *   「reason / evidence 必须填实」那条断言强制非空，否则这张表会退化成
 *   「数字对不上就往这里塞」的逃生舱。
 *
 * 钉的形状是两个轴，会被不同的回归打中：
 *
 * - `distinctMessages` + `topMessages`：按 `message` 聚合。每条 Diagnostic 都
 *   有 message 字段，因此这个聚合对任何规则都通用，不需要给每条规则写专门的
 *   抽取函数；而对 unknownClass 这条规则，message 里就带着类名，于是通用机制
 *   自动给出了最有诊断价值的那张名字分布表。符号抽取坏了 / class= 分词坏了 /
 *   索引合并坏了，都会改变这张分布。
 * - `distinctFiles`：命中散布在多少个文件里。保留它是因为两个轴不重合——命中
 *   全塌进一个文件时 message 分布可能一字不变，file 分布必然变。
 */
interface UnvalidatableShape {
  readonly reason: string;
  readonly evidence: string;
  /** 命中散布的文件数（绝对路径去重；同名文件在两个构建里算两个） */
  readonly distinctFiles: number;
  /** 不同 message 的个数（对 unknownClass 就是不同类名的个数） */
  readonly distinctMessages: number;
  /** 出现次数最多的 TOP_N 条 message 及其精确次数（次数降序，同次数按 message 升序） */
  readonly topMessages: readonly (readonly [string, number])[];
}

const UNVALIDATABLE: Partial<Record<RuleId, UnvalidatableShape>> = {
  'vxml.unknownClass': {
    reason:
      '793 处命中的根因是归档缺 CS2 引擎自带的核心/共享样式表，不是规则、索引或' +
      '判据的问题：(a) 用同一份两构建全量共享索引，不存在 include 链没跟全的问题；' +
      '(b) class= 的取值只可能是空白分隔的类名列表，没有 defineRefs 那种「候选 vs' +
      '引用」的位置歧义，判据没有可收紧的空间；(c) Task 4 评审用一份完全不 import' +
      '项目代码、且类名定义抽取故意写得比 src/core/index/symbols.ts 更宽（把 CSS' +
      '文本里任何 .标识符 都算成定义，含注释里与 @keyframes 块里的）的独立脚本重扫' +
      '两个构建 990 个文件，得到的仍然是 793 —— 这是真实未解析集合的下界，' +
      '说明索引不可能漏收。逐条钉死这 793 个 file:line 钉的是「这份归档缺哪些' +
      '样式表」这个症状：归档一更新全部漂移，而漂移本身不说明任何回归；850 行' +
      '噪音换一个「数量不变但位置漂移」的极小概率场景，对这条 hint 级规则不划算。',
    evidence:
      '独立于本语料的证据——一个真实的 CS2 addon 内容目录（9 xml / 13 css，' +
      '用户真正会打开的那种工作区）实测：XML 里用到 174 个去重类名，CSS' +
      '选择器位置定义了 713 个，未解析 0 个。也就是说这条规则在用户实际使用的' +
      '场景里完全安静，793 只在「按游戏内容打包、不含引擎核心样式」的归档上出现。' +
      '这同时否掉了「把默认级别改成 off」——那会为一个只在测试语料里吵的现象，' +
      '关掉它在生产环境的全部价值。默认级别维持 hint 不变。',
    distinctFiles: 202,
    distinctMessages: 182,
    // 次数降序、同次数按 message 升序。message 原文一并钉住：它是「形状」的
    // 一部分，改了措辞就该重新核一遍这张表。
    //
    // 分布形态本身也是上面 reason 的佐证：前 10 个名字覆盖 274/793（35%），
    // 而 fontWeight-light / text-letterspace-1px / fontWeight-medium /
    // colorize-teammate-color 这类**工具类形状**的名字占了头部——正是
    // 「引擎自带的核心/共享样式表没进这份归档」会留下的痕迹，不是随机噪音。
    topMessages: [
      ['类名 fontWeight-light 在索引中找不到定义', 64],
      ['类名 text-letterspace-1px 在索引中找不到定义', 38],
      ['类名 colorize-teammate-color 在索引中找不到定义', 34],
      ['类名 demoplayback-control-label 在索引中找不到定义', 34],
      ['类名 top 在索引中找不到定义', 20],
      ['类名 ExternalStreamButton 在索引中找不到定义', 18],
      ['类名 HUD--on-kill--listener 在索引中找不到定义', 18],
      ['类名 fontWeight-medium 在索引中找不到定义', 18],
      ['类名 visible-if-not-limitedbeta 在索引中找不到定义', 16],
      ['类名 pickem-group-pick--small 在索引中找不到定义', 14],
    ],
  },
};

/**
 * EXPECTED / PINNED / UNVALIDATABLE 是三张独立维护的表：「每条规则的命中数与
 * 钉死的期望完全一致」只查 EXPECTED，「允许非零的规则，其命中位置逐条对得上」
 * 只遍历 PINNED 自己已有的键，「形状与钉死的期望一致」只遍历 UNVALIDATABLE
 * 自己已有的键——如果某条规则在 EXPECTED 里填了非零期望，却两张表都没填，
 * 后两条测试对它都是 0 次迭代，三条测试全绿。此后即便命中位置发生漂移
 * （数量不变，命中换了文件或换了行），三条测试依旧全绿——这正是 D-M4-3
 * 「非零项必须逐 file:line 钉死」想堵住的场景，漏了这道绑定就形同虚设。
 *
 * Ruling 10 加了 UNVALIDATABLE 这张表，勾稽必须同步从双向扩成三向：只查
 * 「至少在一张表里」是不够的，还得查「**不能两张都在**」——同时填两张时，
 * 逐条位置表与形状表互为托底，谁都可以悄悄放宽而另一张仍绿，等于给
 * 「进不了 PINNED 就塞进 UNVALIDATABLE」开了一条静默旁路。恰好一张，
 * 才逼着每条非零规则明确表态自己用哪种钉法。
 *
 * 反过来的场景（PINNED 有条目但 EXPECTED 缺失或数量对不上、少钉/多钉）已经
 * 被那两条测试间接挡住：`counts.get(id)?.length` 不可能同时等于两个不同的数，
 * 不需要在这里重复检查。
 *
 * 这几条检查只读三张静态表本身，不碰真实语料，因此特意放在
 * `describe.skipIf(!ready)` 之外、无条件执行——本机没有归档时（例如 CI）也
 * 能挡住「填了 EXPECTED 却忘了填另外两张表」这个人为疏漏，不必等到有归档的
 * 机器上跑过一遍才发现。
 */
describe('EXPECTED / PINNED / UNVALIDATABLE 三向勾稽', () => {
  it('EXPECTED 的键集与 ALL_RULE_IDS 逐条相等——新增一条规则忘了进闸门必须变红', () => {
    // **交付时这道绑定不存在**（最终评审 M-5）：`ALL_RULE_IDS` 在这个文件里
    // 零命中。后果是将来加第 29 条规则时，只要它的语料命中恰好是 0 而又忘了往
    // EXPECTED 里加一行，**没有任何测试会提醒**——命中非 0 的会被下面那条
    // 「EXPECTED ∪ hits」的并集抓住，命中为 0 的则从并集里彻底消失。
    //
    // 而 EXPECTED 里 22 条为 0 的规则，闸门对它们的全部断言就是「一条都别报」，
    // 那句断言对「规则彻底死掉」同样成立。所以少一行 EXPECTED 不只是漏了记账，
    // 是这条新规则在语料层**完全没有闸门**。
    //
    // 两个方向都要：多出来的键（规则改名/删掉后 EXPECTED 没跟上）同样是账实
    // 不符，会让一条早已不存在的规则名一直挂在表里冒充覆盖。
    //
    // 与 types.test.ts:10 把 RULE_GROUP 绑到配置组是同一种手法：**让「表」与
    // 「真值来源」之间的每一处偏离都有东西看着**。
    const expectedKeys = Object.keys(EXPECTED) as RuleId[];
    const missing = ALL_RULE_IDS.filter((id) => !(id in EXPECTED));
    const extra = expectedKeys.filter((id) => !ALL_RULE_IDS.includes(id));
    expect(
      missing,
      `这些规则没有出现在语料闸门的 EXPECTED 里，语料层对它们零覆盖：${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      extra,
      `EXPECTED 里这些键不是真实的 RuleId（改名或删除后没跟上）：${extra.join(', ')}`,
    ).toEqual([]);
    // 数量也钉一次：上面两条都靠集合差，同时增删一对同名不同义的键理论上能对消。
    expect(expectedKeys).toHaveLength(ALL_RULE_IDS.length);
  });

  it('EXPECTED 里非零的规则，必须恰好落在 PINNED 与 UNVALIDATABLE 中的一张表里', () => {
    for (const id of Object.keys(EXPECTED) as RuleId[]) {
      if ((EXPECTED[id] ?? 0) > 0) {
        const where = [
          PINNED[id] !== undefined ? 'PINNED' : null,
          UNVALIDATABLE[id] !== undefined ? 'UNVALIDATABLE' : null,
        ].filter((s): s is string => s !== null);
        expect(
          where,
          `规则 ${id} 期望非零，必须恰好在 PINNED（逐条钉位置）与 UNVALIDATABLE（钉形状）` +
            `中的一张表里，实际落在：${where.length === 0 ? '（两张都没有）' : where.join(' + ')}`,
        ).toHaveLength(1);
      }
    }
  });

  it('UNVALIDATABLE 的每一条都必须填实 reason 与 evidence——否则这张表就成了逃生舱', () => {
    const entries = Object.entries(UNVALIDATABLE) as [RuleId, UnvalidatableShape][];
    for (const [id, u] of entries) {
      expect(u.reason.trim(), `规则 ${id} 的 UNVALIDATABLE.reason 是空的`).not.toBe('');
      expect(u.evidence.trim(), `规则 ${id} 的 UNVALIDATABLE.evidence 是空的`).not.toBe('');
      // 形状本身也得填实：三项全空等于什么都没钉。
      expect(u.topMessages.length, `规则 ${id} 的 topMessages 是空的`).toBeGreaterThan(0);
      expect(u.distinctMessages, `规则 ${id} 的 distinctMessages 没填`).toBeGreaterThan(0);
      expect(u.distinctFiles, `规则 ${id} 的 distinctFiles 没填`).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!ready)('诊断 · 990 文件语料回归', () => {
  /** 每条命中记一条：`where` 是 `绝对路径:行号`，`message` 是诊断原文 */
  interface Hit {
    readonly where: string;
    readonly message: string;
  }

  let xml: string[] = [];
  let css: string[] = [];
  const hits = new Map<RuleId, Hit[]>();

    /**
     * 同一批语料在英文目录下的条数。
     *
     * Messages 只产字符串、不产逻辑，所以两种 locale 下每条规则的条数必须逐个
     * 相等。不等就说明英文实现里混进了行为改动——EXPECTED 那张表单独查不出这个：
     * 它只钉中文那一遍的数字。
     */
    const hitsEn = new Map<RuleId, number>();
  const wheresOf = (id: RuleId) => (hits.get(id) ?? []).map((h) => h.where.replace(/\\/g, '/'));

  /**
   * 扫语料 + 跑全部规则，只做一次，结果放进 `hits` 供下面几条断言共用。
   *
   * 为什么必须是 `beforeAll`，而不是留在 describe 回调体里、也不是塞进某一条
   * `it` 里——两件事各自独立，交付时各中了一个：
   *
   * 1. **`describe.skipIf` 只跳过 `it`，回调体照常执行。** `walk()` 原本写在
   *    回调体里，于是**没有归档的机器（CI）在收集阶段就 ENOENT 崩**，整份
   *    文件一条都跑不了——包括那三条特意放在 `skipIf` 之外、注释里写着「CI
   *    上也能挡」的三向勾稽。那句注释当时没被实测，实际并不成立。`beforeAll`
   *    是套件的钩子，套件被 skip 时不执行，这才真的做到「有归档就跑、没归档
   *    就跳过，而无条件断言照常跑」。
   * 2. **`hits` 原本在「每条规则的命中数」那条 `it` 里填充，被另外两条消费。**
   *    于是那两条依赖执行顺序：单独跑（`-t` 过滤到其中一条）会拿到空 `hits`。
   *    **实测的后果是假红而不是假绿**——`got` 是空数组、`want` 是 44/10/244 条
   *    钉死位置，多重集比不上就报错「`vcss.clipThenCover` 的命中位置多重集与
   *    PINNED 对不上: expected [] to deeply equal [ …(10) ]」，形状表那条同理报
   *    「期望 64 次、实际 0 次」。也就是说这条测试在单独跑时**永远失败**，排查
   *    的人会去查规则而不是查测试。搬进 `beforeAll` 之后每条 `it` 都能独立跑。
   */
  beforeAll(() => {
    xml = ROOTS.flatMap((r) => walk(`${r}/layout`, '.xml'));
    css = ROOTS.flatMap((r) => walk(`${r}/styles`, '.css'));
    const index = buildWorkspaceIndex(xml, css);

    const record = (id: RuleId, where: string, message: string) => {
      const list = hits.get(id) ?? [];
      list.push({ where, message });
      hits.set(id, list);
    };

    const bump = (id: RuleId) => hitsEn.set(id, (hitsEn.get(id) ?? 0) + 1);
        const enPanels = PanelRegistry.load('en');
        const enProps = PropertyRegistry.load('en');

        for (const f of xml) {
          const text = readFileSync(f, 'utf8');
          const mode = layoutModeFor(f);
          for (const d of diagnoseVxml(parseVxml(text), { uri: f, mode, panels: gatePanels, observed: gateObserved, index, msg: ZH })) {
            record(d.ruleId, `${f}:${lineOf(text, d.start)}`, d.message);
          }
          for (const d of diagnoseVxml(parseVxml(text), { uri: f, mode, panels: enPanels, observed: gateObserved, index, msg: EN })) {
            bump(d.ruleId);
          }
        }
        for (const f of css) {
          const text = readFileSync(f, 'utf8');
          for (const d of diagnoseVcss(parseVcss(text), { uri: f, props, index, msg: ZH })) {
            record(d.ruleId, `${f}:${lineOf(text, d.start)}`, d.message);
          }
          for (const d of diagnoseVcss(parseVcss(text), { uri: f, props: enProps, index, msg: EN })) {
            bump(d.ruleId);
          }
        }
  });

  it('语料规模符合预期——文件数变了说明归档换了，数字得重新核', () => {
      expect(xml.length).toBe(540);
      expect(css.length).toBe(450);
    });

    /*
     * 本地化等价性：两种 locale 下每条规则的条数逐个相等。
     *
     * 这条与 EXPECTED 那张表互补。EXPECTED 钉的是「中文那一遍每条规则报几条」，
     * 对英文那一遍毫无约束；把 en 实现里某个判据写歪（比如 fix 里少了一个分支
     * 导致规则提前 return）不会让 EXPECTED 变红。这条钉的正是那一半。
     *
     * 断言逐条比而不是比总数：总数相等可能是两条规则一增一减抵消的结果。
     */
    it('两种 locale 下每条规则的条数完全相等——文案不该影响判定', () => {
      const ids = Object.keys(EXPECTED) as RuleId[];
      expect(ids.length, 'EXPECTED 是空的，本条会空转').toBeGreaterThanOrEqual(28);
      const diffs: string[] = [];
      for (const id of ids) {
        const zh = (hits.get(id) ?? []).length;
        const en = hitsEn.get(id) ?? 0;
        if (zh !== en) diffs.push(`${id}: zh-cn=${zh} en=${en}`);
      }
      expect(diffs, `以下规则在中英两版下条数不同：\n${diffs.join('\n')}`).toEqual([]);
    });

    /*
     * 英文那一遍确实跑出了东西——否则上面那条会以「两边都是 0」的形式空转通过。
     */
    it('英文那一遍确实产出了诊断', () => {
      const total = [...hitsEn.values()].reduce((a, b) => a + b, 0);
      expect(total, '英文跑批一条诊断都没产出，等价性断言会空转').toBeGreaterThanOrEqual(1000);
    });

  it('语料里没有任何文件进入 CustomHudLayout 严格模式——§10.3 那七个 0 的成因', () => {
    // EXPECTED 里 hud.* 的七个 0 不是「规则跑了没报」，是「规则压根没跑」。
    // 成因就在这一条：540 个布局没有一个匹配 `**/layout/custom_game/**`。
    // 把它显式钉出来，后来者才不会把那七个 0 读成覆盖（Task 9）。
    expect(xml.filter((f) => layoutModeFor(f) === 'customHudLayout')).toEqual([]);
  });

  it('每条规则的命中数与钉死的期望完全一致', () => {
    // 逐条对照，失败时把实际位置打出来——只报数字对不上，排查得从头扫一遍 990 个文件
    for (const id of new Set([...Object.keys(EXPECTED), ...hits.keys()]) as Set<RuleId>) {
      const want = EXPECTED[id] ?? 0;
      const got = hits.get(id)?.length ?? 0;
      expect(
        got,
        `规则 ${id} 期望 ${want} 次，实际 ${got} 次：\n${wheresOf(id).slice(0, 20).join('\n')}`,
      ).toBe(want);
    }
  });

  it('PINNED 的规则，其命中位置作为多重集逐条对得上', () => {
    for (const [id, want] of Object.entries(PINNED) as [RuleId, readonly string[]][]) {
      const got = wheresOf(id);
      /*
       * 多重集比较，而不是「want 每条都能在 got 里 endsWith 到 + 长度相等」。
       * 后者是**集合**语义：want 含重复项时会漏判——`want = [A, A, B]`、
       * `got = [A, B, C]` 两个条件都满足，照样全绿（Task 4 评审 M-2）。
       *
       * 麻烦在于两边不在同一个字母表上：got 是绝对路径
       * （`…/20260829/panorama/styles/x.css:39`），want 是后缀
       * （`20260829/panorama/styles/x.css:39`）。所以先把每个 got 归一成
       * 「它匹配到的那个 want 后缀」，再两边各自 sort() 后 toEqual。
       *
       * 归一用 endsWith('/' + w)：前面必须是路径分隔符，避免
       * `…/xxxstyles/a.css:1` 被 `styles/a.css:1` 认领——这比原来裸的
       * endsWith(w) 还严一点。一个 got 理论上可能同时匹配多个 want（当某个
       * want 恰好是另一个 want 的后缀时），取**最长**的那个使归一确定；这
       * 三张表里不存在这种情况，取最长只是让规则无歧义。匹配不上任何 want
       * 的 got 原样保留绝对路径，于是它必然与任何 want 不相等，sort + toEqual
       * 会把它当成「多出来的一条」原样打出来——正是想要的报错。
       */
      const canon = (g: string) => {
        let best = '';
        for (const w of want) if (g.endsWith(`/${w}`) && w.length > best.length) best = w;
        return best || g;
      };
      expect([...got].map(canon).sort(), `${id} 的命中位置多重集与 PINNED 对不上`).toEqual(
        [...want].sort(),
      );
    }
  });

  it('UNVALIDATABLE 的规则，其命中形状（message 分布 + 文件分布）与钉死的期望一致', () => {
    for (const [id, u] of Object.entries(UNVALIDATABLE) as [RuleId, UnvalidatableShape][]) {
      const list = hits.get(id) ?? [];

      const byMessage = new Map<string, number>();
      for (const h of list) byMessage.set(h.message, (byMessage.get(h.message) ?? 0) + 1);

      // 同次数时按 message 升序，保证 TOP_N 的切分是确定的（否则第 10 / 第 11
      // 名次数相同的时候这条断言会随 Map 插入顺序飘）。
      const top = [...byMessage.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, TOP_N);

      const files = new Set(list.map((h) => h.where.replace(/\\/g, '/').replace(/:\d+$/, '')));

      // 逐条差异，不是「形状不匹配」这种摘要——失败时要能直接拿着类名去 grep。
      const diff: string[] = [];
      for (const [msg, n] of u.topMessages) {
        const got = byMessage.get(msg) ?? 0;
        if (got !== n) diff.push(`  期望 ${n} 次、实际 ${got} 次：${msg}`);
      }
      for (const [msg, n] of top) {
        if (!u.topMessages.some(([m]) => m === msg)) {
          diff.push(`  实际排进前 ${TOP_N}（${n} 次）但期望表里没有：${msg}`);
        }
      }
      expect(diff.join('\n'), `${id} 的 topMessages 与期望不符：\n${diff.join('\n')}`).toBe('');

      expect(byMessage.size, `${id} 的 distinctMessages 期望 ${u.distinctMessages}`).toBe(
        u.distinctMessages,
      );
      expect(files.size, `${id} 的 distinctFiles 期望 ${u.distinctFiles}`).toBe(u.distinctFiles);
    }
  });
});

/**
 * 挖掘口径在测试侧的**独立重写**。故意不 import
 * `tools/mine-vxml-attributes.mts` 的 `mineObservations`——那样两边会共用同一段
 * 实现，下面两条断言就退化成「同一个函数两次调用结果相同」这种同义反复，正是
 * Ruling 16 要求换掉的那种恒真断言。这里只依赖 `parseVxml` + `PanelRegistry`
 * 这两个已被各自的单元测试覆盖的公共组件，口径逐条对照 brief 重写一遍：
 *
 * - 结构标签整个跳过，只往下走子树（`<snippet>` 里装着真面板，不能连子树一起丢）
 * - 标签不在 `panels.json` 里 → 记标签，**不记它的属性**
 * - 标签认识、属性不在该面板属性集里 → 记属性
 * - `data-*` / `on*` 一律不记（规则层的通用豁免，不逐个枚举进数据文件）
 *
 * 口径若与挖掘脚本分叉，下面的断言立刻红——这正是想要的：两份独立实现互为
 * 交叉验证，而不是互为背书。
 */
const GAP_STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  'include',
  'root',
  'scripts',
  'snippet',
  'snippets',
  'styles',
]);
const GAP_EXCLUDED_ATTR_PREFIXES: readonly string[] = ['data-', 'on'];

interface XsdGap {
  /** 标签 -> 次数 */
  readonly tags: Map<string, number>;
  /** 标签 -> 属性 -> 次数 */
  readonly attributes: Map<string, Map<string, number>>;
}

function eachElement(els: readonly VxmlElement[], visit: (el: VxmlElement) => void): void {
  for (const el of els) {
    visit(el);
    eachElement(el.children, visit);
  }
}

function xsdGapOf(files: readonly string[], panels: PanelRegistry): XsdGap {
  const gap: XsdGap = { tags: new Map(), attributes: new Map() };
  for (const f of files) {
    eachElement(parseVxml(readFileSync(f, 'utf8')).roots, (el) => {
      if (GAP_STRUCTURAL_TAGS.has(el.tag)) return;
      if (!panels.has(el.tag)) {
        gap.tags.set(el.tag, (gap.tags.get(el.tag) ?? 0) + 1);
        return;
      }
      const known = new Set(panels.attributesOf(el.tag));
      for (const attr of el.attributes) {
        if (GAP_EXCLUDED_ATTR_PREFIXES.some((p) => attr.name.startsWith(p))) continue;
        if (known.has(attr.name)) continue;
        const perTag = gap.attributes.get(el.tag) ?? new Map<string, number>();
        perTag.set(attr.name, (perTag.get(attr.name) ?? 0) + 1);
        gap.attributes.set(el.tag, perTag);
      }
    });
  }
  return gap;
}

/**
 * Ruling 16 第 4 条：把「`vxml.unknownAttribute` 期望 0」那句同义反复换成一条
 * 真有内容的**数据**不变量——断言观测数据文件与语料的 XSD 缺口**恰好相等**：
 *
 * - (a) 语料里**每一处**不在 XSD 属性集内的属性使用，都能在观测层里查到
 *       （漏了就是压制层有洞，Task 7 会对着 Valve 自己出货的写法报 hint）
 * - (b) 观测层里**没有一条是语料里用不上的**（有则说明数据陈旧或挖宽了）
 * - 标签同理
 *
 * 断言的对象是**数据**而不是规则：挖掘脚本坏了、数据文件漂了、`panels.json`
 * 重新生成后属性集变了，都会在这里变红。它是真能失败的，与那条构造性恒真的
 * 「期望 0」不同。
 *
 * **遍历两个构建**：数据从 20260829 挖，用 829 + 716 合计校验。(b) 那半边的
 * 「用不上」必须以两构建合计为准——只拿 20260716 校验的话，只在 829 里出现的
 * `ToggleButton@series-button`（3 次）与标签 `CSGOInfoHudLayouts` 会被误判成
 * 多余而删掉，压制层就此缺一块。
 */
describe.skipIf(!ready)('观测属性层 == 语料的 XSD 缺口（Ruling 16 的数据不变量）', () => {
  // 这两份是出货数据，不碰归档，留在回调体里没问题。
  const panels = PanelRegistry.load('zh-cn');
  const observed = ObservedAttributes.load();

  /** 逐构建的缺口；索引与 BUILDS / ROOTS 对齐 */
  let perBuild: XsdGap[] = [];
  /** 两构建合计的缺口，只留「出现过」这个事实（次数按构建各算各的，见下面第三条） */
  let allTags = new Set<string>();
  let allAttrs = new Set<string>();

  // 与上面那个套件同一个理由：`describe.skipIf` 不拦回调体，`walk()` 留在
  // 这里会让没有归档的机器在收集阶段 ENOENT 崩掉整份文件。
  beforeAll(() => {
    perBuild = ROOTS.map((r) => xsdGapOf(walk(`${r}/layout`, '.xml'), panels));
    allTags = new Set(perBuild.flatMap((g) => [...g.tags.keys()]));
    allAttrs = new Set(
      perBuild.flatMap((g) => [...g.attributes].flatMap(([t, m]) => [...m.keys()].map((a) => `${t}@${a}`))),
    );
  });

  it('语料里确实存在 XSD 缺口——不变量不能在空集上空过', () => {
    expect(allTags.size).toBeGreaterThan(0);
    expect(allAttrs.size).toBeGreaterThan(0);
    // 两个构建各自都得非空，否则某个构建的路径探测坏掉也能全绿
    for (const [i, g] of perBuild.entries()) {
      expect(g.attributes.size, `${BUILDS[i]} 的缺口是空的，路径或解析出了问题`).toBeGreaterThan(0);
    }
  });

  it('(a) 语料里每一处 XSD 缺口都能在观测层里查到', () => {
    const missingTags = [...allTags].filter((t) => !observed.hasTag(t)).sort();
    expect(missingTags, '语料里用了这些标签，观测层却查不到——压制层有洞').toEqual([]);

    const missingAttrs = [...allAttrs]
      .filter((k) => {
        const at = k.lastIndexOf('@');
        return !observed.has(k.slice(0, at), k.slice(at + 1));
      })
      .sort();
    expect(missingAttrs, '语料里用了这些属性，观测层却查不到——压制层有洞').toEqual([]);
  });

  it('(b) 观测层里没有一条是语料里用不上的', () => {
    const staleTags = Object.keys(rawObserved.tags)
      .filter((t) => !allTags.has(t))
      .sort();
    expect(staleTags, '观测层里这些标签在两个构建的语料里都用不上——数据陈旧或挖宽了').toEqual([]);

    const staleAttrs: string[] = [];
    for (const [tag, attrs] of Object.entries(rawObserved.attributes)) {
      for (const attr of Object.keys(attrs)) {
        if (!allAttrs.has(`${tag}@${attr}`)) staleAttrs.push(`${tag}@${attr}`);
      }
    }
    expect(
      staleAttrs.sort(),
      '观测层里这些属性在两个构建的语料里都用不上——数据陈旧或挖宽了',
    ).toEqual([]);
  });

  /**
   * 上面两条是集合等价，只查「有没有」。这条再把**次数**钉上：数据文件是从
   * `minedFrom` 那一个构建挖的，它记的次数必须与该构建的缺口逐条相等。计数
   * 逻辑坏掉（漏走子树、同一元素的重复属性只算一次、把两个构建混着数）在集合
   * 层面看不出来，在这里会整片变红。
   */
  it('数据文件记的次数与挖掘源构建的缺口逐条相等', () => {
    const idx = BUILDS.indexOf(rawObserved.minedFrom);
    expect(idx, `数据文件声明的 minedFrom=${rawObserved.minedFrom} 不在 BUILDS 里`).toBeGreaterThanOrEqual(0);
    const src = perBuild[idx];

    const diff: string[] = [];
    for (const [tag, want] of Object.entries(rawObserved.tags)) {
      const got = src.tags.get(tag) ?? 0;
      if (got !== want) diff.push(`  标签 ${tag}：数据文件 ${want} 次、语料 ${got} 次`);
    }
    for (const [tag, got] of src.tags) {
      if (!Object.hasOwn(rawObserved.tags, tag)) diff.push(`  标签 ${tag}：数据文件没有，语料 ${got} 次`);
    }
    for (const [tag, attrs] of Object.entries(rawObserved.attributes)) {
      for (const [attr, want] of Object.entries(attrs)) {
        const got = src.attributes.get(tag)?.get(attr) ?? 0;
        if (got !== want) diff.push(`  ${tag}@${attr}：数据文件 ${want} 次、语料 ${got} 次`);
      }
    }
    for (const [tag, m] of src.attributes) {
      for (const [attr, got] of m) {
        const has = Object.hasOwn(rawObserved.attributes, tag)
          ? Object.hasOwn(rawObserved.attributes[tag as keyof typeof rawObserved.attributes], attr)
          : false;
        if (!has) diff.push(`  ${tag}@${attr}：数据文件没有，语料 ${got} 次`);
      }
    }

    expect(diff.join('\n'), `观测数据与 ${rawObserved.minedFrom} 的缺口次数对不上：\n${diff.join('\n')}`).toBe('');
  });
});

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}
