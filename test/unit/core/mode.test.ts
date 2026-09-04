import { describe, it, expect } from 'vitest';
import {
  CUSTOM_HUD_WHITELIST,
  DEFAULT_CUSTOM_HUD_PATTERNS,
  layoutModeFor,
} from '../../../src/core/mode';

describe('layoutModeFor', () => {
  it('custom_game 下进入严格模式', () => {
    expect(layoutModeFor('game/csgo/panorama/layout/custom_game/x/main.xml')).toBe(
      'customHudLayout',
    );
  });

  it('官方 UI 路径保持完整语言模式', () => {
    expect(layoutModeFor('w/panorama/20260829/panorama/layout/hud/hud.xml')).toBe('full');
  });

  it('custom_game 下的样式表不受影响——白名单只约束 VXML', () => {
    // 默认 glob 只匹配 layout/ 下的内容，styles/ 一律 full
    expect(layoutModeFor('game/csgo/panorama/styles/custom_game/x/main.css')).toBe('full');
  });

  it('Windows 反斜杠路径同样识别', () => {
    expect(layoutModeFor('E:\\game\\csgo\\panorama\\layout\\custom_game\\x\\main.xml')).toBe(
      'customHudLayout',
    );
  });

  it('可传入自定义 glob 覆盖默认值', () => {
    expect(layoutModeFor('my/ui/main.xml', ['**/my/ui/**'])).toBe('customHudLayout');
    expect(layoutModeFor('my/ui/main.xml', [])).toBe('full');
  });

  it('默认 glob 就是规格 §6.2 写明的那一条', () => {
    expect(DEFAULT_CUSTOM_HUD_PATTERNS).toEqual(['**/layout/custom_game/**']);
  });
});

describe('CUSTOM_HUD_WHITELIST', () => {
  it('只有四种面板', () => {
    expect(Object.keys(CUSTOM_HUD_WHITELIST).sort()).toEqual([
      'Button', 'Image', 'Label', 'Panel',
    ]);
  });

  it('Button 不含 text——文字要用子 Label', () => {
    expect(CUSTOM_HUD_WHITELIST.Button).not.toContain('text');
    expect(CUSTOM_HUD_WHITELIST.Label).toContain('text');
  });

  it('Image 允许 src 与解码尺寸', () => {
    expect([...CUSTOM_HUD_WHITELIST.Image].sort()).toEqual([
      'class', 'hittest', 'id', 'src', 'textureheight', 'texturewidth',
    ]);
  });

  it('没有任何面板允许 style 内联属性', () => {
    for (const attrs of Object.values(CUSTOM_HUD_WHITELIST)) {
      expect(attrs).not.toContain('style');
    }
  });
});

describe('globToRegExp · 中段 **', () => {
  it('中段 ** 不跟 / 时不跨路径段（与标准 glob 一致）', () => {
    expect(layoutModeFor('x/hud/y.xml', ['**hud/*.xml'])).toBe('full');
    expect(layoutModeFor('hud/y.xml', ['**hud/*.xml'])).toBe('customHudLayout');
  });

  it('? 通配符匹配单个非分隔字符', () => {
    expect(layoutModeFor('a/b.xml', ['a/?.xml'])).toBe('customHudLayout');
    expect(layoutModeFor('a/bc.xml', ['a/?.xml'])).toBe('full');
  });
});

describe('导出常量的不可变性', () => {
  it('DEFAULT_CUSTOM_HUD_PATTERNS 已冻结', () => {
    expect(Object.isFrozen(DEFAULT_CUSTOM_HUD_PATTERNS)).toBe(true);
  });
});
