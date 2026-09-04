import { describe, it, expect } from 'vitest';
import { EN, ZH } from '../../../helpers/i18n';
import { parseVxml } from '../../../../src/core/vxml/parser';
import { parseVcss } from '../../../../src/core/vcss/parser';
import { symbolsOfVxml, symbolsOfVcss } from '../../../../src/core/index/symbols';
import { WorkspaceIndex } from '../../../../src/core/index/workspace-index';
import { diagnoseVcss, diagnoseVxml } from '../../../../src/core/diagnostics';
import { RULE_GROUP } from '../../../../src/core/diagnostics/types';
import type { RuleId, Diagnostic } from '../../../../src/core/diagnostics/types';
import { PropertyRegistry } from '../../../../src/core/data/properties';
import { PanelRegistry } from '../../../../src/core/data/panels';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import { ObservedValues } from '../../../../src/core/data/observed-values';
import { completeVcss, hoverVcss, symbolsVcss } from '../../../../src/core/features/vcss';
import { completeVxml, hoverVxml } from '../../../../src/core/features/vxml';
import { contextAt as vcssContextAt, hoverTargetAt as vcssHoverAt } from '../../../../src/core/vcss/context';
import { contextAt as vxmlContextAt, hoverTargetAt as vxmlHoverAt } from '../../../../src/core/vxml/context';

/*
 * 只用 CJK 区间 U+4E00–U+9FA5，不扩大到「所有非 ASCII」：文案里合法地含有
 * ⚠️(U+26A0) / ✅(U+2705) / ❌(U+274C) / …(U+2026) / →(U+2192)，扩大区间会把
 * 它们当成未翻译的残留误报。
 */
const CJK = /[一-龥]/;

const props = PropertyRegistry.load('en');
const panels = PanelRegistry.load('en');
const observed = ObservedAttributes.load();
const observedValues = ObservedValues.load();

const CSS_URI = '/p/panorama/styles/a.css';
const XML_URI = '/p/panorama/layout/a.xml';
const HUD_URI = '/p/panorama/layout/custom_game/a.xml';

function buildIndex(files: Record<string, string>): WorkspaceIndex {
  const known = new Set(Object.keys(files));
  const exists = (p: string) =>
    known.has(p) || [...known].some((f) => f.startsWith(p.replace(/\/$/, '') + '/'));
  const idx = new WorkspaceIndex({ exists });
  for (const [uri, text] of Object.entries(files)) {
    idx.update(
      uri.endsWith('.xml')
        ? symbolsOfVxml(uri, parseVxml(text))
        : symbolsOfVcss(uri, parseVcss(text)),
    );
  }
  return idx;
}

/** 只含占位内容的桩索引——三条跨文件规则要的是「索引存在」这个事实本身 */
const STUB_INDEX = buildIndex({ [CSS_URI]: '.placeholder\n{\n\twidth: 1px;\n}' });

interface Trigger {
  readonly lang: 'vcss' | 'vxml';
  readonly text: string;
  /**
   * 需要工作区索引才会触发。
   *
   * vcss.unknownDefine / vcss.unknownKeyframes / vxml.unknownClass 三条按设计
   * 在没有索引时**整条跳过**（见 diagnostics/index.ts 对 ctx.index 可选性的
   * 注释）——不配索引的话它们会以「产出为空」的形式静默通过本测试，而空产出
   * 恰好也不含汉字。这正是下面要求「至少产出一条」的同一类陷阱。
   */
  readonly needsIndex?: boolean;
  /** hud.* 七条只在严格模式（custom_game/ 路径）下触发 */
  readonly strict?: boolean;
}

/**
 * 每条规则配一段能触发它的最小输入。
 *
 * **这张表是本测试的承重件。** 下面第一条断言要求它覆盖全部 28 个 rule id——
 * 新增规则时绕不过这道门。只查「跑出来的诊断没有汉字」而不查覆盖面，会让一条
 * 没被触发的规则以「零产出」的形式静默通过。
 *
 * 用例来源：逐条取自各规则自己的单元测试正例，不是新编的。
 */
