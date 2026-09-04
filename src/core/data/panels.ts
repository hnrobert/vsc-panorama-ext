import type { Locale } from '../i18n/locale';
import rawPanelData from '../../../data/panels.json';
import zhAttributeDocs from '../../../data/attribute-docs.zh-cn.json';

export interface PanelInfo {
  /** 直接父类型；基础 Panel 为 null */
  readonly derivedFrom: string | null;
  /** 该面板属性的声明者集合名，实际属性 = 各集合的并集 */
  readonly sets: readonly string[];
  /** true 表示只能作根面板，不能作嵌套子元素（43 种） */
  readonly rootOnly: boolean;
}

export interface PanelData {
  readonly attributeSets: Readonly<Record<string, readonly string[]>>;
  readonly attributeDocs: Readonly<Record<string, string>>;
  readonly panels: Readonly<Record<string, PanelInfo>>;
}

const EMPTY: readonly string[] = Object.freeze([]);

/**
 * 英文直接用 panels.json 里 Valve 的原文；中文取 sidecar。
 *
 * 走 sidecar 而不是把译文写进 panels.json，是因为那个文件由
 * tools/gen-panel-data.mjs 从 XSD 全量重建（:96 处 attributeDocs[attrName] = desc），
 * 译文写进去会在下次 npm run gen:panels 时被无声抹掉。
 *
 * sidecar 缺条目时回落英文而不是抛异常：本地化不完整不该让扩展起不来，
 * 「缺哪几条」由 test/unit/core/data/panels-i18n.test.ts 在开发期咬住。
 */
function resolveDocs(locale: Locale): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const zh = zhAttributeDocs.docs as Record<string, string>;
  for (const [attr, enDoc] of Object.entries(rawPanelData.attributeDocs)) {
    out[attr] =
      locale === 'zh-cn' && Object.hasOwn(zh, attr) ? zh[attr] : (enDoc as string);
  }
  return out;
}

export class PanelRegistry {
  /** attributesOf 的结果按面板名缓存——补全会高频调用 */
  private readonly attrCache = new Map<string, readonly string[]>();
  private readonly data: PanelData;

  private constructor(data: PanelData) {
    this.data = data;
  }

  /**
   * locale 不给默认值：漏传即编译错误，而不是让英文用户静默收到中文。
   * 与 PropertyRegistry.load 同理。
   */
  static load(locale: Locale): PanelRegistry {
    const raw = rawPanelData as unknown as PanelData;
    return new PanelRegistry({ ...raw, attributeDocs: resolveDocs(locale) });
  }

  /** 供测试注入自定义数据 */
  static from(data: PanelData): PanelRegistry {
    return new PanelRegistry(data);
  }

  has(panel: string): boolean {
    return Object.hasOwn(this.data.panels, panel);
  }

  /**
   * 直接用 [] 索引一个不存在的 key 会顺着原型链拿到 Object.prototype 上的
   * 同名成员（如 'constructor' / '__proto__' / 'toString'）—— 那些是函数或
   * 内建对象，不是 PanelInfo，一旦被当成数据用（如 `for (const x of info.sets)`）
   * 就会抛异常。get / attributesOf / declarerOf 统一经这里过一遍 has()，
   * 保证不存在的面板名永远只得到 undefined。
   */
  get(panel: string): PanelInfo | undefined {
    return this.has(panel) ? this.data.panels[panel] : undefined;
  }

  attributesOf(panel: string): readonly string[] {
    const cached = this.attrCache.get(panel);
    if (cached) return cached;

    const info = this.get(panel);
    if (!info) return EMPTY;

    const merged = new Set<string>();
    for (const setName of info.sets) {
      for (const attr of this.data.attributeSets[setName] ?? EMPTY) merged.add(attr);
    }

    const result = Object.freeze([...merged].sort());
    this.attrCache.set(panel, result);
    return result;
  }

  hasAttribute(panel: string, attr: string): boolean {
    return this.attributesOf(panel).includes(attr);
  }

  /**
   * 真正声明该属性的类型。
   * 不能用 attributesOf(setName) 代替——那返回的是并集，
   * 查 Label 的 id 会错误地得到 Label 而不是 Panel。
   */
  declarerOf(panel: string, attr: string): string | undefined {
    const info = this.get(panel);
    if (!info) return undefined;
    return info.sets.find((s) => (this.data.attributeSets[s] ?? EMPTY).includes(attr));
  }

  /** 加 hasOwn 守卫，与 has() 同理：裸 [] 索引会让 'toString' 返回一个函数 */
  docFor(attr: string): string | undefined {
    return Object.hasOwn(this.data.attributeDocs, attr)
      ? this.data.attributeDocs[attr]
      : undefined;
  }

  /** 全部 245 种——也正是根面板位置可用的集合 */
  allPanels(): readonly string[] {
    return Object.keys(this.data.panels);
  }

  /** 202 种：可作嵌套子元素 */
  childPanels(): readonly string[] {
    return this.allPanels().filter((p) => !this.data.panels[p].rootOnly);
  }

  /** 43 种：只能作根面板 */
  rootOnlyPanels(): readonly string[] {
    return this.allPanels().filter((p) => this.data.panels[p].rootOnly);
  }
}
