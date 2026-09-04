import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Snippet {
  prefix: string;
  body: string[];
  description: string;
}

const load = (name: string): Record<string, Snippet> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../snippets/${name}.json`, import.meta.url)), 'utf8'),
  );

describe('VXML 代码片段', () => {
  const snippets = load('vxml');

  it('提供文档骨架与四种基础面板', () => {
    expect(Object.values(snippets).map((s) => s.prefix).sort()).toEqual([
      'button', 'image', 'label', 'panel', 'root',
    ]);
  });

  it('骨架的根面板不带 id（引擎硬约束）', () => {
    const body = snippets['VXML 文档骨架'].body.join('\n');
    expect(body).toContain('<root>');
    expect(body).toContain('<Panel class=');
    expect(body).not.toMatch(/<Panel[^>]*\bid=/);
  });

  it('每个片段都有描述', () => {
    for (const [name, s] of Object.entries(snippets)) {
      expect(s.description, `片段 ${name} 缺描述`).toBeTruthy();
    }
  });
});

describe('VCSS 代码片段', () => {
  const snippets = load('vcss');

  it('提供 @define、@keyframes 与 flow 容器', () => {
    expect(Object.values(snippets).map((s) => s.prefix).sort()).toEqual([
      'define', 'flow', 'keyframes',
    ]);
  });

  it('@keyframes 片段的名字带引号（Panorama 要求）', () => {
    const body = snippets['@keyframes 动画'].body.join('\n');
    expect(body).toMatch(/@keyframes\s+'/);
  });
});
