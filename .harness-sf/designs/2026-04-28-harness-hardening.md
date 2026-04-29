---
type: feature
name: harness-hardening
date: 2026-04-28
author: mjkang2539
status: draft-v2
revision: 2
---

# harness-sf measurement, reproducibility, safety, observability, and control hardening

## Why (background / problem)

Today `harness-sf` is solid on the **guardrails** side of an agent harness — separation of templates/agents and templates/skills, ensure-mode invariants, 5-persona review, enforced call graph, etc. But the harness's core property — **measurability** and **reproducibility** — is missing.

Specific gaps:

1. Prompt changes can cause regressions and we have no automatic way to detect them (`npm test` is just a `--help` smoke test).
2. No way to measure impact on model upgrade (Opus 4.7 → 4.8, etc.).
3. The security/quality of generated Apex/LWC depends only on *prompt promises* — no static-verification layer.
4. Skill execution cost / failure patterns are invisible.
5. Users can't preview output without modifying force-app.

Goal: give the harness a self-verification skeleton so it doesn't silently drift over time.

### Incident basis (as of 2026-04-28)

There are **no** explicitly recorded incidents (per CEO review). This plan acknowledges it as **preventive infrastructure**. Therefore the prioritization in this design follows these principles:

- **Phases 1, 2, and 3 are justified without incidents** — drift / credential leakage / generated-code defects all destroy user trust by the time the incident occurs. Insurance.
- **Phases 4 and 5 are gated on "after X weeks of real-usage data"** — if weekly skill executions are below N, backlog them. The concrete N is settled in Decisions.
- **The 8 starter fixtures in Phase 1 are also a hypothesis-based exercise without incidents** — when the first incident happens, adding 1 fixture targeted at it gives more accurate regression coverage. Treat the 8 as a starter set, not a mandatory count.

## Non-goals

- Adding new skills for the Salesforce domain itself.
- Changing the zero-dep principle of the installer (`bin/install.js`).
- Changing the single-source-of-truth principle of templates/.
- Integration testing against a real production org (fixtures only).

## Design principles

- **Keep the installer zero-dep** — new infra is isolated under `harness/` or `tools/`.
- **templates/ is the single source of truth** — the new verification layer *reads* templates but does not modify them.
- **Incremental adoption** — each phase must have independent value (stopping mid-way must leave no loss).
- **Fixture-first** — remove real-org dependency, CI-runnable.

## Architecture

```
harness-sf/
├── templates/                  # existing, no change
├── bin/install.js              # existing, stays zero-dep
├── harness/                    # NEW — measurement/verification infra (deps allowed)
│   ├── package.json            #   separate package — isolated from the installer
│   ├── fixtures/               # Phase 1
│   ├── runner/                 # Phase 1, 2
│   ├── eval/                   # Phase 1
│   ├── lint/                   # Phase 3
│   ├── observability/          # Phase 4
│   └── replay/                 # Phase 5
└── .harness-sf-runs/           # gitignored — local run log
```

---

## Phase 0: infrastructure foundation + contract definition (5–7 days, **expanded**)

Per review, freeze the contracts (interfaces / schemas / enums) that Phases 1/2/3/5 all depend on in Phase 0. Otherwise downstream phases incur reverse-direction rework.

### 0.1 Artifacts (infrastructure)

- `harness/package.json` (vitest, zod, static-analysis deps), `package-lock.json` committed, `npm ci` enforced.
- `harness/README.md` — per-phase usage guide.
- Update root `.gitignore` (`.harness-sf-runs/`, `harness/node_modules`).
- Root `package.json` `workspaces: ["harness"]` — **fixed (not optional)** — for a single CI entrypoint.

### 0.2 Artifacts (contracts — every downstream phase depends on these)

#### 0.2.a `AgentRunner` interface draft

```ts
interface AgentRunner {
  invoke(input: {
    skillOrAgent: string;          // e.g. "sf-trigger-auditor"
    fixturePath: string;
    modelId: string;               // pinning enforced, alias forbidden — date-stamped
    decisions?: DecisionsFile;     // AskUserQuestion mock
    onTrace?: (e: TraceEvent) => void;  // schema-agnostic emit
  }): Promise<RunResult>;
}
```

