import { describe, it, expect } from 'vitest';
import { ObservedAttributes } from '../../../../src/core/data/observed-attributes';
import { PanelRegistry } from '../../../../src/core/data/panels';
import rawObserved from '../../../../data/vxml-observed-attributes.json';

/**
 * Ruling 16 的直接后果：`vxml.unknownAttribute` 在语料闸门上是**构造性的 0**
 * （挖掘源 20260829 是被测语料的真超集，任何实现都不可能在语料上报出东西），
 * 因此这个文件里的单元测试是这一层的**唯一**防线，标准相应提高——每条测试
 * 都得答得上「把实现改坏成什么样，这条会变红」。逐条答案写在各自的注释里。
 */

const observed = ObservedAttributes.load();
const panels = PanelRegistry.load('zh-cn');

/** 挖掘口径实测出的 6 种标签（20260829，两个构建的并集也是这 6 种） */
const OBSERVED_TAGS = [
  'CSGOInfoHudLayouts',
  'CSGOShieldDamageAlert',
  'ItemPreviewColorSlider',
  'ItemPreviewDebug',
  'ItemPreviewPanel',
  'ItemPreviewSlider',
];

describe('ObservedAttributes · hasTag', () => {
  // 改坏方式：挖掘漏收标签 / 数据文件的 tags 段被清空 / hasTag 恒返回 false。
  it('挖出的 6 种「XSD 里没有、真实布局里用过」的标签逐个查得到', () => {
    for (const tag of OBSERVED_TAGS) {
      expect(observed.hasTag(tag), `观测层里查不到标签 ${tag}`).toBe(true);
    }
  });

  // 改坏方式：hasTag 恒返回 true；或挖掘时忘了「标签已在 panels.json 里就不收」
  // 这一步，把整份面板表灌进观测层。后者是最容易发生的挖宽形态——观测层一旦
  // 收了 XSD 已有的标签，Task 7 的 unknownTag 判定顺序里第一步（panels.json 有
  // → 通过）与第二步（观测层有 → 静默通过）就再也分不出来。
  it('XSD 里已有的面板不进观测层——观测层只装 XSD 的缺口', () => {
    for (const tag of ['Panel', 'Label', 'Image', 'Button', 'Frame', 'ToggleButton']) {
      expect(panels.has(tag), `前提失效：${tag} 本该是 panels.json 里的面板`).toBe(true);
      expect(observed.hasTag(tag), `${tag} 已在 panels.json 里，不该再进观测层`).toBe(false);
    }
  });

  it('没见过的标签查不到', () => {
    expect(observed.hasTag('NotAPanelAtAll')).toBe(false);
    expect(observed.hasTag('')).toBe(false);
  });

  // 改坏方式：hasTag 里把 Object.hasOwn 写成 `tag in this.data.tags`。
  // 'constructor' / 'toString' / '__proto__' 都在 Object.prototype 上，`in`
  // 会顺着原型链判真，于是 Task 7 会对任何叫这些名字的标签静默放行。
  it('原型链上的名字不会被当成观测到的标签', () => {
    expect(observed.hasTag('constructor')).toBe(false);
    expect(observed.hasTag('toString')).toBe(false);
    expect(observed.hasTag('__proto__')).toBe(false);
    expect(observed.hasTag('hasOwnProperty')).toBe(false);
  });
});

