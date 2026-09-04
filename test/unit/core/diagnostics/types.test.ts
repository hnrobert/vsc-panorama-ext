import { describe, it, expect } from 'vitest';
import {
  ALLOWED_LEVELS,
  ALL_RULE_IDS,
  RULE_GROUP,
  SETTING_KEYS,
  DEFAULT_DIAGNOSTIC_SETTINGS,
} from '../../../../src/core/diagnostics/types';

describe('诊断类型表', () => {
  it('每条规则都归属于某个配置组', () => {
    for (const id of ALL_RULE_IDS) {
      expect(SETTING_KEYS).toContain(RULE_GROUP[id]);
    }
  });

  it('每个配置组都至少管着一条规则——空组说明表写漏了', () => {
    for (const key of SETTING_KEYS) {
      const owned = ALL_RULE_IDS.filter((id) => RULE_GROUP[id] === key);
      expect(owned.length, `配置组 ${key} 没有任何规则`).toBeGreaterThan(0);
    }
  });

  // 这里是 7 个键，比规格 §10.4 原文的 5 个键多两个——不是测试写错了，是键位表
  // 本身表达不了 §10.2 要求的级别，各拆出了一个键：
  // `unresolvedReference` 见 D-M4-4（`unknownClass` 一个键管不了 §10.2 里两条
  // 不同级别的规则）；`duplicateId` 见 task-1-report.md 的 Addendum（同一文件 id
  // 重复按规格是 hint，塞进任何一个既有键都会让配置键的名字对不上它实际管辖的
  // 内容，唯一干净的解法是单独拆键）。
  it('默认级别与规格 §10.4 逐字一致（含 D-M4-4 与本任务裁决新拆的两个键）', () => {
    expect(DEFAULT_DIAGNOSTIC_SETTINGS).toEqual({
      webOnlySyntax: 'warning',
      unknownProperty: 'hint',
      unknownClass: 'hint',
      unresolvedReference: 'warning',
      duplicateId: 'hint',
      structure: 'warning',
      customHudWhitelist: 'error',
    });
  });

  it('规则 id 不重复', () => {
    expect(new Set(ALL_RULE_IDS).size).toBe(ALL_RULE_IDS.length);
  });

  it('ALLOWED_LEVELS 覆盖每个配置键，且每个键的默认值落在自己的取值域里', () => {
    // 默认值不在自己取值域里时，设置界面会把默认值显示成一个非法项，而适配层的
    // 「非法就回落到默认」会回落到一个它自己都不接受的值。manifest.test.ts 也查
    // 这一条，但那边查的是 package.json；这里查的是 core 自身的自洽——没有清单
    // 参与也必须成立。
    expect([...Object.keys(ALLOWED_LEVELS)].sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) {
      const allowed: readonly string[] = ALLOWED_LEVELS[key];
      expect(allowed.length, `${key} 的取值域是空的`).toBeGreaterThan(0);
      expect(allowed, `${key} 的取值域必须含 off——每一组都要能整组关掉`).toContain('off');
      expect(allowed, `${key} 的默认值不在自己的取值域里`).toContain(
        DEFAULT_DIAGNOSTIC_SETTINGS[key],
      );
    }
  });
});