- Isolate SDK dependency behind this interface. Prefer `@anthropic-ai/claude-agent-sdk`, but keep a direct Messages API backend as a within-1-week swap option.
- SDK version-pin policy: `=X.Y.Z` exact, quarterly upgrade PR.

#### 0.2.b `decisions.json` schema (AskUserQuestion mock)

```ts
type DecisionsFile = {
  version: 1;
  responses: Array<{
    skill: string;
    questionId: string;       // stable ID assigned by the skill — no text matching
    answer: string | string[];
    deviationFromRecommend?: string;  // reason if not the recommended choice
  }>;
  onMissing: "fail" | "use_recommend";  // behavior when mock entry is missing
};
```

- Skill side: every AskUserQuestion call must carry a `questionId` — survives even if the question text changes.
- Runner side: tool_call interceptor hooks the `user_question` tool → look up by `questionId`.

#### 0.2.c run-log schema (used by Phase 2)

```
runs/{ISO}/
├── meta.json         # whitelisted fields only (security)
├── input.md          # design.md snapshot (redacted)
├── trace.jsonl       # turn-level: {turn, tool, input_hash, output_hash, tokens}
├── decisions.md      # user answers (redacted)
└── output-diff.patch # force-app changes
```

`meta.json` whitelist (no other fields permitted):

```ts
type Meta = {
  schemaVersion: 1;
  skill: string;
  modelId: string;          // date-stamped
  sdkVersion: string;
  startedAt: string; finishedAt: string;
  tokens: { input: number; output: number; cache_read: number };
  costUsd: number;
  failureClass?: FailureClass;  // 0.2.e
  fixturePath?: string;          // optional, set on fixture runs
};
// Forbidden: dumping process.env, headers, full args.
```

`trace.jsonl` granularity: per turn. **HTTP headers, Authorization, raw API key are forbidden** — runner adapter's responsibility.

#### 0.2.d `expected.json` schema + matching rules

```ts
type Expected = {
  intentionallyVulnerable?: boolean;  // marks fixture as containing intentionally vulnerable code
  findings: Array<{
    category: string;           // closed enum, e.g. "trigger.recursion"
    severity: "high" | "medium" | "low";
    locator?: { file: string; symbol?: string };  // optional, for partial credit
  }>;
};
```

Matching rules (used by the Phase 1 score.ts):
- **Category is closed-enum exact match**. No text variants — the agent prompt is adjusted so output explicitly emits the `category` token.
- **Severity mismatch is partial credit 0.5** (right category caught, wrong severity).
- **Locator match adds partial credit** (file match +0.25, symbol match +0.25).
- **Finding not in expected → false positive** (the heart of `clean-baseline`).
- **Finding in expected but missing in output → false negative** (recall denominator).

#### 0.2.e `failure_class` enum (used by Phases 2/3/4)

```ts
type FailureClass =
  | "intent_insufficient"
  | "review_loop_exhausted"
  | "context_overflow"
  | "tool_denied"
  | "lint_failed"
  | "deploy_failed"
  | "user_abort"
  | "runner_error"
  | "mock_missing";       // no response in decisions.json
```

#### 0.2.f Snapshot normalization policy decision

**Choice: exact-match path** (semantic-unit comparison is backlogged into a separate design).

Normalization targets (exhaustive — update this design when implementation discovers more in Phase 1):

1. ISO timestamps → `<TS>`.
2. UUID v4 → `<UUID>`.
3. Absolute paths → `<ABS>` (only workspace-root-relative paths kept).
4. Token / cost numbers → `<N>` (in output other than the run log).
5. SF 15/18-char IDs → `<SFID>`.
6. e-mail → `<EMAIL>`.
7. `sk-ant-*`, `Bearer *`, Authorization patterns → `<REDACTED>`.
8. Trim trailing whitespace, collapse multiple blank lines into one.
9. Markdown table padding → single space.

**Not normalized**: Korean particle variants, synonyms, numbering — treated as drift signals.

Implemented as a single module `harness/runner/normalize.ts`, with mandatory unit tests.

### 0.3 Phase 0 Definition of Done