describe('ObservedAttributes · has', () => {
  // 改坏方式：挖掘没跑 / attributes 段丢了 / has 恒返回 false。
  // Label@value 是头号命中（337 次），Frame@hitest 是计划里点名「已知并接受
  // 的代价」——Valve 自己少打一个 t 的笔误，会被一并收录、从此不再提示。
  // 这条把那笔账钉在测试里，将来有人想加频次阈值会先撞上它。
  it('挖出的属性逐个查得到（含计划点名的 Frame@hitest 笔误）', () => {
    expect(observed.has('Label', 'value')).toBe(true);
    expect(observed.has('Panel', 'clampfractionalpixelpositions')).toBe(true);
    expect(observed.has('CSGOBlurTarget', 'blurrects')).toBe(true);
    expect(observed.has('Frame', 'hitest')).toBe(true);
    expect(observed.has('ToggleButton', 'series-button')).toBe(true);
  });

  // 改坏方式：has 忽略 tag、把全部属性名塌成一个扁平集合来查。
  // value 在 Label 上观测到过、在 Panel 上没有；modenum 同理。塌成扁平集合
  // 之后这两条会变成 true，Task 7 就会对「属性用错面板」这类真错误静默放行。
  it('按面板分域，不是一个扁平的属性名集合', () => {
    expect(observed.has('Label', 'value')).toBe(true);
    expect(observed.has('Panel', 'value')).toBe(false);
    expect(observed.has('Label', 'modenum')).toBe(true);
    expect(observed.has('Image', 'modenum')).toBe(false);
  });

  // 改坏方式：挖掘时忘了「属性已在该面板的 XSD 属性集里就不收」。
  // id / class / style 是 Panel 属性集里的基础属性，一旦漏了这层过滤，
  // 观测层会把整份 XSD 属性表抄一遍，压制层就退化成「什么都压」。
  it('XSD 属性集里已有的属性不进观测层', () => {
    for (const attr of ['id', 'class', 'style', 'hittest']) {
      expect(panels.hasAttribute('Panel', attr), `前提失效：Panel 本该有 ${attr}`).toBe(true);
      expect(observed.has('Panel', attr), `${attr} 已在 XSD 属性集里，不该进观测层`).toBe(false);
    }
  });

  // 改坏方式：挖掘时去掉 data-* / on* 的排除。
  // 这两族是**规则层**的通用豁免（任何面板都可以有自定义 data- 属性和事件
  // 处理器），逐个枚举进数据文件既没完没了、又会让数据文件随语料漂移。
  // 语料里 Frame@data-set 40 次、Panel@ontooltiploaded 13 次，量足够大，
  // 排除逻辑一旦失效这条立刻红。
  it('data-* 与 on* 不进数据文件（规则层通用豁免，不逐个枚举）', () => {
    expect(observed.has('Frame', 'data-set')).toBe(false);
    expect(observed.has('Panel', 'data-stat')).toBe(false);
    expect(observed.has('Panel', 'ontooltiploaded')).toBe(false);
    expect(observed.has('CSGOSettingsEnumDropDown', 'oninputsubmit')).toBe(false);
  });

  it('没见过的组合查不到', () => {
    expect(observed.has('Label', 'definitely-not-an-attribute')).toBe(false);
    expect(observed.has('NotAPanelAtAll', 'value')).toBe(false);
    expect(observed.has('', '')).toBe(false);
  });

  /**
   * 挖掘口径是「标签在 panels.json 里、但属性不在该面板属性集里」才收属性；
   * 标签本身不认识时只收标签，不收它的属性（20260829 上是 22 处 / 13 种
   * 被这样放过，如 ItemPreviewPanel@item / @manifest / @mouse_rotate /
   * @sound）。这条边界是**故意**的，但它给 Task 7 留了一个坑：按 brief 写死
   * 的判定顺序，未知标签的 attributesOf 是空集、data- 与 on 前缀不匹配、观测层也
   * 查不到 → 这 22 处会被报成 unknownAttribute（hint），Ruling 16 说的
   * 「构造性的 0」就不成立了。Task 7 必须显式地「标签不认识就不判它的属性」。
   *
   * 改坏方式：挖掘改成连未知标签的属性一起收（这条会红），或反过来 Task 7
   * 想当然地以为观测层已经兜住了这一块（这条注释就是给它的警示）。
   */
  it('未知标签的属性不收——这条边界是故意的，Task 7 必须自己挡住', () => {
    expect(observed.hasTag('ItemPreviewPanel')).toBe(true);
    expect(observed.has('ItemPreviewPanel', 'item')).toBe(false);
    expect(observed.has('ItemPreviewPanel', 'manifest')).toBe(false);
    expect(observed.has('ItemPreviewPanel', 'mouse_rotate')).toBe(false);
  });

  /**
   * 改坏方式：外层（tag）的 `Object.hasOwn` 写成 `in`。
   *
   * **这条测试的取值是实测调出来的，别随手改回"看起来更自然"的组合。**
   * brief 点名要的 `has('constructor', 'toString')` 单独用**抓不住**这个改坏
   * ——实测过：`'constructor' in attributes` 判真，`attributes['constructor']`
   * 拿到的是 `Object` 这个函数，而 `Object.hasOwn(Object, 'toString')` 是
   * **false**（toString 挂在 Function.prototype 上，不是 Object 自己的），
   * 于是 `has` 照样返回 false，测试全绿——一条彻底的空转。第一轮 tamper 就是
   * 这么发现的。
   *
   * 真能咬住的是内层名字**恰好是外层那个原型对象自己的属性**的组合：
   * - `attributes['__proto__']` → `Object.prototype`，而 `toString` 正是它的
   *   自有属性 → 改坏后返回 true；
   * - `attributes['constructor']` → `Object` 函数，而 `keys` / `name` 正是它的
   *   自有属性 → 改坏后返回 true。
   * brief 要的那条一并留着（它本身没错，只是不够），排在后面。
   */
  it('原型链上的名字不会被当成观测到的面板（外层守卫）', () => {
    expect(observed.has('__proto__', 'toString')).toBe(false);
    expect(observed.has('__proto__', 'hasOwnProperty')).toBe(false);
    expect(observed.has('constructor', 'keys')).toBe(false);
    expect(observed.has('constructor', 'name')).toBe(false);
    expect(observed.has('constructor', 'toString')).toBe(false);
    expect(observed.has('__proto__', 'value')).toBe(false);
    expect(observed.has('toString', 'call')).toBe(false);
    expect(observed.has('hasOwnProperty', 'value')).toBe(false);
  });

  // 上面那条用的 tag 都不是 attributes 的真实 key，外层一挡就返回了，**根本
  // 没执行到内层**——内层守卫若被误写成 `in`，那条测试测不出来（这正是
  // attribute-values.test.ts 里已经踩过并写进注释的同一个坑）。这里用 'Panel'
  // ——attributes 里真实存在的 key——才能把执行压到内层对象上。
  it('原型链上的名字不会被当成观测到的属性（内层守卫，tag 必须是真实 key）', () => {
    expect(Object.hasOwn(rawObserved.attributes, 'Panel'), '前提失效：Panel 本该是真实 key').toBe(
      true,
    );
    expect(observed.has('Panel', 'constructor')).toBe(false);
    expect(observed.has('Panel', '__proto__')).toBe(false);
    expect(observed.has('Panel', 'toString')).toBe(false);
    expect(observed.has('Panel', 'hasOwnProperty')).toBe(false);
  });
});

