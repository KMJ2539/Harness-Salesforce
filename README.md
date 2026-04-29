# harness-sf

Salesforce engineering harness for [Claude Code](https://claude.com/claude-code) — a curated set of subagents and slash-command skills for production-grade Apex, Flow, LWC, Aura, and metadata workflows.

## Why

Salesforce development has hidden constraints that generic AI agents miss:

- A single change to a trigger can collide with **Before-Save Flows, Validation Rules, Workflow Rules, and Process Builders** on the same object.
- **Order of Execution** is invisible until something breaks in production.
- **75% test coverage** is enforced at deploy, but coverage without assertions is theatre.
- Sharing, FLS, CRUD, and Locker Service create a security surface that's easy to forget.

`harness-sf` ships agents that *know* these constraints and skills that *apply* them by default.

## Install

Project-local (recommended):

```bash
cd your-sfdx-project
npx harness-sf init
```

User-wide:

```bash
npx harness-sf init --global
```

After install, restart Claude Code (or open a new session) so it picks up `.claude/agents/` and `.claude/skills/`.

## What gets installed

### Subagents (analysis & audit)

Agents are invoked by Claude (or by other agents) via the `Agent` tool — they do focused analysis and return a report.

| Agent | Role |
|---|---|
| `sf-context-explorer` | Entry point. Maps every metadata component touching a given object — triggers, Flows, validation rules, workflows, LWC, Aura. Identifies Order-of-Execution conflicts. |
| `sf-flow-analyzer` | Reads Flow XML and returns natural-language summary, trigger timing, and side effects. |
| `sf-trigger-auditor` | Analyzes trigger ecosystem on an object — recursion, bulkification, duplicate logic, anti-patterns. |
| `sf-apex-test-author` | Authors production-grade Apex test classes with self-verify loop (run → fix → re-run). |
| `sf-deploy-validator` | Pre-ship gate. Static analysis (SOQL injection, sharing, FLS), LWC Jest, `sf project deploy validate-only`. |
| `sf-lwc-auditor` | LWC component audit — dependencies, `@wire` usage, LDS cache, accessibility, performance anti-patterns. |
| `sf-bug-investigator` | Root-cause investigation in 4 phases (investigate → analyze → hypothesize → implement). Salesforce-aware: governor limits, OoE, sharing, async timing, mixed DML. |
| `sf-design-ceo-reviewer` | Reviews `design.md` from a product/business angle — surfaces tradeoffs and alternatives (Flow vs Apex, standard vs custom, etc.). Tradeoff presenter only — never blocks. |
| `sf-design-eng-reviewer` | Reviews `design.md` from an SF engineering angle — OoE, governor limits, bulkification, recursion, async fit, LWC data access, sObject sharing/relationship model. Risk-graded. |
| `sf-design-security-reviewer` | Reviews `design.md` from a security angle — sharing modifier, FLS/CRUD, dynamic SOQL, hardcoded IDs, `@AuraEnabled` exposure, OWD, Permission Set strategy. Risk-graded. |
| `sf-design-qa-reviewer` | Reviews `design.md` from a QA/test-strategy angle — positive/negative/bulk/governor-boundary case coverage, assertion quality, mock strategy, regression risk. |
| `sf-design-library-reviewer` | Reviews `design.md` from a library/dependency angle — direct implementation vs reusing existing trigger frameworks, logging libraries, base components, LDS modules, static resources, AppExchange/unlocked packages. Inventory-grounded (Glob/Grep against `sfdx-project.json`, `package.json`, `staticresources/`, namespace prefixes); for anything outside the inventory it gives category-level guidance only, never a hallucinated product name. |

### Skills (user-invoked, design-first + ensure-mode)

Skills are slash commands you invoke. Each has **ensure semantics**: if the target component already exists, it modifies it (after a diff approval gate); if not, it creates it. There is no separate "create" vs "modify" command — describe the intent, the skill picks the path.

`/sf-apex`, `/sf-lwc`, `/sf-sobject` additionally run a **design-first flow**: deep intent elicitation → write `.harness-sf/designs/{date}-{name}.md` → 5 persona reviewers (CEO / Eng / Security / QA / Library) run in parallel → tradeoff dashboard → user approval gate (max 3 review iterations) → only then proceed to code. Reviewers present tradeoffs and risk grades; they never block — the user is always the decider.

| Skill | What it ensures |
|---|---|
| `/sf-feature` | **Composite/cross-cutting modules** (e.g. "order domain" = sObject + fields + Apex + LWC + permission set). Single intent + single review at the feature level → dispatches sub-skills in dependency order. Use this when a request spans multiple artifacts. |
| `/sf-apex` | Apex class / trigger / handler / batch / queueable / schedulable / REST resource / `@AuraEnabled` controller / invocable action. With sharing, FLS guards, trigger framework, paired test class. |
| `/sf-lwc` | LWC scaffolding (4 files) + Jest test, SLDS, `@wire` vs imperative decision, accessibility defaults. |
| `/sf-aura` | Aura component — but recommends LWC first; only proceeds when Aura is genuinely required. |
| `/sf-sobject` | Custom object metadata, name field, sharing model, list view, optional tab. |
| `/sf-field` | Custom field on any object — every type (text, picklist, lookup, master-detail, formula, roll-up summary, etc.) with impact analysis via `sf-context-explorer`. |
| `/sf-library-install` | Install an external library / package — branches across 5 methods (Managed/Unlocked Package via `sf package install`, source vendoring, git submodule, npm devDependency, static resource) chosen from the identifier the user provides. Plan-dump + approval gate, install + verify + append to `.harness-sf/decisions.md`. Invoked automatically between review approval and code phase when design.md `## Decisions` records a library adoption; can also be called standalone. |

The five artifact-level skills support a **delegated mode** when invoked by `/sf-feature`: they skip their own intent / design / review phases (already done at feature level) and execute only the context-explorer + create/modify + test loop, updating the feature design.md as artifacts complete. `/sf-library-install` likewise has a delegated mode used by the design-first skills' `Step 1.95` (and `/sf-feature`'s `Step 5.5`) when a library adoption is recorded.

