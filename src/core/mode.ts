/**
 * 文档级的规则集选择。由文件路径决定，与光标位置正交——
 * 后者由 vxml/context.ts 的 TagSlot 回答。
 */
export type LayoutMode = 'full' | 'customHudLayout';

/** 规格 §6.2 的默认判定 glob */
export const DEFAULT_CUSTOM_HUD_PATTERNS: readonly string[] = Object.freeze([
  '**/layout/custom_game/**',
]);

/**
 * CustomHudLayout 白名单（规格 §6.2）。只此四种面板，属性也受限。
 * 来源是 Valve 的 @experimental API 文档而非引擎自述，因此单列在此、
 * 不与 XSD 生成的 panels.json 混放，便于随 CS2 更新整体调整。
 */
export const CUSTOM_HUD_WHITELIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Panel: Object.freeze(['id', 'class', 'hittest']),
  Label: Object.freeze(['id', 'class', 'hittest', 'text']),
  Image: Object.freeze(['id', 'class', 'hittest', 'src', 'texturewidth', 'textureheight']),
  // Button 没有 text：按钮文字用子 <Label>
  Button: Object.freeze(['id', 'class']),
});

/** 严格模式下 <root> 内仍可出现的结构元素（scripts / snippets 不可用） */
export const CUSTOM_HUD_ALLOWED_STRUCTURAL: readonly string[] = Object.freeze(['styles']);

const EMPTY_ATTRS: readonly string[] = Object.freeze([]);

/**
 * CustomHudLayout 白名单里某个标签允许的属性集。
 * 直接用 [] 索引 tag（用户在文档里敲出来的、任意字符串）会顺着原型链拿到
 * Object.prototype 上的同名成员（如 'constructor' 会拿到 Object 本身），
 * 那不是字符串数组，后续 .filter/.includes 会抛异常。先过一遍
 * Object.hasOwn 保证不在白名单内的标签永远只得到空数组。
 */
export function customHudAttributesOf(tag: string): readonly string[] {
  return Object.hasOwn(CUSTOM_HUD_WHITELIST, tag) ? CUSTOM_HUD_WHITELIST[tag] : EMPTY_ATTRS;
}

/** 把 glob 转成正则。只需支持 ** / * / ? 三种通配。 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** 可匹配零个或多个路径段
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          // 中段 ** 不跟 / 时按单段通配处理，与标准 glob 一致；
          // 跨段只有 **/ 和结尾的 ** 两种写法才允许
          out += i + 2 >= glob.length ? '.*' : '[^/]*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function layoutModeFor(
  path: string,
  patterns: readonly string[] = DEFAULT_CUSTOM_HUD_PATTERNS,
): LayoutMode {
  const normalized = path.replace(/\\/g, '/');
  const hit = patterns.some((p) => globToRegExp(p).test(normalized));
  return hit ? 'customHudLayout' : 'full';
}