/**
 * 用注入的合成数据再压一遍两层守卫。上面那两条靠的是「真实数据里恰好没有
 * 叫 constructor 的面板/属性」，一旦将来 Valve 真出了个叫这名字的东西，
 * 那两条会从「守卫生效」悄悄变成「数据里本来就没有」。这一组不依赖任何
 * 真实数据，守的是查询层自身的性质。
 */
describe('ObservedAttributes · 注入合成数据压守卫', () => {
  const tiny = ObservedAttributes.from({
    tags: { OnlyTag: 1 },
    attributes: { OnlyPanel: { onlyattr: 1 } },
  });

  it('注入的数据本身查得到（否则下面的否定用例全是空过）', () => {
    expect(tiny.hasTag('OnlyTag')).toBe(true);
    expect(tiny.has('OnlyPanel', 'onlyattr')).toBe(true);
  });

  it('空数据集上原型链名字一律 false', () => {
    expect(tiny.hasTag('constructor')).toBe(false);
    expect(tiny.hasTag('toString')).toBe(false);
    // 外层守卫：能咬住 `in` 的那两个组合，理由见上面 has 那一组的长注释
    expect(tiny.has('__proto__', 'toString')).toBe(false);
    expect(tiny.has('constructor', 'keys')).toBe(false);
    expect(tiny.has('constructor', 'toString')).toBe(false);
    // 内层守卫
    expect(tiny.has('OnlyPanel', '__proto__')).toBe(false);
    expect(tiny.has('OnlyPanel', 'constructor')).toBe(false);
    expect(tiny.has('OnlyPanel', 'toString')).toBe(false);
  });

  it('tags 与 attributes 是两张独立的表，不互相顶替', () => {
    // 标签表里有、属性表里没有：查属性必须 false
    expect(tiny.has('OnlyTag', 'onlyattr')).toBe(false);
    // 属性表里有、标签表里没有：查标签必须 false
    expect(tiny.hasTag('OnlyPanel')).toBe(false);
  });
});

