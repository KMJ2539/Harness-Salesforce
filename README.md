# harness-sf

Salesforce engineering harness for [Claude Code](https://claude.com/claude-code) — describe a feature, get a dependency-ordered, design-reviewed, gate-enforced implementation across Apex, LWC, sObjects, and metadata.

## Why

Salesforce work is rarely "one class". A typical change touches a custom object, two fields, an Apex handler, an LWC, and a permission set — and a single missed coupling collides with **Before-Save Flows, Validation Rules, Workflow Rules, and Process Builders** on the same object. **Order of Execution** is invisible until production. **75% coverage** is enforced at deploy, but coverage without assertions is theatre. Sharing, FLS, CRUD, and Locker Service create a security surface that's easy to forget.

`harness-sf` ships a top-level `/sf-feature` orchestrator that takes feature-shaped intent, runs design-first review once, and dispatches artifact-level skills in dependency order — backed by Claude Code hooks that enforce the gates at tool-call time.

## Install

Project-local (recommended — hooks only install in this mode):

```bash
cd your-sfdx-project
npx harness-sf init
```

User-wide (agents + skills only, no hook enforcement):

```bash
npx harness-sf init --global
```

Restart Claude Code so it picks up `.claude/agents/`, `.claude/skills/`, and `.claude/hooks/`.

### Upgrading an existing install

Once installed, upgrade in place with:

```bash
npx harness-sf@latest update         # manifest-driven diff, prompts on conflict
npx harness-sf@latest update --dry-run
```

The first `init` writes `.claude/.harness-sf-manifest.json` recording per-file sha256 of every shipped template + the local copy. `update` reads the manifest and classifies each file:

| Bucket | Meaning | Action |
|---|---|---|
| `unchanged` | user untouched, template untouched | no-op |
| `upstream-only` | user untouched, template changed | silent overwrite |
| `user-only` | user modified, template untouched | preserved |
| `conflict` | user modified, template changed | interactive prompt — default keeps your edit |

Deleted templates (e.g. deprecated agents) are removed automatically when locally untouched, kept with a warning when locally modified. `settings.json` is safe-merged on every run (idempotent). Legacy installs without a manifest get a one-time, no-loss migration on first `update`.

From inside Claude Code: `/sf-harness-update` is a thin UX wrapper that runs the dry-run preview, surfaces the change scope, and forwards conflict prompts to you.

## The flow — `/sf-feature`

```
/sf-feature "order management module"
        │
        ▼
  intent battery   ──►  .harness-sf/designs/{date}-{feature}.md
                         (Why / What / How / Artifacts / Decisions)
        │
        ▼
  5-persona review (parallel)
    CEO • Eng • Security • QA • Library
        │
        ▼
  resolution gate  ──►  every HIGH/MEDIUM risk needs a real response
        │              ──►  design-approval sentinel issued (TTL 2h)
        ▼
  dispatch in DAG order
    sobject ─► field ─► apex ─► lwc/aura ─► permission-set/flow
        │       │       │       │
        │       │       │       └── /sf-lwc  (delegated mode — no re-design)
        │       │       └────────── /sf-apex (delegated mode)
        │       └────────────────── /sf-field (delegated mode)
        └────────────────────────── /sf-sobject (delegated mode)
        │
        ▼
  per-artifact: sf-context-explorer ─► create/modify (sentinel-gated)
                                  ─► sf-apex-test-author (self-verify loop)
        │
        ▼
  sf-deploy-validator  ──►  .harness-sf/last-validation.json
        │              ──►  validate-only + coverage ≥ target
        ▼
  sf project deploy start  ──►  pre-deploy-gate.js verifies sentinel + coverage
```

The orchestrator owns intent + design + review **once** at the feature level. Sub-skills run in **delegated mode** — they skip their own intent / design / review and execute only the context-explorer + create/modify + test loop, updating the feature's design.md as artifacts complete.

Resume after session loss: dispatch state lives in `.harness-sf/.cache/dispatch-state/<feature>.json`. The statusline shows `done/total` progress in real time.

## When to use what

| Situation | Entry point |
|---|---|
| Multi-artifact feature ("order module", "approval flow refactor", "Account 360 view") | `/sf-feature` |
| Atomic change to a single class / trigger / handler | `/sf-apex` directly |
| Atomic change to a single LWC | `/sf-lwc` directly |
| Atomic change to one custom object's metadata | `/sf-sobject` directly |
| Atomic field add/edit on an existing object | `/sf-field` directly |
| Aura component (legacy reasons only — recommends LWC first) | `/sf-aura` directly |
| Add an external library / managed package | `/sf-library-install` (or auto-invoked when design.md `## Decisions` records a library adoption) |
| Production bug with stack trace | `/investigate` (4-phase root-cause loop) |
| Upgrade harness-sf templates in this project | `/sf-harness-update` (or `npx harness-sf@latest update`) |

The artifact skills are the same ones `/sf-feature` dispatches — they just run their own intent + design + review when called standalone. **Use them directly when the change is genuinely one artifact** (e.g. adding a single FLS guard to an existing handler, fixing a typo in an LWC label). The composite ceremony is overhead for atomic work.

## Example session

```
> /sf-feature
> order management: Order__c sObject with Status and Amount fields,
> a handler that flags >$1000 as High Value with FLS guards, and an
> LWC list view that respects sharing
```

`/sf-feature` will:

1. Run the intent battery — confirm sharing model, naming, target org, coverage target.
2. Write `.harness-sf/designs/{date}-order-mgmt.md` with the artifacts table and dependency edges.
3. Dispatch all five reviewers in parallel; you see a single risk dashboard with `[H1]…[M3]` IDs.
4. Wait for your `## Review Resolution` block — every HIGH/MEDIUM needs a substantive line (rubber-stamp `ok` is rejected).
5. Issue the design-approval sentinel and dispatch:
   - `/sf-sobject` → creates `Order__c`
   - `/sf-field` → creates `Status__c` and `Amount__c` (depends on `Order__c`)
   - `/sf-apex` → creates `OrderHandler` with FLS guard + paired test class (depends on fields)
   - `/sf-lwc` → creates the list view component (depends on object)
6. After every artifact, `sf-apex-test-author` runs against the scratch org and iterates on failures.
7. `sf-deploy-validator` runs `validate-only` + coverage check; writes `last-validation.json`.
8. `sf project deploy start` — `pre-deploy-gate.js` verifies the validation is fresh, coverage ≥ target, and HEAD hasn't moved.

End-to-end fixture you can step through: [`examples/sfdx-demo/WALKTHROUGH.md`](examples/sfdx-demo/WALKTHROUGH.md).

## Skills reference

| Skill | What it ensures | Standalone mode | Delegated mode (called by `/sf-feature`) |
|---|---|---|---|
| `/sf-feature` | Composite/cross-cutting modules | Always — this is the orchestrator | n/a |
| `/sf-apex` | Apex class / trigger / handler / batch / queueable / schedulable / REST / `@AuraEnabled` / invocable | Full design-first flow | Skips intent/design/review; runs context + create/modify + tests |
| `/sf-lwc` | LWC scaffolding (4 files) + Jest + SLDS + `@wire`-vs-imperative + a11y | Full design-first flow | Delegated |
| `/sf-aura` | Aura component (recommends LWC first, only proceeds when Aura is genuinely required) | Full design-first flow | Delegated |
| `/sf-sobject` | Custom object metadata, name field, sharing model, list view, optional tab | Full design-first flow | Delegated |
| `/sf-field` | Custom field on any object — every type with impact analysis via `sf-context-explorer` | Full design-first flow | Delegated |
| `/sf-library-install` | External library install across 5 methods (Managed/Unlocked Package, vendoring, submodule, npm, static resource) — plan + approval + verify + decisions log | Standalone install | Auto-invoked when design.md `## Decisions` records a library adoption |
| `/sf-harness-update` | Upgrade installed harness-sf templates via manifest-driven diff. Thin wrapper over `npx harness-sf@latest update`. | Always | n/a |

Every skill is **ensure-mode**: target exists → modify (with diff approval gate); absent → create. There is no separate "create" vs "modify" command.

## Subagents (the tools skills call)

You don't normally invoke these directly — they're the building blocks `/sf-feature` and the artifact skills dispatch.

| Agent | Role | Used by |
|---|---|---|
| `sf-context-explorer` | Maps every metadata component touching an object — triggers, Flows, validation rules, workflows, LWC, Aura. Identifies Order-of-Execution conflicts. | All skills, every run |
| `sf-flow-analyzer` | Reads Flow XML and returns natural-language summary, trigger timing, side effects | `sf-context-explorer` (fan-out) |
| `sf-trigger-auditor` | Trigger ecosystem audit — recursion, bulkification, duplicate logic, anti-patterns | `sf-context-explorer` (fan-out when ≥2 triggers) |
| `sf-lwc-auditor` | LWC component audit — `@wire`, LDS cache, accessibility, performance | `sf-context-explorer` |
| `sf-bug-investigator` | 4-phase root-cause loop. Salesforce-aware: governor limits, OoE, sharing, async timing, mixed DML | `/investigate` |
| `sf-apex-test-author` | Production-grade Apex tests with self-verify loop (run → fix → re-run) | `/sf-apex`, all design-first skills' Step 7 |
| `sf-deploy-validator` | Pre-ship gate. SOQL injection, sharing, FLS, LWC Jest, `sf project deploy validate-only` | `/sf-feature` Step 7.5, `/sf-apex` standalone Step 8 |
| `sf-design-{ceo,eng,security,qa,library}-reviewer` | Risk-graded review of `design.md`. Tradeoff presenters — never block. | All design-first skills' Step 4, in parallel |
| `sf-apex-code-reviewer` | Static review of generated Apex against project conventions | Optional, post-write |

Reviewers are read-only (Write blocked at the hook layer). Analyzers can only Write to `.harness-sf/reports/{agent-name}/`. Writers (`sf-apex-test-author`, `sf-deploy-validator`) have explicit allow-lists. See "What's enforced vs advisory" below.

## What's enforced vs advisory

`harness-sf` mixes two layers. Hooks **enforce** at tool-call time so policy holds even when the model drifts; agent/skill prompts are **advisory** — they shape behavior but the model can deviate.

### Enforced by hooks (block at tool call)

These gates run as Claude Code hooks. **Project-local install only — `--global` does not install hooks.**

| Gate | What it blocks | Trigger | Escape hatch |
|---|---|---|---|
| Path guard | Subagent Write/Edit outside its declared path-prefix | `pre-write-path-guard.js` on every Write/Edit/MultiEdit | (per-agent — none; main agent unrestricted) |
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

`npx harness-sf init --global` installs agents/skills into `~/.claude/` so they're available across all projects, but **hooks are not installed** in that mode. Hooks read project-local state (`.harness-sf/.cache/`, `.harness-sf/PROJECT.md`, git HEAD) that doesn't exist user-wide.

A consumer project can mix the two: install agents/skills globally and run `npx harness-sf init --hooks-only` per project to add the enforcement layer.

Full hook reference (sentinel paths, exit codes, ordering): [`templates/hooks/README.md`](templates/hooks/README.md).

## Project config

Two-tier project-local config sits between agent prompts and project specifics:

- **`.harness-sf/PROJECT.md`** — team-shared, committed. Naming conventions, sharing default, forbidden patterns, Permission Set strategy, API version floor, coverage targets.
- **`.harness-sf/local.md`** — personal override, gitignored.

Both are auto-injected at session start (`session-start-context.js` hook), so skills' `Step 0.5` is a 1-line confirmation rather than a Read. Conventions become the `[recommend]` defaults in subsequent AskUserQuestion batteries.

## Commands

```bash
npx harness-sf init              # install into ./.claude/
npx harness-sf init --global     # install into ~/.claude/ (no hooks)
npx harness-sf init --hooks-only # add hook layer to an existing global install
npx harness-sf init --dry-run    # preview without writing
npx harness-sf init --force      # overwrite existing without prompts
npx harness-sf init --agents-only
npx harness-sf init --skills-only
npx harness-sf update            # upgrade existing .claude/ via manifest diff
npx harness-sf update --dry-run  # preview the upgrade
npx harness-sf update --force    # overwrite all conflicts (DESTRUCTIVE)
npx harness-sf list              # show available agents and skills
npx harness-sf help
```

## Layout

```
harness-sf/
├── bin/install.js          # npx entry point (zero-dep)
├── templates/              # single source of truth — copied to consumer's .claude/
│   ├── agents/             # subagents (analyzers, reviewers, writers)
│   ├── skills/             # slash-command skills (directory format)
│   ├── knowledge/          # SF reference cards (lazy-loaded by agents)
│   ├── hooks/              # project-local Claude Code hooks
│   └── _stubs/             # PROJECT.md / local.md / settings.json stubs
├── examples/sfdx-demo/     # end-to-end walkthrough fixture
├── harness/                # measurement & verification (not shipped to consumers)
└── package.json
```

## Design principles

- **Feature-first** — `/sf-feature` is the headline; artifact skills are the units it dispatches.
- **Context-first** — every skill calls `sf-context-explorer` before writing code.
- **Ensure, not create** — skills detect whether the target exists and branch into modify mode with a diff-approval gate. No silent overwrites.
- **No fix without root cause** — `sf-bug-investigator` enforces a 4-phase loop.
- **Self-verify** — `sf-apex-test-author` runs tests and iterates on failures.
- **Security defaults** — `with sharing`, FLS/CRUD checks, escaped dynamic SOQL, no hardcoded IDs.
- **Permission separation** — object/field skills don't touch profiles; permission sets are the path.
- **Output budgets** — agents cap their reports (≤80 lines runtime, full detail in `.harness-sf/reports/`) so context doesn't explode.
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