const TRIGGERS: Readonly<Record<RuleId, Trigger>> = {
  // ── 规格 §10.1 VCSS ──────────────────────────────────────────────────────
  'vcss.webOnlyProperty': { lang: 'vcss', text: '.a\n{\n\tdisplay: flex;\n}' },
  'vcss.positionKeyword': { lang: 'vcss', text: '.a\n{\n\tposition: absolute;\n}' },
  'vcss.webUnit': { lang: 'vcss', text: '.a\n{\n\twidth: 50vw;\n}' },
  'vcss.pseudoElement': { lang: 'vcss', text: '.a::before\n{\n\twidth: 1px;\n}' },
  'vcss.visibilityHidden': { lang: 'vcss', text: '.a\n{\n\tvisibility: hidden;\n}' },
  'vcss.customProperty': { lang: 'vcss', text: '.a\n{\n\t--brand: #fff;\n}' },
  'vcss.keyframesUnquoted': { lang: 'vcss', text: '@keyframes pulse\n{\n\t0%\n\t{\n\t\topacity: 0;\n\t}\n}' },
  'vcss.boxShadowColorFirst': { lang: 'vcss', text: '.a\n{\n\tbox-shadow: 0px 0px 4px 0px #000000ff;\n}' },
  'vcss.clipThenCover': { lang: 'vcss', text: '.a\n{\n\tbackground-size: clip_then_cover;\n}' },
  'vcss.unknownDefine': {
    lang: 'vcss',
    text: '.a\n{\n\tcolor: nonexistentConstant;\n}',
    needsIndex: true,
  },
  'vcss.unknownKeyframes': {
    lang: 'vcss',
    text: ".a\n{\n\tanimation-name: 'nonexistentFrames';\n}",
    needsIndex: true,
  },

  // ── 规格 §10.2 VCSS hint ─────────────────────────────────────────────────
  'vcss.unknownProperty': { lang: 'vcss', text: '.a\n{\n\tbogus-property: 1px;\n}' },
  /*
   * 语料实测的两种真实命中之一（vcss-hint.test.ts:189）。
   *
   * 先前这里写的是 `overflow: bogusKeyword`，实测被 vcss.unknownDefine 抢走了：
   * 那个取值是「裸标识符」，判据上更像 @define 引用。这类抢位正是下面「触发
   * 用例必须真的触发」那条断言要抓的东西——没有它，这条规则会以零产出静默通过。
   */
  'vcss.unknownValue': {
    lang: 'vcss',
    text: '.a\n{\n\thorizontal-align: middle;\n}',
    needsIndex: true,
  },

  // ── VXML ─────────────────────────────────────────────────────────────────
  'vxml.unknownTag': { lang: 'vxml', text: '<root><NotAPanelType /></root>' },
  'vxml.unknownAttribute': { lang: 'vxml', text: '<root><Panel bogusattr="1" /></root>' },
  'vxml.unknownClass': {
    lang: 'vxml',
    text: '<root><Panel class="nonexistentClass" /></root>',
    needsIndex: true,
  },
  'vxml.structure': { lang: 'vxml', text: '<root><include src="a" /><Panel /></root>' },
  'vxml.rootOnlyNested': { lang: 'vxml', text: '<root><Panel><PopupCustomLayout /></Panel></root>' },
  'vxml.rootPanelId': { lang: 'vxml', text: '<root><Panel id="x" /></root>' },
  'vxml.syntax': { lang: 'vxml', text: '<root><Panel class=bare /></root>' },
  'vxml.duplicateId': {
    lang: 'vxml',
    text: '<root><Panel><Label id="dup" /><Label id="dup" /></Panel></root>',
  },

  // ── 规格 §10.3 CustomHudLayout 严格模式（七条 error）─────────────────────
  'hud.panelNotAllowed': { lang: 'vxml', text: '<root><Slider /></root>', strict: true },
  // Panel 的白名单是 id / class / hittest（mode.ts:18）——先前这里用的 hittest
  // 恰好在白名单里，一条都不报。src 只属于 Image。
  'hud.attributeNotAllowed': {
    lang: 'vxml',
    text: '<root><Panel src="a.png" /></root>',
    strict: true,
  },
  'hud.buttonText': { lang: 'vxml', text: '<root><Button text="ok" /></root>', strict: true },
  'hud.scripts': { lang: 'vxml', text: '<root><scripts /><Panel /></root>', strict: true },
  'hud.inlineStyle': { lang: 'vxml', text: '<root><Panel style="width: 1px;" /></root>', strict: true },
  'hud.snippetsOrFrame': { lang: 'vxml', text: '<root><Panel><Frame /></Panel></root>', strict: true },
  'hud.binding': { lang: 'vxml', text: '<root><Label text="{g:score}" /></root>', strict: true },
};