/**
 * 数据文件本身的口径断言。不需要归档也能跑（CI 上照样有效），与
 * corpus.test.ts 里那条「观测数据 == 语料 XSD 缺口」的不变量互补：那条查
 * 「数据与语料对不对得上」，这条查「数据的规模与形状有没有悄悄漂移」。
 */
describe('data/vxml-observed-attributes.json · 口径与规模', () => {
  const kinds = Object.values(rawObserved.attributes).reduce(
    (n, m) => n + Object.keys(m).length,
    0,
  );
  const uses = Object.values(rawObserved.attributes).reduce(
    (n, m) => n + Object.values(m).reduce((a: number, b: number) => a + b, 0),
    0,
  );

  // 控制者 brief 给的参考值是 557 次 / 75 种；实现者用两套互相独立的扫描器
  // （手写状态机的纯正则扫描 + 项目自己的 parseVxml）复核，两套都得到
  // 554 次 / 74 种，差额恒为 3 次 / 1 种，未能复现 brief 的数字。按 brief
  // 「对不上以你的为准并说明」办，此处钉实测值，成因分析见 task-6-report.md。
  it('规模与实测一致：554 次 / 74 种属性、6 种标签', () => {
    expect(uses).toBe(554);
    expect(kinds).toBe(74);
    expect(Object.keys(rawObserved.tags).length).toBe(6);
  });

  it('标签名逐个钉死', () => {
    expect(Object.keys(rawObserved.tags).sort()).toEqual([...OBSERVED_TAGS].sort());
  });

  it('头部属性的次数钉死——挖掘的计数逻辑坏了这条会红', () => {
    expect(rawObserved.attributes.Label.value).toBe(337);
    expect(rawObserved.attributes.Panel.clampfractionalpixelpositions).toBe(16);
    expect(rawObserved.attributes.Panel.cachepaintcmdlist).toBe(16);
    expect(rawObserved.attributes.Label.modenum).toBe(16);
    expect(rawObserved.attributes.CSGOBlurTarget.blurrects).toBe(13);
    expect(rawObserved.attributes.Frame.hitest).toBe(4);
  });

  // 与上面那两条「XSD 里已有的不进观测层」互补：那两条是抽样，这条遍历
  // 数据文件的每一条，是全称命题。挖宽了（比如属性集展开写错、少并了某个
  // set）会在这里整片变红。
  it('数据文件里没有任何一条其实是 panels.json 已经收了的', () => {
    const redundantTags = Object.keys(rawObserved.tags).filter((t) => panels.has(t));
    expect(redundantTags, 'panels.json 里已有的标签不该进观测层').toEqual([]);

    const redundantAttrs: string[] = [];
    for (const [tag, attrs] of Object.entries(rawObserved.attributes)) {
      expect(panels.has(tag), `观测属性挂在了 panels.json 不认识的标签 ${tag} 上`).toBe(true);
      for (const attr of Object.keys(attrs)) {
        if (panels.hasAttribute(tag, attr)) redundantAttrs.push(`${tag}@${attr}`);
      }
    }
    expect(redundantAttrs, 'XSD 属性集里已有的属性不该进观测层').toEqual([]);
  });

  // 排除前缀一旦失效，这条与上面那条 data-* 的行为断言会一起红。这条查的是
  // 数据文件（全称），那条查的是查询结果（抽样）。
  it('数据文件里没有任何 data-* 或 on* 属性', () => {
    const leaked: string[] = [];
    for (const [tag, attrs] of Object.entries(rawObserved.attributes)) {
      for (const attr of Object.keys(attrs)) {
        if (attr.startsWith('data-') || attr.startsWith('on')) leaked.push(`${tag}@${attr}`);
      }
    }
    expect(leaked, 'data-* / on* 是规则层的通用豁免，不该逐个枚举进数据文件').toEqual([]);
  });

  // 结构标签不是面板，拿去查 panels.json 没有意义；它们若被当成未知标签收进
  // 观测层，Task 7 的 unknownTag 判定会对 <include> / <snippet> 静默放行，
  // 掩盖真正的结构错误。
  it('结构标签不在观测层里', () => {
    for (const tag of ['include', 'root', 'scripts', 'snippet', 'snippets', 'styles']) {
      expect(observed.hasTag(tag), `结构标签 ${tag} 不该进观测层`).toBe(false);
    }
  });

  it('挖掘源与口径写在数据文件里，便于将来重跑时核对', () => {
    expect(rawObserved.minedFrom).toBe('20260829');
    expect(rawObserved.source).toContain('弱可靠');
  });
});