- The 6 contract documents above (`harness/contracts/*.md`) written + `zod` schema code.
- A mock `AgentRunner` implementation (returns fixed output without real LLM calls) — lets Phase 1 fixture authors do contract testing.
- Normalization module + unit tests pass.
- CI workflow skeleton (job definitions only, no actual execution yet).

---

## Phase 1+3a: Eval/Fixture + immediately applicable Static Lint **in parallel** (2–3 weeks)

Per CEO review (HIGH): the parts of Phase 3 lint rules that **don't require an LLM call (Phase 3a)** run in parallel with Phase 1. Cross-phase verification of "fixture triggers lint rule" is handled in the same PR cycle (per QA [required]).

- **Phase 3a (parallel)**: PMD/eslint static lint — no LLM, zero cost. Rules: missing `with sharing`, hardcoded ID, missing dynamic SOQL escape. Warn-only for the first 2 weeks, then error.
- **Phase 3b (depends on Phase 2, comes later)**: `@AuraEnabled` signature compatibility — needs comparison against run logs, so moved after Phase 2.

### Phase 1 body (eval)

### 1.1 Fixture curation

**Starter set of 8** (add upon incident — not mandatory).

Stuff per scenario under `harness/fixtures/sfdx-projects/`. Each fixture directory:

```
{name}/
├── force-app/                  # minimal sfdx layout
├── sfdx-project.json
├── expected.json               # expected finding categories + severity
└── README.md                   # 1–2 paragraphs of intent
```

Initial fixture list:

| Fixture | Intent | Expected findings |
|---|---|---|
| `trigger-recursion` | 2 Account triggers recurse | sf-trigger-auditor recursion flag |
| `flow-trigger-conflict` | Before-Save Flow + Apex Trigger | OOE conflict warning |
| `fls-missing-apex` | Missing with sharing + FLS-unchecked SOQL | security reviewer high risk |
| `governor-limit-lwc` | @wire N+1 pattern | sf-lwc-auditor anti-pattern |
| `mixed-dml` | Setup/non-setup DML mixed | trigger auditor |
| `hardcoded-id` | Profile/RecordType ID hardcoded | lint + security reviewer |
| `library-already-installed` | npm/04t already installed | library reviewer doesn't re-recommend |
| `clean-baseline` | Clean project, no issues | findings 0 (false-positive measurement) |
| `negative-malformed` | `sfdx-project.json` missing, empty Apex | runner graceful failure (`runner_error` emit, no crash) |
| `bulk-200-classes` | 200+ Apex classes | for measuring `context_overflow` threshold — Phase 4 budget gate validation |
| `composite-multi-finding` | recursion + missing FLS together | score.ts multi-finding calculation validation (per QA recommendation) |

**Fixture-stuffing rules (per Security HIGH)**:

- Standard header at the top of every vulnerable-code fixture Apex file:
  ```
  // INTENTIONALLY VULNERABLE — harness-sf test fixture only.
  // NOT for deployment. See expected.json `intentionallyVulnerable: true`.
  ```
- Fake SF ID format: `001FIXTURE000000001` (distinguishable from real ID format).
- Add `harness/fixtures/**` exclusion rules to repo root `.gitleaks.toml` / `.trufflehog.yml`.

### 1.2 Skill/Agent runner

`harness/runner/run-skill.ts` — runs one skill or agent on top of a fixture and captures output.
- Uses Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
- Model ID must be specified (env or CLI arg).
- Output normalization: mask timestamps, UUIDs, absolute paths.

### 1.3 Snapshot regression

Save `harness/eval/snapshots/{skill}/{fixture}.snap.md`. Use vitest `toMatchFileSnapshot`. On prompt edits, review the diff and update only intentional changes.

### 1.4 Scoring (precision/recall)

`harness/eval/score.ts` — match `expected.json` against actual output finding categories. Accumulate P/R per agent → `harness/eval/reports/{date}.json`.

### 1.5 CI

GitHub Actions:
- Per PR: fast snapshot diff (no model calls, just compare against existing snapshots).
- Nightly: full fixture × skill matrix + scoring.
- Cost cap: a single run < agreed $X.

**Done condition**: snapshot regression auto-detects prompt drift + 1 score-trend graph.

---

## Phase 2: Determinism / Run log (3–5 days)

### 2.0 Redaction layer (Security HIGH ×3 → single module)

