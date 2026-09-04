# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-09-04

First public release.

### Added

- **Two languages** — `panorama-vxml` and `panorama-vcss`, recognised by path glob
  (`**/panorama/**/layout/**/*.xml`, `**/panorama/**/styles/**/*.css`) or unconditionally by the
  `.vxml` / `.vcss` extensions. TextMate grammars written for Panorama rather than adapted from
  web CSS.
- **Completion** — 245 panel types with inheritance-resolved attribute sets, VCSS properties and
  their value domains, Panorama-only functions, at-rules, pseudo-classes and `{s:}` bindings.
- **Hover documentation** for panel types, attributes and CSS properties, including the Web
  equivalent and why Panorama differs.
- **Cross-file intelligence** backed by a workspace index — `class=` completion drawn from every
  stylesheet, go-to-definition and find-references for class names, `@define` constants and
  `@keyframes`, and segment-by-segment `src="s2r://…"` path completion with existence checking.
- **Color decorators** for Panorama's 8-digit `#RRGGBBAA` notation.
- **28 diagnostic rules** in three tiers — provably wrong (`warning`), not in the known list
  (`hint`), and CustomHudLayout whitelist violations (`error`). Every rule carries a concrete
  replacement, not just a complaint. Seven configuration groups, each settable to
  `error` / `warning` / `hint` / `off`.
- **CustomHudLayout strict mode** for paths under `custom_game/` — narrows completion to the
  four allowed panel types and enforces the per-panel attribute whitelist. Completion and
  diagnostics always agree on the mode.
- **English and Simplified Chinese** for every user-facing message, selected automatically from
  VS Code's display language.

### Notes

- The panel and attribute data is generated from the schema Counter-Strike 2 itself emits via
  `panorama_generate_layout_xsd`. That schema is known to be incomplete — the corpus contains 554
  legitimate attribute uses outside the declared sets — which is why "not in the known list"
  diagnostics are capped at `hint` and never claim more than they can prove.
- Verified against 990 real Panorama files from the shipped game, with every rule's hit count
  pinned exactly so that both new false positives and silently weakened rules turn the gate red.

[Unreleased]: https://github.com/kxnrl/vsc-panorama-ext/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kxnrl/vsc-panorama-ext/releases/tag/v1.0.0