/*
 * 数据文件里的 excludedTags / excludedAttributePrefixes 是挖掘口径的自述。
 *
 * 注意：口径的**实质**上面已经有两条硬编码断言盖着了（「没有任何 data-* 或 on*
 * 属性」「结构标签不在观测层里」），那两条更强——它们的期望值写死在测试里，不会
 * 跟着数据文件一起被改歪。下面这两条**不是**主防线，它们只补一件事：数据文件的
 * 自述与产物是否一致。将来若有人往 excludedAttributePrefixes 里加了新前缀而挖掘
 * 脚本没真的排除它，硬编码那两条查不到（它们只认 data- 与 on），这两条能查到。
 * 光把它们的字面值抄进断言是空转的——那只是把同一份数据读两遍。这里断言的是
 * 口径与产物的**一致性**：声明排除了什么，产物里就一条都不许有。挖掘脚本若
 * 哪天漏排（例如 on* 的判断写歪、或结构标签的集合少一项），产物会立刻带上
 * 本不该有的条目，这两条就变红。
 *
 * 这一层尤其要紧：按 Ruling 16，本数据的下游规则在语料闸门上是构造性恒真，
 * 单元测试是唯一防线；而挖掘口径一旦放宽，压制层会连真实笔误一起吞掉。
 */
describe('vxml-observed-attributes.json · 挖掘口径与产物自洽', () => {
  it('产物里没有任何一个被声明排除掉的结构标签', () => {
    for (const tag of rawObserved.excludedTags) {
      expect(Object.hasOwn(rawObserved.tags, tag), `结构标签 ${tag} 声明排除却出现在 tags 里`).toBe(
        false,
      );
      expect(
        Object.hasOwn(rawObserved.attributes, tag),
        `结构标签 ${tag} 声明排除却出现在 attributes 里`,
      ).toBe(false);
    }
  });

  it('产物里没有任何一个属性带着被声明排除掉的前缀', () => {
    for (const [tag, attrs] of Object.entries(rawObserved.attributes)) {
      for (const attr of Object.keys(attrs)) {
        for (const prefix of rawObserved.excludedAttributePrefixes) {
          expect(
            attr.startsWith(prefix),
            `${tag}@${attr} 带着声明排除的前缀 ${prefix}`,
          ).toBe(false);
        }
      }
    }
  });
});