**Every run-log write must pass through the redaction pass.** Location: `harness/runner/redact.ts`.

Target patterns (regex + unit tests):
- SF 15/18-char ID (`[a-zA-Z0-9]{15,18}` + first 3-char prefix validation) → `<SFID>`
- `sk-ant-[A-Za-z0-9_-]+` (Anthropic API key) → `<ANTHROPIC_KEY>`
- `Bearer\s+[A-Za-z0-9._-]+` → `<BEARER>`
- e-mail (`[^\s@]+@[^\s@]+\.[^\s@]+`) → `<EMAIL>`
- AWS access key (`AKIA[0-9A-Z]{16}`) → `<AWS_KEY>`
- Absolute path → workspace-relative.

Application points:
- Right before `input.md` and `decisions.md` are written to disk.
- Every line of `trace.jsonl`.
- `meta.json` only writes whitelisted fields, so redaction not strictly needed (zod validation enforced as a second safety net).

`AgentRunner` adapter responsibility:
- HTTP request/response headers absolutely never go into trace (Authorization, x-api-key, etc.).
- If the SDK exposes headers, the adapter strips them.

`.gitignore` guard: when `harness/runner/run-log.ts` first creates `.harness-sf/runs/`, check whether the consumer project's `.gitignore` has the entry; if not, add it. Show a warning banner on the dashboard's first page in case `git add` was already run.

### 2.1 Run log standard schema

Use the schema defined in Phase 0.2.c. `templates/skills/_shared/run-log-schema.md` — every skill must write a run log at its end. Location: consumer project's `.harness-sf/runs/{ISO}/`.

```
runs/2026-04-28T14-22-01/
├── meta.json         # skill name, model ID/version, tokens, cost, duration
├── input.md          # design.md snapshot
├── trace.jsonl       # agent call sequence
├── decisions.md      # AskUserQuestion answers
└── output-diff.patch # actual force-app diff
```

### 2.2 Model-pin enforcement

Standardize the `model:` field in each agent frontmatter. Validation script `harness/lint/check-model-pins.ts` → CI gate.

### 2.3 Eval integration

The Phase 1 runner also produces a run log. On model change, compare run logs to measure impact.

**Done condition**: every skill execution produces a run log + model-pin CI gate passes.

---

## Phase 3: Static safety verification layer (1 week)

### 3.1 Apex linter

`harness/lint/apex-rules.ts` — PMD ruleset + custom rules:
- Missing explicit `with sharing|without sharing|inherited sharing` → error
- Hardcoded 15/18-char ID regex → error
- `Database.query(...)` String arg without `String.escapeSingleQuotes` → error
- SOQL/DML without `Schema.sObjectType.X.fields.Y.isAccessible/isUpdateable` → warn
- `@AuraEnabled` method signature compatibility (run-log comparison) → error

PMD 6.55+ vendored under `harness/lint/vendor/` (offline CI).

### 3.2 LWC linter

Integrate `@salesforce/eslint-plugin-lwc` + `@lwc/eslint-plugin-lwc`.

### 3.3 Skill integration

After `/sf-apex` and `/sf-lwc` generate code → lint gate just before `sf-deploy-validator`. On failure, auto-regeneration loop (max 2 retries).

### 3.4 Mandatory deploy-validator gate

Promote from *recommended* to *skill termination if skipped*.

**Done condition**: Phase 1 fixtures `fls-missing-apex` and `hardcoded-id` are caught by lint alone.

---

## Phase 4: Observability (3–5 days)

### 4.1 Token/cost tracking

Aggregate `meta.json` → `harness/observability/aggregate.ts` → `.harness-sf/metrics.json` (per-skill P50/P95 tokens, cost, duration).

### 4.2 Composite skill budget

`/sf-feature` watches accumulated tokens of dispatched sub-skills. Above a threshold (e.g. 500K), prompt user-confirmation gate.

### 4.3 Failure taxonomy

On run-log failure, `failure_class` is required: `intent_insufficient | review_loop_exhausted | context_overflow | tool_denied | lint_failed | deploy_failed | user_abort`.

### 4.4 Dashboard

Static HTML dashboard (`harness/observability/dashboard/`). Single page that fetches `harness/metrics.json`.

