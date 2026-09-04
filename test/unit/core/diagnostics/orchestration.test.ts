import { describe, it, expect } from 'vitest';
import { applySettings } from '../../../../src/core/diagnostics/index';
import type { Diagnostic } from '../../../../src/core/diagnostics/types';
import { DEFAULT_DIAGNOSTIC_SETTINGS } from '../../../../src/core/diagnostics/types';

const mk = (ruleId: Diagnostic['ruleId'], start: number, end: number): Diagnostic => ({
  ruleId,
  severity: 'warning',
  start,
  end,
  message: 'm',
});

describe('applySettings', () => {
  it('配置组设为 off 时该组规则整条消失', () => {
    const out = applySettings([mk('vcss.visibilityHidden', 0, 1)], {
      ...DEFAULT_DIAGNOSTIC_SETTINGS,
      webOnlySyntax: 'off',
    });
    expect(out).toEqual([]);
  });

  it('配置组的取值覆盖规则自带的级别', () => {
    const out = applySettings([mk('vcss.visibilityHidden', 0, 1)], {
      ...DEFAULT_DIAGNOSTIC_SETTINGS,
      webOnlySyntax: 'hint',
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('hint');
  });

  it('只影响本组，不波及别组', () => {
    const out = applySettings(
      [mk('vcss.visibilityHidden', 0, 1), mk('vxml.duplicateId', 2, 3)],
      { ...DEFAULT_DIAGNOSTIC_SETTINGS, webOnlySyntax: 'off' },
    );
    expect(out.map((d) => d.ruleId)).toEqual(['vxml.duplicateId']);
  });
});