function runTrigger(t: Trigger): Diagnostic[] {
  const index = t.needsIndex ? STUB_INDEX : undefined;
  if (t.lang === 'vcss') {
    return diagnoseVcss(parseVcss(t.text), { uri: CSS_URI, props, index, msg: EN });
  }
  return diagnoseVxml(parseVxml(t.text), {
    uri: t.strict ? HUD_URI : XML_URI,
    mode: t.strict ? 'customHudLayout' : 'full',
    panels,
    observed,
    index,
    msg: EN,
  });
}

describe('英文路径：全部 28 条规则的产出零汉字', () => {
  /*
   * 覆盖面断言。这条比下面每条规则的检查更重要——它保证的是「没有规则能绕过
   * 这道门」，而不是「已列出的规则没问题」。
   */
  it('触发表覆盖全部 28 个 rule id——缺一个就红', () => {
    const all = Object.keys(RULE_GROUP) as RuleId[];
    expect(all.length, 'RULE_GROUP 是空的，本组会空转').toBe(28);
    const missing = all.filter((id) => !Object.hasOwn(TRIGGERS, id));
    expect(missing, `以下规则没有触发用例：\n${missing.join('\n')}`).toEqual([]);
    const stale = Object.keys(TRIGGERS).filter((id) => !Object.hasOwn(RULE_GROUP, id));
    expect(stale, `触发表里有已不存在的规则：\n${stale.join('\n')}`).toEqual([]);
  });

  for (const [ruleId, t] of Object.entries(TRIGGERS) as Array<[RuleId, Trigger]>) {
    it(`${ruleId} 的英文产出无汉字且非空`, () => {
      const diags = runTrigger(t);
      const mine = diags.filter((d) => d.ruleId === ruleId);

      /*
       * 触发用例必须真的触发这条规则。少了这一句，一段不触发任何规则的输入
       * 会让下面的循环零迭代而全部通过——空产出恰好也不含汉字。
       */
      expect(
        mine.length,
        `触发用例没有产出 ${ruleId}；实际产出：${diags.map((d) => d.ruleId).join(', ') || '（无）'}`,
      ).toBeGreaterThan(0);

      for (const d of mine) {
        expect(CJK.test(d.message), `${ruleId} 的 message 里有汉字：${d.message}`).toBe(false);
        expect(d.message.trim(), `${ruleId} 的 message 是空串`).not.toBe('');
        if (d.fix !== undefined) {
          expect(CJK.test(d.fix), `${ruleId} 的 fix 里有汉字：${d.fix}`).toBe(false);
          expect(d.fix.trim(), `${ruleId} 的 fix 是空串`).not.toBe('');
        }
      }
    });
  }

  /*
   * 反向：同一批输入在中文目录下产出的必须**含**汉字。
   *
   * 少了这一条，「把 zh-cn 目录整个换成英文」这种改法会让上面全部通过。
   */
  it('同一批输入在中文目录下产出的确实是中文', () => {
    const zhProps = PropertyRegistry.load('zh-cn');
    const zhPanels = PanelRegistry.load('zh-cn');
    let checked = 0;
    for (const [ruleId, t] of Object.entries(TRIGGERS) as Array<[RuleId, Trigger]>) {
      const index = t.needsIndex ? STUB_INDEX : undefined;
      const diags =
        t.lang === 'vcss'
          ? diagnoseVcss(parseVcss(t.text), { uri: CSS_URI, props: zhProps, index, msg: ZH })
          : diagnoseVxml(parseVxml(t.text), {
              uri: t.strict ? HUD_URI : XML_URI,
              mode: t.strict ? 'customHudLayout' : 'full',
              panels: zhPanels,
              observed,
              index,
              msg: ZH,
            });
      for (const d of diags.filter((x) => x.ruleId === ruleId)) {
        expect(CJK.test(d.message), `${ruleId} 的中文 message 里没有汉字：${d.message}`).toBe(true);
        checked++;
      }
    }
    expect(checked, '一条都没查到，本条会空转').toBeGreaterThanOrEqual(28);
  });
});