**Done condition**: per-skill cost / failure distribution is visualized.

---

## Phase 5: Control surface (3–5 days)

### 5.1 Skill dry-run

`--dry-run` arg on skill invocation. Shorten the ensure-mode approval gate to "print diff and exit." Apply to all 5 artifact skills + sf-feature.

### 5.2 Replay

`harness/replay/replay.ts` — re-run with same model, same `input.md` + `decisions.md` from the run log. Compare output hashes → measure stability (same input → same output rate). Add "stability %" to the nightly score.

### 5.3 Bisect tool

Script that combines git bisect + harness eval when prompt regression occurs.

**Done condition**: dry-run output preview + automatic regression-commit identification.

---

## Execution order / dependencies

```
Phase 0 (infrastructure)
  └─> Phase 1 (eval) ──┬──> Phase 2 (run log)
                       │       └──> Phase 4 (observability)
                       │       └──> Phase 5 (replay/bisect)
                       └──> Phase 3 (lint)
```

**Total estimated duration**: 4–6 weeks (1 person, full-time).

## Decisions

Items confirmed at revision 2 (subject to user confirm):

| # | Item | Decision | Rationale |
|---|---|---|---|
| D1 | Phase 1 vs Phase 3 order | **Parallel (Phase 3a split)** | LLM-free lint is zero cost / immediate value. Only 3b is deferred. |
| D2 | Phase 4/5 gate | **Activate after weekly skill executions reach N=20** (confirm complete) | Meaningful distribution even at single-user / light-experiment scale. Re-evaluate in 1–2 months. |
| D3 | Phase 0 expansion | **Expand to 5–7 days, 6 contract artifacts mandatory** | Cuts off reverse-direction dependency from downstream phases. |
| D4 | Snapshot normalization path | **Exact-match + exhaustive normalization list** | Semantic-unit comparison is a separate design. |
| D5 | Model pin | **Keep alias (`claude-opus-4-7`)** *(deviation from recommend)* | User choice: convenience first + auto-accept Anthropic point releases. **Side effect — drift detection layer needed**: if the alias silently flips, snapshot/stability could mistake a model change for a prompt change. Mitigation: record the SDK-returned actual model id (not the alias, the actually resolved ID) in run log `meta.json`; alert on metrics dashboard when it changes. |
| D6 | PMD strategy | **Vendor regardless of size + SHA-256 checksum** *(deviation from recommend)* | User choice: offline CI / reproducibility absolute priority. Accept clone/storage cost. **Mitigation**: don't use git-lfs separately for the vendor directory + Dependabot/Renovate to make PMD updates visible. Mark binary in repo `.gitattributes`. |
| D7 | Lint enforcement | **Warn-only for first 2 weeks → error** | Minimize adoption friction. |
| D8 | PR split | **Phase 0 → Phase 1+3a → Phase 2 → Phase 3b → Phase 4 → Phase 5** | 5 PRs, each independently valuable. |
| D9 | workspaces | **Confirmed in use** | Single CI entrypoint. |
| D10 | Test limit acknowledged | **Embed "consistency, not correctness" in design body** | Semantic verification is a backlog (`harness-semantic-eval`). |
| D11 | Run-log location | **Consumer project's `.harness-sf/runs/` + `.gitignore` guard + redaction mandatory** | Isolation + security. |
| D12 | LWC eslint plugin | **`@salesforce/eslint-plugin-lwc` alone** | Better governance / docs. |

confirm complete (2026-04-28):
- D2: N=20 confirmed.
- D5: keep alias (deviation, rationale embedded above).
- D6: keep vendoring (deviation, rationale embedded above).
- D8: 5-PR split confirmed.

## Trade-offs / decision points (history)

1. **CI cost strategy**: (a) self-hosted runner + cache / (b) **[recommend]** affected fixtures only per PR / (c) nightly only once a week. — Reason for recommendation: fast PR feedback + cost control.
2. **PMD vendoring vs Docker**: **[recommend]** vendoring (offline CI possible, repo size grows ~30MB) / Docker (setup burden).
3. **Run-log location**: **[recommend]** consumer project's `.harness-sf/runs/` + auto-add to `.gitignore` / user home.
4. **Model-pin strictness**: **[recommend]** keep alias (`claude-opus-4-7`) + drift detection via run log / date-stamped (forces an upgrade PR every time).
5. **Phase 3 lint enforcement**: **[recommend]** warn-only for first 2 weeks → promote to error / error from day one.
6. **PR split**: **[recommend]** Phase 0+1 first as one PR → remaining steps as separate PRs / all 5 at once.

