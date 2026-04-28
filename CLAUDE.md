# CLAUDE.md

Guidance for Claude Code when working with this repository.

## What this repo is

`harness-sf` is **not** a Salesforce project — it is an installer that ships a curated set of Claude Code subagents and slash-command skills *for* Salesforce projects. The runtime artifact is the `templates/` tree; `bin/install.js` copies it into a consumer project's `.claude/` directory.

When editing here, you are authoring prompts for downstream agents/skills, not Apex code. Test consumers will be SFDX projects with a `force-app/` layout.

User-facing overview: `README.md`. Hook table + sentinel files: `templates/hooks/README.md`.

## Repo layout

- **`templates/`** — single source of truth for the installed `.claude/` runtime. Zero-dep, copied verbatim by `bin/install.js`.
- **`bin/install.js`** — zero-dep installer. Must stay dep-free so `npx harness-sf` works without `npm install`.
- **`harness/`** — separate npm package for measurement & verification infra (eval / snapshot / lint / observability / replay). NOT shipped to consumers, NOT touched by the installer. Reads `templates/` but never modifies it. Free to use deps. See `harness/README.md`.
- **`.harness-sf/designs/`** (in this repo) — design docs for harness-sf's own evolution; treated like any consumer's design dir.

## Commands

```bash
npx harness-sf init              # install templates/ into ./.claude/ in cwd
npx harness-sf init --global     # install into ~/.claude/
npx harness-sf init --dry-run    # preview, write nothing
npx harness-sf init --force      # overwrite without prompting
npx harness-sf init --agents-only | --skills-only | --hooks-only
npx harness-sf list              # list bundled agents and skills
```

No test suite, lint, or build step. `npm test` smoke-runs `--help`. Node >= 18.

## Architecture

Three layers:

- **`templates/agents/*.md`** — subagents invoked via the `Agent` tool. YAML frontmatter declares `name`, `description`, `tools`, `model`. Three groups by Write policy:
  - **Analyzers** (`sf-context-explorer`, `sf-flow-analyzer`, `sf-trigger-auditor`, `sf-lwc-auditor`, `sf-bug-investigator`) — Write granted to `.harness-sf/reports/{agent-name}/` only.
  - **Reviewers** (`sf-design-{ceo,eng,security,qa,library}-reviewer`, `sf-apex-code-reviewer`) — read-only. Skill aggregates output into design.md `## Reviews`.
  - **Writers** (`sf-apex-test-author`, `sf-deploy-validator`) — Write granted to specific paths only.
- **`templates/skills/<name>/SKILL.md`** — user-invoked slash commands. Stored in **directory format** because Claude Code's user-level skill loader requires it; flat `.md` files are silently ignored.
- **`templates/knowledge/*.md`** — Salesforce reference cards. Agents Read these on demand instead of inlining rules — saves ~25% of agent prompt tokens. Each agent declares which files to Read at which step.

Skill set: `/sf-feature` (composite-module orchestrator) + 5 artifact-level skills (`/sf-apex`, `/sf-lwc`, `/sf-aura`, `/sf-sobject`, `/sf-field`) + 1 install skill (`/sf-library-install`). Every skill is **ensure-mode**: target exists → modify (with diff approval), absent → create.

## Output budgets (non-negotiable)

- **Body cap**: 80 lines of agent **runtime output** (assistant transcript), enforced by `stop-reviewer-validate.js` and `stop-analyzer-validate.js`. The cap targets emitted bodies, not the prompt definition files in `templates/agents/*.md` (those are unbounded — e.g. `sf-deploy-validator.md` is 200+ lines and that is fine).
- **Detail dump**: Analyzers/Writers Write full detail to `.harness-sf/reports/{agent-name}/{slug}-{YYYYMMDD-HHMMSS}.md`. Body ends with `상세: {경로}`.
- **Path-prefix enforcement**: prompt-level guidance is mirrored by `pre-write-path-guard.js`. `CLAUDE_AGENT` env determines allowed prefixes. Reviewer overflow handled by `stop-reviewer-validate.js` (block on `block` verdict or >80 lines).

## Mechanism layer