describe('英文路径：悬停与补全的产出零汉字', () => {
  /** 把补全项 / 悬停信息里的可见文本摊平成 [来源, 文本] 对 */
  function textsOf(label: string, items: ReadonlyArray<Record<string, unknown>>): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const it of items) {
      for (const field of ['detail', 'documentation', 'title', 'body']) {
        const v = it[field];
        if (typeof v === 'string' && v !== '') out.push([`${label}.${field}`, v]);
      }
    }
    return out;
  }

  it('VCSS 补全 / 悬停 / 文档符号', () => {
    const collected: Array<[string, string]> = [];

    // 用属性名补全而不是取值补全：取值候选是裸字符串，没有 detail / documentation
    // 可查；属性名候选才带 `Panorama-only` 与属性说明这两处文案。
    const propText = '.a\n{\n\t';
    collected.push(
      ...textsOf(
        'completeVcss(value)',
        completeVcss(
          vcssContextAt(parseVcss(propText), propText.length),
          parseVcss(propText),
          props,
          observedValues,
          panels,
          EN,
        ) as unknown as Array<Record<string, unknown>>,
      ),
    );

    const hoverText = '.a\n{\n\tflow-children: down;\n}';
    const hover = hoverVcss(
      vcssHoverAt(parseVcss(hoverText), hoverText.indexOf('flow-children') + 2),
      parseVcss(hoverText),
      props,
      EN,
    );
    if (hover) collected.push(...textsOf('hoverVcss', [hover as unknown as Record<string, unknown>]));

    const symText = '.a\n{\n\twidth: 1px;\n\theight: 2px;\n}';
    collected.push(
      ...textsOf(
        'symbolsVcss',
        symbolsVcss(parseVcss(symText), EN) as unknown as Array<Record<string, unknown>>,
      ),
    );

    expect(collected.length, '一条可见文本都没收集到，本条会空转').toBeGreaterThanOrEqual(5);
    for (const [where, text] of collected) {
      expect(CJK.test(text), `${where} 里有汉字：${text}`).toBe(false);
    }
  });

  it('VXML 补全 / 悬停', () => {
    const collected: Array<[string, string]> = [];

    const tagText = '<root><';
    collected.push(
      ...textsOf(
        'completeVxml(tag)',
        completeVxml(
          vxmlContextAt(parseVxml(tagText), tagText.length),
          'full',
          panels,
          EN,
        ) as unknown as Array<Record<string, unknown>>,
      ),
    );

    const hoverText = '<root><Image /></root>';
    const hover = hoverVxml(
      vxmlHoverAt(parseVxml(hoverText), hoverText.indexOf('Image') + 2),
      'customHudLayout',
      panels,
      EN,
    );
    if (hover) collected.push(...textsOf('hoverVxml', [hover as unknown as Record<string, unknown>]));

    expect(collected.length, '一条可见文本都没收集到，本条会空转').toBeGreaterThanOrEqual(3);
    for (const [where, text] of collected) {
      expect(CJK.test(text), `${where} 里有汉字：${text}`).toBe(false);
    }
  });
});