## Known risks (revision 2 residue)

Issues not fully resolved at revision 2 — monitor during implementation:

- **Whether the Agent SDK allows tool_call interception**: the `decisions.json` mock injection in Phase 0 assumes the SDK lets you hook the user_question tool. If verifying with the SDK fails, swap to a direct Messages API backend (possible within a week thanks to interface isolation in D5).
- **Behavior after Phase 3a auto-regeneration loop hits max 2 retries**: on `lint_failed` termination, what's the policy for partial force-app output — to be specified in `templates/skills/_shared/lint-gate.md` at implementation.
- **Stability threshold of 80%**: arbitrary. Collect distribution data after Phase 5 lights up, then retune.
- **Sufficiency of the 8-fixture starter set**: incident-driven addition policy — embed the fixture-addition procedure in `harness/fixtures/CONTRIBUTING.md`.
- **D5 alias drift**: if Anthropic swaps the model behind the alias, all snapshots can break at once. Mitigation embedded — record SDK-resolved model id in `meta.json` + dashboard alert. But when an actual swap happens, a human still has to manually separate meaningful regressions from model changes. Re-evaluate after the first alias-swap incident.

## Edge cases / undecided areas

- **Fixture's SFDX dependency**: assumes only `sfdx-project.json`, with static analysis only and no real `sf` CLI. deploy-validator integration fixtures need a separate marker.
- **Agent SDK API change**: `@anthropic-ai/claude-agent-sdk` is still evolving rapidly — keep an abstraction layer over the runner.
- **Skill's user-input dependency**: how do we fixture-stuff AskUserQuestion answers — pre-defined `decisions.json` + runner injects mock responses.
- **Snapshot's model non-determinism**: temperature 0 isn't fully deterministic — Phase 5's stability % is the measurement.

## Test Strategy

### Core limit (per QA review — explicitly stated at design level)

**This harness measures "consistency", not "correctness".**

- Snapshot regression: only checks whether output is *the same*. Passes even when the model is uniformly wrong.
- Stability %: only checks whether the same input yields the same output. "Uniformly bad output" is also stable.
- Precision/Recall: assumes `expected.json` is ground truth. The fixture author's judgment is the truth — errors in the fixture itself can't be caught.

This limit is an intentional trade-off. Semantic-unit accuracy verification (LLM judge, embedding distance, human review) is backlogged into a separate design (`harness-semantic-eval`). This plan's scope ends at the **drift detection skeleton**.

### Verification layers

- **Unit**: `score.ts` matching logic, `normalize.ts` normalization, `redact.ts` regex, each lint rule.
- **Contract**: zod schema (`expected.json`, `decisions.json`, `meta.json`) violations fail-fast.
- **Integration**: every skill against `clean-baseline` fixture → false positive 0. `negative-malformed` → graceful `runner_error` emit.
- **Cross-phase**: Phase 1 fixtures × Phase 3a lint rules matrix — also enumerate lint findings in each fixture's `expected.json`. Verify the `fls-missing-apex` Apex code actually triggers the lint rule before merging the PR.
- **Regression**: snapshot diff (Phase 1.3) + snapshot update governance (below).
- **Stability**: replay the same fixture 5 times → hash distribution of normalized output. **5 samples is the starter** — expand the sample if variance ≥ threshold. Threshold: stability < 80% triggers prompt/model re-review (decision-trigger definition).

### Snapshot Update Governance (per QA [required])

Reviewer checklist when a PR has snapshot diff:
1. Was the prompt/agent file changed alongside? — Yes → likely intentional change.
2. Does the diff expose missing-normalization patterns? — Yes → split a normalization-strengthening PR.
3. Semantic vs presentational change — eval category/severity changes are semantic; sentence-order/particles are presentational. Many presentational changes signal under-normalization.
4. Are there unrelated snapshot drifts in the same PR? — Yes → split.

