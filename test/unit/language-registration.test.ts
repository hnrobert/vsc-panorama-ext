import { describe, it, expect } from 'vitest';
import { minimatch } from 'minimatch';
import manifest from '../../package.json';

interface LanguageContribution {
  id: string;
  extensions?: string[];
  filenamePatterns?: string[];
  configuration?: string;
}

// 红灯阶段 contributes 还是 {}，故走一次宽松断言，保证 tsc --noEmit 在两个阶段都通过
const contributes = (manifest as { contributes?: { languages?: LanguageContribution[] } })
  .contributes;
const languages: LanguageContribution[] = contributes?.languages ?? [];

const lang = (id: string): LanguageContribution => {
  const found = languages.find((l) => l.id === id);
  if (!found) throw new Error(`package.json 未注册语言 ${id}`);
  return found;
};

const matchesAny = (patterns: string[], path: string) =>
  patterns.some((p) => minimatch(path, p));

describe('语言注册（规格 §6.1）', () => {
  it('注册了两个语言 ID', () => {
    expect(languages.map((l) => l.id).sort()).toEqual(['panorama-vcss', 'panorama-vxml']);
  });

  it('.vxml / .vcss 后缀无条件识别', () => {
    expect(lang('panorama-vxml').extensions).toContain('.vxml');
    expect(lang('panorama-vcss').extensions).toContain('.vcss');
  });

  it('每个语言都带 language-configuration', () => {
    expect(lang('panorama-vxml').configuration).toBe('./language-configuration-vxml.json');
    expect(lang('panorama-vcss').configuration).toBe('./language-configuration-vcss.json');
  });
});

describe('VXML 路径 glob 覆盖三种真实目录形态（规格 §6.1）', () => {
  const patterns = lang('panorama-vxml').filenamePatterns ?? [];

  it('20260829 形态：panorama 下再包一层 panorama', () => {
    expect(matchesAny(patterns, 'w/Valve/panorama/20260829/panorama/layout/hud/hud.xml')).toBe(true);
  });

  it('20260716 形态：少一层 panorama', () => {
    expect(matchesAny(patterns, 'w/Valve/panorama/20260716/layout/hud/hud.xml')).toBe(true);
  });

  it('真实游戏内容目录形态', () => {
    expect(matchesAny(patterns, 'game/csgo/panorama/layout/custom_game/x/main.xml')).toBe(true);
  });

  it('不误伤 panorama 目录外的 xml', () => {
    expect(matchesAny(patterns, 'src/config/settings.xml')).toBe(false);
  });

  it('不误伤 panorama 内非 layout 目录的 xml', () => {
    expect(matchesAny(patterns, 'game/csgo/panorama/scripts/foo.xml')).toBe(false);
  });
});

describe('VCSS 路径 glob（规格 §6.1）', () => {
  const patterns = lang('panorama-vcss').filenamePatterns ?? [];

  it('覆盖两种解包库形态与游戏内容目录', () => {
    expect(matchesAny(patterns, 'w/Valve/panorama/20260829/panorama/styles/hud/hud.css')).toBe(true);
    expect(matchesAny(patterns, 'w/Valve/panorama/20260716/styles/csgostyles.css')).toBe(true);
    expect(matchesAny(patterns, 'game/csgo/panorama/styles/custom_game/x/main.css')).toBe(true);
  });

  it('不误伤普通网页 CSS', () => {
    expect(matchesAny(patterns, 'src/web/styles/app.css')).toBe(false);
    expect(matchesAny(patterns, 'node_modules/foo/dist/index.css')).toBe(false);
  });
});
