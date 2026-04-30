# Changelog

All notable changes to `harness-sf` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — 2026-04-30

### Changed

- **`/sf-feature` token cost cut** — typical run drops from ~100k to ~15–30k for small revisions. Four multipliers addressed:
  - **Step 3.95 review tier gate** (default = `none`). Single-pass plan unless the user opts into `light` (1 reviewer) / `standard` (3 parallel) / `full` (4+library). `validate-design.js --check-library-verdict` skips when `review_tier ∈ {none, light, standard}`; legacy designs keep strict default.
  - **`SKILL.md` split to `references/`** — 715 → 482 lines. `confirmation-catalog.md` (Step 3.5), `approval-gates.md` (Step 5), `auto-fix-loop.md` (Step 7.5).
  - **`archive-design-revision.js`** — superseded review/resolution blocks fenced via `<!-- archive-revision: N -->` move to sibling `{slug}.archive.md` on revision bump (Step 5.1.5 / 7.5.5). Active design.md stays small for sub-agents; audit trace preserved in archive.
  - **SessionStart context compression** — `compressMd()` collapses bulky PROJECT.md / local.md sections (≥15 non-blank lines OR contains a code fence) to a 1-line pointer. Files unchanged on disk; `check-logging.js` and other direct readers keep working as-is.

### Notes

- Breaking changes: none. Existing designs without `review_tier` frontmatter run the legacy strict library-verdict gate.
- Tests: 91/91 (5 archive + 4 compress + existing 82).

## [0.1.2] — 2026-04-29

### Fixed

- `prepublishOnly` test glob now uses `*.test.js` to match the `npm test` script behavior.

## [0.1.1] — 2026-04-29

### Added

- **`update` subcommand** in `bin/install.js` — manifest-driven upgrade for existing installs. Records sha256 of every shipped template + local copy in `.claude/.harness-sf-manifest.json` on `init`, and on `update` classifies each file as `unchanged` / `upstream-only` / `user-only` / `conflict`. Default conflict answer is **keep** so user edits are preserved unless explicitly overwritten. Deleted templates are auto-removed when locally untouched, kept with a warning when modified. Legacy installs without a manifest get a one-time, no-loss migration on first `update`. Zero-dep (`crypto` is a Node built-in).
- **`/sf-harness-update` skill** (`templates/skills/sf-harness-update/SKILL.md`) — thin UX wrapper that runs `npx harness-sf@latest update --dry-run` to preview the change scope, then forwards conflict prompts to the user. Iron Law: the CLI is the single source of truth for update logic; the skill never reimplements it.
- **README "Upgrading an existing install" section** — bucket table + manifest behavior + legacy migration + skill entry. New rows in *When to use what*, *Skills reference*, and *Commands*.
- **Design doc**: `.harness-sf/designs/2026-04-29-harness-update-flow.md`.

### Notes

- Breaking changes: none. Existing `init`-installed projects pick up the manifest layer automatically the next time they run `init` or `update` (legacy migration path).
- `--global` installs are not tracked by manifest and are out of scope for `update` (project-local only).

## [0.1.0] — 2026-04-28

Initial public release.

### Added

- `/sf-feature` orchestrator — composite-module entry point with intent battery, 5-persona review, dispatch DAG, sentinel-verified delegated mode.
- Artifact-level skills: `/sf-apex`, `/sf-lwc`, `/sf-aura`, `/sf-sobject`, `/sf-field`, `/sf-library-install`.
- Subagent suite — analyzers (`sf-context-explorer`, `sf-flow-analyzer`, `sf-trigger-auditor`, `sf-lwc-auditor`, `sf-bug-investigator`), reviewers (`sf-design-{ceo,eng,security,qa,library}-reviewer`, `sf-apex-code-reviewer`), writers (`sf-apex-test-author`, `sf-deploy-validator`).
- Hook layer — path guard, profile deny, reviewer read-only, design-link gate, modify-approval gate, deploy gate, library-install gate, reviewer/analyzer output caps. Project-local only.
- Project config layer — `.harness-sf/PROJECT.md` (team-shared) + `.harness-sf/local.md` (personal override), auto-injected at session start.
- Knowledge cards (10) — Salesforce reference material lazy-loaded by agents.
- Zero-dep installer (`bin/install.js`) — `init`, `list`, `--dry-run`, `--force`, `--*-only` flags, post-install `doctor()` healthcheck.

[0.1.1]: https://github.com/KMJ2539/Harness-Salesforce/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KMJ2539/Harness-Salesforce/releases/tag/v0.1.0
