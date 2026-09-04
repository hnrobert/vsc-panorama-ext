# CS2 Panorama (VXML / VCSS)

Language support for Counter-Strike 2's Panorama UI — layout (`.xml` / `.vxml`) and style
(`.css` / `.vcss`) files.

*[中文说明见下](#中文)*

---

## Why this exists

Panorama files are named `.xml` and `.css`, so VS Code treats them as HTML-ish XML and web CSS.
That is wrong in a way that actively misleads you: **Panorama looks like CSS but is not CSS.**

```css
/* What the built-in CSS support tells you is fine — and Panorama silently ignores */
display: flex;                    /* there is no display in Panorama */
position: absolute;               /* position is an x y z offset, not a layout model */
width: 50vw;                      /* no viewport units */
--brand: #fff;                    /* no custom properties; Panorama has @define */
transition: width 0.5s ease-out;  /* shorthands are never expanded — the whole line dies */

/* What the built-in CSS support flags as an error — and Panorama requires */
flow-children: right;
box-shadow: #000000ff 0px 2px 4px 0px;   /* color comes FIRST */
width: fill-parent-flow(1);
background-color: gradient(linear, 0% 0%, 0% 100%, from(#000), to(#fff));
```

This extension replaces that layer with support for the **actual** Panorama language.

## Features

**Completion** — 245 panel types with inheritance-aware attribute sets, VCSS properties and
their value domains, Panorama functions (`fill-parent-flow`, `gradient`, `gaussian`, `radial`…),
at-rules, pseudo-classes, and `{s:}` dialog-variable bindings.

**Cross-file intelligence** — a workspace index gives you `class=` completion drawn from every
stylesheet in the workspace, go-to-definition and find-references for class names, `@define`
constants and `@keyframes`, plus segment-by-segment completion for `src="s2r://…"` paths with
existence checking.

**Hover** — every panel type, attribute and property carries documentation, including what the
Web equivalent would have been and why Panorama differs.

**Diagnostics** — 28 rules across three tiers, each with a concrete replacement rather than just
"this is wrong":

| Tier | Examples |
|---|---|
| Provably wrong (`warning`) | Web-only properties, `position: absolute`, `vw`/`vh`/`em`/`rem`, `::before`, `visibility: hidden`, `--custom-props`, unquoted `@keyframes` names, color-last `box-shadow` |
| Not in the known list (`hint`) | Unrecognised property, value or class name — capped at `hint` because the data is hand-curated and provably incomplete |
| Structure (`warning`) | Unknown tags, `rootOnly` panels in a nested position, an `id` on the root panel, `<styles>`/`<scripts>`/`<snippets>` ordering, unclosed tags, duplicate ids |

**Color decorators** for Panorama's 8-digit `#RRGGBBAA`, which standard CSS tooling does not
recognise.

**Snippets** and a **TextMate grammar** tuned to Panorama rather than to web CSS.

## Two modes

The extension recognises that custom game HUDs run under a far stricter subset.

| | Full Panorama | CustomHudLayout |
|---|---|---|
| When | everything else | paths matching `**/layout/custom_game/**` |
| Panel types | 245 (202 usable as nested children, 43 root-only) | `Panel` / `Label` / `Image` / `Button` |
| Attributes | full inheritance-resolved sets | a per-panel whitelist |
| `<scripts>`, snippets, `<Frame>` | available | unavailable, reported as `error` |
| Bindings | `{s:}` `{d:}` `{g:}` `{t:}` | `{s:}` only |
| Styling | unrestricted | unrestricted — the whitelist governs layout, not VCSS |

Completion and diagnostics always agree on the mode, so you are never offered something that is
then flagged.

## File recognition

| Language | Recognised by |
|---|---|
| `panorama-vxml` | `**/panorama/**/layout/**/*.xml`, or any `.vxml` |
| `panorama-vcss` | `**/panorama/**/styles/**/*.css`, or any `.vcss` |

The `.vxml` / `.vcss` extensions are always recognised regardless of path, which is the escape
hatch if your layout lives somewhere unusual.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `panorama.customHudLayout.include` | `["**/layout/custom_game/**"]` | Which layouts get the strict whitelist |
| `panorama.contentRoots` | `[]` | Explicit roots for `s2r://` resolution; empty means auto-detect |
| `panorama.index.enabled` | `true` | Turn off to drop back to single-file behaviour |
| `panorama.index.exclude` | `[]` | Extra globs to skip while indexing |
| `panorama.diagnostics.webOnlySyntax` | `warning` | Web-only CSS constructs |
| `panorama.diagnostics.unknownProperty` | `hint` | Property or value not in the known list |
| `panorama.diagnostics.unknownClass` | `hint` | `class=` name with no definition in the workspace |
| `panorama.diagnostics.unresolvedReference` | `warning` | Unresolvable `@define` / `@keyframes` |
| `panorama.diagnostics.duplicateId` | `hint` | Duplicate `id` within one scope |
| `panorama.diagnostics.structure` | `warning` | VXML structural problems |
| `panorama.diagnostics.customHudWhitelist` | `error` | Strict-mode whitelist violations |

Every diagnostic group can also be set to `off`.

## Language

All messages ship in **English and Simplified Chinese**, selected automatically from VS Code's
display language. There is no separate setting: `zh-cn` / `zh-tw` / `zh-hk` get Chinese,
everything else gets English.

## Not affiliated with Valve

This is an unofficial community tool. Counter-Strike, Source 2 and Panorama are trademarks of
Valve Corporation. See [LICENSE](LICENSE) for the full notice.

---

<a name="中文"></a>

# 中文

Counter-Strike 2 的 Panorama UI 语言支持——布局（`.xml` / `.vxml`）与样式（`.css` / `.vcss`）。

## 为什么需要它

Panorama 的文件后缀就是 `.xml` 和 `.css`，于是 VS Code 把它们当成 HTML 系的 XML 和 Web CSS。
这不只是「支持得不好」，而是**会主动把你带偏**——Panorama 长得像 CSS，但不是 CSS：

```css
/* 内置 CSS 支持说没问题，而 Panorama 会静默忽略 */
display: flex;                    /* Panorama 没有 display */
position: absolute;               /* position 是 x y z 三轴偏移，不是定位模型 */
width: 50vw;                      /* 没有视口单位 */
--brand: #fff;                    /* 没有自定义属性，Panorama 用 @define */
transition: width 0.5s ease-out;  /* 简写从不展开——整行静默失效 */

/* 内置 CSS 支持报错，而 Panorama 要求这么写 */
flow-children: right;
box-shadow: #000000ff 0px 2px 4px 0px;   /* 颜色在最前面 */
width: fill-parent-flow(1);
background-color: gradient(linear, 0% 0%, 0% 100%, from(#000), to(#fff));
```

本扩展把那一层换成对**真正的 Panorama 语言**的支持。

## 能力

**补全**——245 种面板类型（属性集按继承链解析）、VCSS 属性及其取值域、Panorama 专属函数
（`fill-parent-flow`、`gradient`、`gaussian`、`radial`…）、at-rule、伪类，以及 `{s:}` 系列
dialog 变量绑定。

**跨文件**——工作区索引让 `class=` 的候选来自工作区里所有样式表；类名、`@define` 常量、
`@keyframes` 都能跳转定义与查找引用；`src="s2r://…"` 支持逐段路径补全并校验存在性。

**悬停**——每个面板类型、属性、CSS 属性都带文档，包括「Web 里对应的写法是什么」以及
Panorama 为什么不一样。

**诊断**——28 条规则分三档，每条都给出**替代写法**而不只是说「这样不行」：

| 档位 | 举例 |
|---|---|
| 能证明是错的（`warning`） | Web 独有属性、`position: absolute`、`vw`/`vh`/`em`/`rem`、`::before`、`visibility: hidden`、`--自定义属性`、`@keyframes` 名字没加引号、`box-shadow` 颜色写在后面 |
| 只是没见过（`hint`） | 属性 / 取值 / 类名不在已知清单里——清单是人工整理且已被证明不全，所以级别最高只到 hint |
| 结构（`warning`） | 未知标签、rootOnly 面板出现在嵌套位置、根面板带 `id`、`<styles>`/`<scripts>`/`<snippets>` 顺序、标签未闭合、id 重复 |

**取色器**认得 Panorama 的八位 `#RRGGBBAA`——标准 CSS 工具认不出这种写法。

**代码片段**与专为 Panorama 调过的 **TextMate 语法**，不是拿 Web CSS 的凑合。

## 两种模式

自定义游戏 HUD 跑在一个严格得多的子集上，扩展会自动区分。

| | 完整 Panorama | CustomHudLayout |
|---|---|---|
| 何时 | 其余一切 | 路径匹配 `**/layout/custom_game/**` |
| 面板类型 | 245 种（202 种可作嵌套子元素，43 种只能作根） | `Panel` / `Label` / `Image` / `Button` |
| 属性 | 按继承解析的完整属性集 | 逐面板的白名单 |
| `<scripts>`、片段、`<Frame>` | 可用 | 不可用，报 `error` |
| 绑定 | `{s:}` `{d:}` `{g:}` `{t:}` | 只有 `{s:}` |
| 样式 | 不受限 | 同样不受限——白名单管的是布局属性，VCSS 全套能力都可用 |

补全与诊断永远用同一个模式判定，所以不会出现「补全给了你、诊断又骂你」。

## 文件识别

| 语言 | 识别方式 |
|---|---|
| `panorama-vxml` | `**/panorama/**/layout/**/*.xml`，或任意 `.vxml` |
| `panorama-vcss` | `**/panorama/**/styles/**/*.css`，或任意 `.vcss` |

`.vxml` / `.vcss` 后缀无条件识别，不看路径——布局放在非常规位置时用这个兜底。

## 配置

见上方英文表格；每个诊断分组都可以设成 `off`。

## 语言

全部文案都有**英文与简体中文**两版，按 VS Code 的显示语言自动选择，不需要单独设置：
`zh-cn` / `zh-tw` / `zh-hk` 给中文，其余给英文。

## 与 Valve 无关联

这是非官方的社区工具。Counter-Strike、Source 2、Panorama 是 Valve Corporation 的商标。
完整声明见 [LICENSE](LICENSE)。
