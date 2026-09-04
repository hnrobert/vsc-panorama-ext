import type { UiMessages } from '../types';

export const ui: UiMessages = {
  panoramaOnly: () => 'Panorama-only',
  values: (list) => `Values: ${list.join(' | ')}`,
  webEquivalent: (s) => `Web equivalent: ${s}`,
  panoramaOnlyNote: () =>
    'Panorama-only property; it does not exist in standard CSS, or means something different there.',
  defineInCurrentFile: (value) => `${value} (this file)`,
  defineFromOtherSheet: () => '@define from another stylesheet',
  keyframesFromOtherSheet: () => '@keyframes from another stylesheet',
  seenInCorpusOnly: () => 'Seen in the corpus (unverified)',
  defineHover: (value) =>
    `\`@define\` constant (compile-time text substitution)\n\nCurrent value: \`${value}\``,
  // 单复数分开，避免出现 "1 declarations"
  declarationCount: (n) => (n === 1 ? '1 declaration' : `${n} declarations`),
  stylesheetIncluded: (included) =>
    included ? 'Stylesheet already included' : 'Other stylesheet in the workspace',
  panelType: (derivedFrom) =>
    derivedFrom ? `Panel type, derived from \`${derivedFrom}\`` : 'Panel type (base type)',
  rootOnlyNote: () => '⚠️ Root panel only; cannot be used as a nested child',
  whitelistNote: (allowed) =>
    allowed
      ? '✅ Allowed by the CustomHudLayout whitelist'
      : '❌ Not in the CustomHudLayout whitelist; unusable here',
  attributeOf: (declarer) => (declarer ? `Attribute, declared on \`${declarer}\`` : 'Attribute'),
  bindingDoc: (kind) =>
    ({
      s: 'String dialog variable, filled in by SetDialogVariableString on the server',
      d: 'Another dialog data binding (used by the official UI)',
      g: 'Game / global data; may carry an argument segment',
      t: 'Token / translation binding',
    })[kind],
  continueCompletion: () => 'Continue completing the next segment',
};