Embed the checklist in `harness/CONTRIBUTING.md`.

## Reviews

Review date: 2026-04-28. CEO / Eng / Security / QA 4-persona. The Library reviewer is excluded since this design is a Node-infra plan, not an SF library adoption.

### CEO (approve-with-tradeoffs)

- **[high]** Is Phase 1 (eval) really the right first priority — Phase 3 (lint) is zero-cost / immediate-value, recommend running it first or in parallel.
- **[high]** `@anthropic-ai/claude-agent-sdk` dependency risk — adapter boundary design matters more than SDK choice.
- **[medium]** Why's business outcome unclear — recommend adding a paragraph of actual incident examples (without one, halve the scope).
- **[medium]** Phase 4/5 ROI is dubious — without real-usage scale data, dashboard/replay value is hard to measure. Consider moving to backlog.
- **[medium]** No rollback plan — Phase 3.3's "insert lint gate into skills" — is that a templates/ change? If so, resolve the conflict with the "templates is read but not modified" principle.
- **[low]** PMD vendoring 30MB — fine if custom rules are core value, otherwise prefer a managed Action.

### Eng (approve-with-risks)

- **[high]** Agent SDK runner abstraction is under-specified — the `AgentRunner` interface (method signatures) must be a Phase 0 artifact. Need an SDK version-pin policy.
- **[high]** Snapshot normalization strategy is incomplete — must decide exact-match vs semantic-unit comparison. Without it, you get either noise or blindness extremes.
- **[high]** AskUserQuestion mock protocol is undefined → could block Phase 1 CI — must move to Phase 0.
- **[medium]** Phase 2 → Phase 1 reverse dependency (run-log schema) — include schema in Phase 0 artifacts or make the runner schema-agnostic.
- **[medium]** Real PMD size could be 60–80MB — measure and record in Decisions.
- **[medium]** lint gate auto-regeneration max-2-retries failure behavior is undefined.
- **[medium]** Dashboard's metrics.json fetch path — file:// CORS issue, recommend generate-time inline HTML.
- **[low]** workspaces decision pending, stability sample/cost undefined, no `expected.json` schema.

### Security (approve-with-risks)

- **[high]** Run-log credential / PII leak — `decisions.md` / `trace.jsonl` stored in plaintext. If SDK trace contains Authorization headers, API key leaks. **Redaction pass + meta.json whitelist + .gitignore guard required**.
- **[high]** Fixturing vulnerable code — exposes via GitHub Code Search + secret-scanner false positives. Standard comment / `intentionally_vulnerable` flag / fake-ID format (`001FIXTURE000000001`).
- **[high]** Replay re-runs PII — redact before replay. Nightly only with PII-free fixtures.
- **[medium]** Agent SDK API key handling — forbid full `process.env` dump, whitelist fields.
- **[medium]** PMD vendoring supply chain — verify SHA-256 checksum + `CHECKSUMS.txt`.
- **[medium]** npm supply chain — commit `package-lock.json` + `npm ci`. Specify `@salesforce/eslint-plugin-lwc` vs `@lwc/eslint-plugin-lwc` choice.
- **[low]** Dashboard external lib SRI hash. design.md frontmatter `author` e-mail in plaintext.

### QA (approve-with-missing-cases)

- **[required]** No negative fixture (malformed-structure case). No bulk fixture (200+ classes). No composite anti-pattern fixture.
- **[required]** Normalization scope unspecified — flake risk. Without snapshot-update governance (intentional change vs drift checklist), regression-catcher degrades into change-resistance.
- **[required]** P/R matching criteria undefined (exact / substring / category hierarchy). No false-negative determination logic.
- **[required]** `decisions.json` schema undefined → everything breaks when a skill question changes (coupling not mitigated).
- **[required]** Stability 5-sample basis missing, hash comparison pre/post normalization unclear, no threshold.
- **[required]** No cross-phase verification that Phase 1 fixtures actually trigger Phase 3 lint rules. No `expected.json` migration plan.
- **[recommended]** No coverage of Permission fixtures or deviation paths.
- **Core limit**: the current Test Strategy measures "consistency", not "correctness" — both snapshot/stability pass "uniformly wrong output." The design must explicitly acknowledge this limit.