## Usage

Once installed, Claude Code surfaces these in any session inside the project.

```
> /sf-apex
> I want a trigger handler for Account that updates Status when Amount > 1000
```

The skill will:
1. Call `sf-context-explorer` to map every existing trigger / Flow / VR on Account.
2. Warn if a Before-Save Flow already does similar logic.
3. **Decide create vs modify**: if `AccountTriggerHandler` already exists, read it, plan a diff, and ask you to approve the changes before writing. Otherwise, generate fresh.
4. Generate/update handler with `with sharing`, FLS guards, trigger framework wiring.
5. Call `sf-apex-test-author` — for modifications, existing tests are re-run for regression first, then new branches are covered.
6. Call `sf-deploy-validator` for static analysis before you ship.

## Commands

```bash
npx harness-sf init              # install into ./.claude/
npx harness-sf init --global     # install into ~/.claude/
npx harness-sf init --dry-run    # preview without writing
npx harness-sf init --force      # overwrite existing without prompts
npx harness-sf init --agents-only
npx harness-sf init --skills-only
npx harness-sf list              # show available agents and skills
npx harness-sf help
```

## Layout

```
harness-sf/
├── bin/install.js          # npx entry point (zero-dep)
├── templates/
│   ├── agents/             # subagents (analyzers, reviewers, writers)
│   ├── skills/             # slash-command skills (directory format)
│   ├── knowledge/          # SF reference cards (lazy-loaded by agents)
│   ├── hooks/              # project-local Claude Code hooks
│   └── _stubs/             # PROJECT.md / local.md / settings.json stubs
├── package.json
├── README.md
└── LICENSE
```

`templates/` is the single source of truth. The installed `.claude/` directory in a consumer project mirrors this structure.

## What's enforced vs advisory

`harness-sf` mixes two layers. Hooks **enforce** at tool-call time so policy holds even when the model drifts; agent/skill prompts are **advisory** — they shape behavior but the model can deviate.

### Enforced by hooks (block at tool call)

These gates run as Claude Code hooks. Project-local install only — `--global` does not install hooks.