Enforcement lives in Claude Code hooks under `templates/hooks/`, wired by `templates/_stubs/settings.json` (safe-merged into the consumer's `.claude/settings.json`). Hooks are project-local only — `--global` skips them. **Full hook table + sentinel map: `templates/hooks/README.md`.**

When extending: evaluate any new enforcement as "is this a hook, or just a prompt?". If it's a hook, register the script in `_stubs/settings.json` and let the installer's safe-merge pick it up; never bypass `installSettings()` to write settings directly.

## Project config layer

- **`.harness-sf/PROJECT.md`** — team-shared, committed. Conventions, sharing default, forbidden patterns, PS strategy, API version floor, coverage targets.
- **`.harness-sf/local.md`** — personal override, gitignored.
- Priority: `local.md` > `PROJECT.md` > project `CLAUDE.md`.
- Loaded by `session-start-context.js` as `additionalContext` at session start. Skills' `Step 0.5` is a 1-line confirmation, not a Read.

## Composite vs artifact-level skills

`/sf-feature` owns feature-level intent + composite design.md + 5-persona review **once**, then dispatches artifact-level skills in dependency order (`sobject → field → apex → lwc/aura → permission-set/flow`).

Each artifact-level skill supports a **delegated mode**: when invoked by `/sf-feature` with a feature design.md path + artifact ID, it skips its own Step 1~1.9 (intent / design / review) and runs only Step 2 onwards (`sf-context-explorer` + create/modify + tests). Updates the artifact's `status: pending → done` in the feature design.md on completion. Review effort is O(1) per feature, not O(N) per artifact.

When extending: any new artifact-level skill must implement `Step 0: 호출 모드 판별` and honor the delegated contract.

The delegated contract is **sentinel-verified**, not prompt-trusted: `/sf-feature` Step 6 issues a per-artifact `delegated-mode` token via `_lib/issue-delegated-token.js`, and the sub-skill's Step 0 calls `_lib/check-delegated-token.js` to verify before branching. No token → standalone fallback. Dispatch progress lives in `.harness-sf/.cache/dispatch-state/<feature-slug>.json` (managed by `_lib/dispatch-state-cli.js`) so the orchestrator can resume after session loss and `statusline.js` can show real progress. Pre-Step-4 `_lib/validate-design.js` gates malformed design.md (frontmatter, artifact id uniqueness, DAG, declared-vs-actual count) out of the review/dispatch pipeline.

Call graph: skill → (design-first only) intent → review → approve → `sf-context-explorer` → optional fan-out to `sf-flow-analyzer` / `sf-trigger-auditor` → CREATE-vs-MODIFY decision → generate/update → `sf-apex-test-author` → `sf-deploy-validator`. `sf-context-explorer` is the documented entry point for the code phase and must run before any code is written.

Design-first flow details (intent battery, recommend+business-first confirmation, 5-persona review, approval gate, library install hop, dispatch contract) live in each skill's `SKILL.md` — don't duplicate here.

## Ensure-mode invariants

Encoded across all five artifact-level skills in `Step 2.5: 모드 결정 (CREATE vs MODIFY)`. Preserve:

- **Detect first** — Glob the target path before any write.
- **Approval gate before write** — MODIFY mode never overwrites silently. Show diff plan + require user confirmation.
- **Preserve external contracts** — public Apex signatures, `@AuraEnabled`/`@InvocableMethod`, `with sharing`, LWC `@api` props, custom event shapes, Aura `implements=`, sObject `sharingModel` / `nameField.type` — explicit user approval to change.
- **Risk-rank field/object changes** — safe (label, picklist *additions*, length expansion) vs data-affecting (type change, length shrink, required true, sharingModel change, picklist *deletions*). Latter need strong warning.
- **Re-run existing tests before adding new ones** in MODIFY mode.

## Installer

`bin/install.js` is a single zero-dep Node script.

- `templates/` is the **single source of truth**. Installed `.claude/` mirrors it exactly.
- Existing files prompt interactively (`y/N/a/s`) unless `--force` or `--skip-existing`.
- Must remain dep-free so `npx harness-sf` works without an install step.
- `init` ends with a read-only `doctor()` healthcheck. Non-fatal, never reads or stores tokens.

## Authoring conventions

- **Korean prose, English identifiers.** Agent/skill bodies in Korean; Salesforce API names, paths, code stay original.
- **Don't remove output caps** — they prevent context explosion in the orchestrator.
- **No hallucination** — agents enumerate "unknown areas" rather than guess metadata.
- **Security defaults baked in** — generated Apex must use `with sharing`, FLS/CRUD checks, escaped dynamic SOQL, no hardcoded IDs. Object/field skills never touch profiles.
- **Self-verify loop** — `sf-apex-test-author` runs tests and iterates on failures.

## Salesforce constraints

The constraints these agents exist to handle: Order of Execution conflicts (Apex triggers vs Before-Save Flows vs Validation Rules vs Workflow Rules); 75% Apex coverage with assertions; sharing / FLS / CRUD / Locker Service surface; governor limits and async / mixed-DML timing. New agents and skills should reason about these explicitly.