| Gate | What it blocks | Trigger | Escape hatch |
|---|---|---|---|
| Path guard | Subagent Write/Edit outside its declared path-prefix | `pre-write-path-guard.js` on every Write/Edit/MultiEdit | (per-agent — none; main agent is unrestricted) |
| Profile deny | Edits to `force-app/**/profiles/**.profile-meta.xml` (all agents, including main) | same hook | `HARNESS_SF_ALLOW_PROFILE_EDIT=1` |
| Reviewer read-only | Any Write by `sf-design-*-reviewer` / `sf-apex-code-reviewer` | same hook | (none — defense in depth with frontmatter) |
| Design link gate | Creating new `force-app/main/default/{classes,triggers,lwc,aura,objects}/**` without a fresh design-approval sentinel | `pre-create-design-link-gate.js` (TTL 2h + HEAD match) | `HARNESS_SF_SKIP_CREATE_GATE=1` |
| Modify approval gate | Editing an existing `force-app/**` file without an explicit modify-approval sentinel | `pre-modify-approval-gate.js` (TTL 30m + HEAD match) | `HARNESS_SF_SKIP_MODIFY_GATE=1` |
| Deploy gate | `sf project deploy start` / `sfdx force:source:deploy` without recent successful validate-only + coverage ≥ target | `pre-deploy-gate.js` (TTL 30m) | `HARNESS_SF_SKIP_DEPLOY_GATE=1` |
| Library install gate | `sf package install` / `git clone` / `npm install <lib>` without prior plan+approval | `pre-library-install-gate.js` | `HARNESS_SF_SKIP_LIBRARY_GATE=1` |
| Reviewer output cap | Reviewer body >80 lines or containing a `block` verdict | `stop-reviewer-validate.js` (SubagentStop) | (none — re-emit the report) |
| Analyzer output cap | Analyzer body >80 lines without a `Details:` link to a report file | `stop-analyzer-validate.js` (SubagentStop) | (none) |

Coverage target defaults to 75% and is overridable via `HARNESS_SF_COVERAGE_TARGET=NN` or `coverage_target_percent: NN` in `.harness-sf/PROJECT.md`.

### Advisory (prompts, not hooks)

These shape model behavior but are not enforced — a misbehaving model can ignore them. Hook layer is the safety net.

- `with sharing`, FLS/CRUD guards, escaped dynamic SOQL, no hardcoded IDs in generated Apex.
- Trigger framework adoption, bulkification, recursion guards.
- Test-class self-verify loop (run → fix → re-run).
- 5-persona review tradeoff format (risk-graded, no `block` verdict).
- "Unknown areas" enumeration when metadata cannot be confidently identified.

### Caveats — global install

`npx harness-sf init --global` installs agents/skills into `~/.claude/` so they're available across all projects, but **hooks are not installed** in that mode. The reasoning: hooks read project-local state (`.harness-sf/.cache/`, `.harness-sf/PROJECT.md`, git HEAD) that doesn't exist user-wide. Use project-local install whenever enforcement matters.

A consumer project can mix the two: install agents/skills globally and run `npx harness-sf init --hooks-only` per project to add the enforcement layer.

Full hook reference (sentinel paths, exit codes, ordering): [`templates/hooks/README.md`](templates/hooks/README.md).

## Project config

Two-tier project-local config sits between agent prompts and project specifics:

- **`.harness-sf/PROJECT.md`** — team-shared, committed. Naming conventions, sharing default, forbidden patterns, Permission Set strategy, API version floor, coverage targets.
- **`.harness-sf/local.md`** — personal override, gitignored.

Both are auto-injected at session start (`session-start-context.js` hook), so skills' `Step 0.5` is a 1-line confirmation rather than a Read. Conventions become the `[recommend]` defaults in subsequent AskUserQuestion batteries.

## Design principles

- **Context-first** — every skill calls `sf-context-explorer` before writing code.
- **Ensure, not create** — skills detect whether the target exists and branch into modify mode with a diff-approval gate. No silent overwrites.
- **No fix without root cause** — `sf-bug-investigator` enforces a 4-phase loop.
- **Self-verify** — `sf-apex-test-author` runs tests and iterates on failures.
- **Security defaults** — `with sharing`, FLS/CRUD checks, escaped dynamic SOQL, no hardcoded IDs.
- **Permission separation** — object/field skills don't touch profiles; permission sets are the path.
- **Output budgets** — agents cap their reports (100–250 lines) so context doesn't explode.
- **No hallucination** — agents must list "unknown areas" rather than guess.

## Requirements

- Node.js >= 18 (for `npx`)
- Claude Code installed
- An SFDX project (`force-app/` layout) for skills to operate on

## Contributing

This is an early release (0.1.0). The intended evolution:

- Validate the current set against real SF projects, tune agent prompts.
- Add a metadata index builder (`.sf-index/`) once usage patterns reveal which queries repeat.
- Add more skills: `sf-permission-set`, `sf-flow`, `sf-validation-rule` (all ensure-mode).

PRs and issues welcome.

## License

MIT
