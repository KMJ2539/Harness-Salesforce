---
name: sf-feature
description: Entry point for Salesforce composite-module/domain-level work. Handles cross-cutting features (SObject + fields + Apex + LWC + Permission Set, etc.) — not single classes/LWCs — with one intent definition + one 5-persona review (CEO/Eng/Security/QA in parallel → Library sequentially). After approval, dispatches per-artifact sub-skills (sf-sobject, sf-field, sf-apex, sf-lwc, sf-aura) in dependency order. Use for composite requests like "build the order module", "add the billing domain", "implement the Account 360 view".
---

# /sf-feature

A meta-skill that handles a composite Salesforce module via **one intent → one design → one review → dependency-ordered dispatch**. The orchestrator above the per-artifact skills (`/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-field`, `/sf-aura`).

## When to use this skill

- The user request is bigger than a single artifact, at the domain/feature level ("order module", "payment flow", "Account 360 view", "subscription renewal system")
- Multiple artifacts (SObject + fields + Apex + LWC + …) are bound by **one intent**
- Artifacts have dependencies that make ordering important

For a single artifact (one Apex, one LWC), use the sub-skill directly.

## Workflow

```
Step 1: Feature Intent Elicitation
   ↓
Step 2: Decomposition → artifacts + dependency graph
   ↓
Step 3: Write composite design.md
   ↓
Step 4: 5-persona review (CEO/Eng/Security/QA 4 in parallel → Library 1 sequentially, once at feature level)
   ↓
Step 5: User approval gate (max 3 Edit loops)
   ↓
Step 6: Dispatch sub-skills in dependency order (delegated mode)
   ↓
Step 7.5: Auto deploy validate + auto-fix loop (mechanical/logical classification + design-consistency gate, cap 4)
   ↓
Step 8: Report
```

### Step 0.3: Resume detection (P3)

Before any new intent collection, check whether an in-flight feature dispatch already exists. If so, present the user a 3-way choice instead of starting from scratch.

```bash
node .claude/hooks/_lib/dispatch-state-cli.js list-incomplete
```

The command returns a JSON array of slugs whose canonical state has at least one artifact in `pending`/`in_progress`/`failed`. Stale state (mtime > 7 days) is hidden by default — re-run with `--all` only if the user explicitly references an old feature.

**Branching**:
- Empty array → proceed to Step 0.5 (no in-flight work).
- One or more entries → ask the user via AskUserQuestion:

  ```
  Found in-flight feature: <slug> (<incomplete> incomplete, <age_days>d old)
    [1] Resume — re-enter Step 6 (dispatch); skip intent/decomposition/review
    [2] Show status — print full state and ask again
    [3] Start new — begin a fresh feature (the old slug stays as-is)
  ```

If user picks **Resume**:
1. `node .claude/hooks/_lib/dispatch-state-cli.js resume <slug>` — flips every `failed` artifact back to `pending` and prints `{next, done, total, all_complete}`.
2. Verify the design approval sentinel for that slug. If TTL expired:
   - design.md body hash unchanged → re-issue automatically (`issue-design-approval.js`); no user re-confirmation needed (same design, same decisions).
   - design.md body hash changed → reject resume; instruct the user to start a new revision (`/sf-feature` with the same slug + revision bump).
3. Skip Step 1–5 entirely. Jump to Step 6 starting from the `next` artifact id printed by `resume`.

If user picks **Show status**: run `dispatch-state-cli.js status <slug>` and re-prompt.

If user picks **Start new**: continue to Step 0.5 normally. Do not delete the existing slug's state — name collision is the user's responsibility.

The explicit form `/sf-feature resume <slug>` (slug given on entry) skips the AskUserQuestion and goes straight to the Resume branch.

### Step 0.5: Project convention check

Project conventions (`PROJECT.md` + `local.md`) are injected as session-start context by the SessionStart hook. No additional Read needed. If injection is not visible (hook-less), fall back to `Read .harness-sf/PROJECT.md` and `Read .harness-sf/local.md`.

When dispatching to a sub-skill, embed the key convention defaults in the feature design.md — sub-skills do not re-run Step 0.5 in delegated mode, so they must be consolidated once at the feature level for consistency.

### Step 1: Feature Intent Elicitation

Collect **feature-level** information via AskUserQuestion. Do not ask about per-artifact details (those belong to sub-skills).

**Why (domain/business)**
- One sentence on the business concept this feature represents
- How it is currently handled (manual Excel, another system, none)
- What goes wrong without this feature (cost of failure)
- Why standard Salesforce features (Opportunity, Order standard object, Sales Cloud, etc.) cannot handle it

**What (scope)**
- 3–5 core user actions (e.g. "create order", "track order status", "cancel order")
- Data shape — which entities are required (1–2 representative objects)
- External system integration?
- Non-goals: things this feature will not do

**How (operations/scale)**
- User personas (sales, ops, external partner, etc.)
- Expected transaction volume (10/day / 1k / 100k)
- Security requirements (org-wide / role-based / external exposure)
- Phase 1 vs future expansion plan

**Edge cases (feature level)**
- Concurrency: can multiple users edit the same record simultaneously?
- Data consistency: transaction boundaries
- Failure modes: external system down
- Migration: move existing data?

### Step 2: Decomposition

Decompose collected intent into an artifact list. Confirm via AskUserQuestion.

**Artifact categories**
- `sobject`: new Custom Object
- `field`: new or modified field (target object specified)
- `apex`: trigger / handler / service / batch / queueable / @AuraEnabled controller
- `lwc`: Lightning Web Component
- `aura`: Aura component (only when LWC cannot)
- `permission-set`: Permission Set (no sub-skill yet → guide + direct meta generation)
- `flow`: Flow (no sub-skill yet → guide only)

**For each artifact, collect**
- Artifact ID (e.g. `order-sobject`, `order-trigger-handler`, `order-form-lwc`)
- Type and name
- One-line role (what it owns inside this feature)
- Other artifacts it depends on (e.g. trigger handler depends on sobject and fields)

**Auto-infer dependency graph + user confirmation**
Fixed dispatch order (within a category, by authoring order):
1. sobject
2. field (deps: sobject)
3. apex (deps: sobject, field)
4. lwc / aura (deps: apex, sobject, field)
5. permission-set, flow

If a different order is needed (e.g. roll-up field on a parent object that depends on a child object — the child sobject must be first), confirm with the user.

### Step 3: Write composite design.md

Save at `.harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md`. Single file with feature intent + sketches of all artifacts.

**Schema**:
```markdown
---
name: {feature-slug}
type: feature
created: 2026-04-27
harness-sf: 0.1.x
artifacts: 7
---

# {Feature Name} Design

## Why (Business)
...

## What (Scope)
- Core actions: ...
- Entities: ...
- Non-goals: ...

## How (Operations)
- Personas: ...
- Volume: ...
- Security: ...
- Phasing: ...

## Edge Cases
- Concurrency: ...
- Failure modes: ...
- Migration: ...

## Artifacts

<!-- [status: ...] tags below are initial plan markers only — runtime status lives in canonical .harness-sf/state/<slug>__r<rev>.json. Do not edit these tags during dispatch. -->

### 1. order-sobject  [type: sobject]  [status: pending]
- API name: Order__c
- Sharing: Private  [recommend]
- Name field: AutoNumber ORD-{0000}
- Role: root entity of the order domain
- Depends on: -

### 2. order-status-field  [type: field]  [status: pending]
- Object: Order__c
- API: Status__c
- Type: Picklist (Pending, Confirmed, Shipped, Cancelled)
- Role: track order status
- Depends on: order-sobject

### 3. order-trigger-handler  [type: apex]  [subtype: trigger-handler]  [status: pending]
- Class: OrderTriggerHandler
- Sharing: with sharing  [recommend]
- Role: auto-record ShippedAt__c on Status change
- Depends on: order-sobject, order-status-field, order-shippedat-field

### ...

## Reviews
(auto-filled by Step 4)

## Dispatch Log
(records per-artifact completion timestamps and sub-skill results during Step 6)
```

After saving, show the user the design.md path and request the first review.

### Step 3.5: design.md confirmation queries (recommend + business reasoning)

Right after the first design.md draft, counter-question the **items requiring user confirmation** via AskUserQuestion. Each question must use this format:

```
[Item]: what decision is needed
[Candidates]: list every reasonable option with [default]/[recommend] tags
[Recommend reasoning — business-first]: one sentence. Not technical detail.
[Technical reasoning]: (one-line aside if any)
```

**Recommend is always written from a business-first perspective**:
- What reduces **incident cost / rollback cost / loss of trust**?
- What reduces **user confusion / operational complexity**?
- What balances **speed-to-launch vs regret cost**?
- When technical best practice conflicts with business reasoning, business wins

**Confirmation categories** (only ask those that apply, based on Why/What/How/Artifacts of design.md):

1. **Phasing**: all artifacts vs phase split
   - recommend: with 5+ artifacts or clearly phased intent, **"Phase 1 first"**.
   - Reason: "Cost of reversing a wrong decision exceeds the cost of fast full launch. Decide Phase 2 after watching usage for 6 months."

2. **Sharing model consistency** (when sObject involved): Private / Public Read Only / Public Read/Write
   - recommend: typically **`Private`**.
   - Reason: "Data-exposure incidents have customer-trust + compliance cost; a single incident dwarfs operational convenience ('visible to all')."

3. **Permission Set strategy**: single PS / per-persona split (e.g. Sales PS / Admin PS)
   - recommend: with 2+ personas explicitly listed, **"split"**.
   - Reason: "Starting with a single PS leaves no way to narrow blast radius on permission incidents. Splitting later costs more than splitting from day one."

4. **UI exposure scope** (when LWC involved): internal users / partner community / external customers
   - recommend: if unspecified, **"internal users only (Phase 1)"**.
   - Reason: "External exposure has different security/UX requirements. Validate internally first to minimize external-incident cost."

5. **External API exposure** (when Apex involved): @AuraEnabled / @RestResource / not exposed
   - recommend: if the feature does not state external integration, **"not exposed"**.
   - Reason: "More exposure surface means more security review + version management. Adding it later is cheaper than exposing prematurely."

6. **Data retention policy** (when sObject involved): hard delete / soft delete (Status=Deleted) / archive
   - recommend: business data (orders/contracts, etc.) → **"soft delete"**; transient data → **"hard delete"**.
   - Reason: "Recovery requests for deleted business data almost always come (audit/dispute/mistake recovery). Retention cost < irrecoverable cost."

7. **Audit / Field History Tracking** (sObject): on / off
   - recommend: for money/contract/state-transition fields, **"on (those fields only)"**.
   - Reason: "If 'who changed what when' cannot be answered during disputes/audits, operational cost explodes. Cost of enabling is negligible."

8. **Migration / handling of existing data** (modify mode or replacement system exists): migration script / new system only / parallel run
   - recommend: if existing data is stated, **"parallel run (Phase 1)"**.
   - Reason: "Cutover migration is unrollback-able on incident. Parallel-run cost < data-loss cost."

**Application rules**:
- design.md draft already has a clear answer → short confirmation "X declared in design.md, confirm? [Y/edit]" instead of a full question.
- Ambiguous or empty items → full question in the format above.
- Recommend is not forced — record reason in design.md `## Decisions` if user picks differently (the reviewer references it later).
- Bundle 1–3 questions at a time — manage user fatigue.

Reflect results in design.md (update sharing modifier in `## Artifacts`, add a `## Phasing` section, etc.) → proceed to Step 4.

### Step 3.9: design.md schema validation (required, before Step 4)

Right before invoking review, run via Bash to confirm design.md integrity:
```bash
node .claude/hooks/_lib/validate-design.js .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md
```
Items checked (auto-performed by validator):
- frontmatter `type: feature` + `name` required
- `## Artifacts` has ≥1 artifact, each with `[type: X]` tag + unique id
- All `Depends on:` reference defined artifact ids
- Dependency graph is a DAG (no cycles)
- Frontmatter `artifacts: N` matches actual count if specified

On failure, show the stderr diagnostics to the user, request design.md edits → revalidate. Must pass before entering Step 4.

On success, stdout returns JSON `{type, name, artifacts, order}` — that `order` becomes the dispatch order candidate for Step 6 (confirmed by the user).

### Step 4: 5-Persona Review (feature level, once)

**Two-stage invocation** — the library reviewer must use the other 4 reviewers' findings, so order is fixed.

#### Step 4a: Stage 1 — invoke 4 in parallel

Use the `Agent` tool to **invoke 4 simultaneously from a single message**, with design.md path as input.
- `sf-design-ceo-reviewer`
- `sf-design-eng-reviewer`
- `sf-design-security-reviewer`
- `sf-design-qa-reviewer`

Append each reviewer output verbatim to design.md `## Reviews` (each preserves its own `# CEO Review:` / `# Eng Review:` ... header).

#### Step 4b: Stage 2 — invoke Library reviewer sequentially

After the 4 outputs are reflected in design.md, invoke `sf-design-library-reviewer` (one). At entry it:
- Reads `.claude/knowledge/library-catalog.md` (mandatory if-then rules)
- Reads the Eng block in design.md `## Reviews`; if there are "framework / pattern / abstraction / shared module" risk keywords, uses them as library matching candidates
- Adds a `## Library Verdict` section at the end — classifies every artifact as one of `library-applied` / `library-recommended` / `library-not-applicable`

This order is **enforced, not optional** — `issue-design-approval.js` blocks sentinel issuance when verdict is missing via the `--check-library-verdict` gate.

#### Per-reviewer perspective

- **CEO**: feature ROI, what part can be done with standard features / external solutions, where to cut scope
- **Eng**: artifact decomposition fit, dependency graph reasonableness, transaction boundaries, async separation needs
- **Security**: feature-wide OWD/sharing consistency, external exposure surface, whether PS strategy is stated
- **QA**: feature integration test strategy (E2E scenarios), whether per-artifact unit tests sum up to feature verification
- **Library**: cross-artifact library consistency, missed catalog matches (trigger framework / selector / unit-of-work / http-mock / test-data / structured-logging), inventory-grounded reuse opportunities. Receives "framework/pattern" signals from Eng findings for follow-up recommendations.

Per-artifact details (sharing modifier choice, etc.) are deferred to the sub-skill stage — the feature review focuses on **structural fit**.

### Step 5: Review consolidation + user approval gate (per-risk decision)

**No bulk [P]roceed.** The user must explicitly decide per risk item — the spend-time-on-design principle does not allow "pass the bundle".

#### Step 5.0: Per-risk decision loop

Iterate every `[H#]` and `[M#]` entry in `## Reviews`. For each, force a choice via AskUserQuestion:

```
[3/7] [eng] H1: sharing modifier missing → add with sharing
  [1] Proceed — proceed without design changes (record reason in Resolution)
  [2] Revise — needs design.md augmentation (re-invoke that persona)
```

A 1-line reason (8+ chars) is mandatory with the answer — "why proceed" or "how to fix". This 1-line becomes the Resolution log entry. Empty/short responses are blocked by the sentinel and re-prompted.

Rules:
- **Any HIGH (`H#`) at [2]** → enter the Step 5.1.5 revision loop (re-invoke that persona only).
- **All HIGH at [1]** → reasons auto-fill the Resolution log, the user reviews once more, then proceed to Step 5.2.
- **MEDIUM (`M#`)**: same [1]/[2]. Be cautious about [2] re-invocation cost.
- **LOW (`L#`) is not asked** — ignorable.
- "Defer / phase 2 / redesign" variants are expressed as [1] + 1-line reason ("defer: phase 2", "redesign: rethink Order structure → abort phase 1").

CEO reviewer's `[H#]` Tradeoffs are also asked per item.

Progress counter: `[3/7] deciding H2...` to display progress.

#### Step 5.1: Write Review Resolution log (required before Step 5.2)

Add a `## Review Resolution` section to design.md — record user responses for every `[H#]` HIGH and `[M#]` MEDIUM risk. Reviewers have no block authority; the block is on *user non-response*.

Schema:
```markdown
## Review Resolution

### sf-design-eng-reviewer
- H1: switched handler to sync, future call separated into a queueable. (resolved)
- M1: keep batch size 200. AccountTrigger averages 50 records, 4x headroom. (not accepted)

### sf-design-security-reviewer
- H1: declared `with sharing`. (resolved)
- M1: deferred to phase 2, out of this feature's scope. (deferred)

### sf-design-ceo-reviewer
- H1: adopted standard Order object after review, custom Order__c dropped. (redesigned)
```

Rules:
- HIGH (`H#`) requires a response — one of "resolved / not accepted / deferred / redesigned" + reason 8+ chars.
- MEDIUM (`M#`) also needs a 1-line response — explicit "deferred" or "rejected".
- LOW (`L#`) is not mandatory — ignorable.
- Single-word responses ("ok", "accepted") are blocked by the sentinel.

After writing, the user reviews design.md once more and chooses [P]roceed.

On approval, proceed Step 5.2 → 5.5 → 6. The `## Artifacts` section of design.md is the dispatch task list.

#### Step 5.1.5: Targeted re-review (revision flow)

If 1+ items in Step 5.0 are [2] revise:
- Guide the user on which design.md section (`## What`, a specific artifact in `## Artifacts`, etc.) to edit.
- After edits, increment frontmatter `revision: N` to N+1, and record only the personas that issued the [2] risks in `revision_block_personas: [persona-1, persona-2]`.
- On Step 4 re-run, **invoke only those personas** in parallel (skip the others — cost saving).
- Mark previous review bodies as `(rev N, superseded)` in `## Reviews` while preserving — audit trace.
- If new risks emerge after re-invocation, re-enter the Step 5.0 per-risk decision loop.
- **Iteration cap**: if the same persona issues HIGH twice in a row, require explicit user override via AskUserQuestion:
  ```
  [persona] issued HIGH on both revision N and N+1. Proceed without further review?
    [1] Override — reason required (recorded in Resolution log)
    [2] Edit design further
    [3] Abort the feature
  ```
- Maximum 5 revisions — beyond that, force abort + tell the user "rethink the feature scope itself".

### Step 5.2: Issue design approval sentinel (required)

Right after approval, run via Bash:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{FeatureName}.md
```
Before issuing this sentinel, the issuer auto-runs `validate-design.js --check-resolution` — if `## Reviews` is present, it verifies that every HIGH/MEDIUM ID in `## Review Resolution` has a response. Issuance is blocked if any risk is unresolved, and flow returns to Step 5.1. One issuance unlocks force-app/ CREATE Writes for every dispatched sub-skill (`/sf-apex`, `/sf-lwc`, `/sf-sobject`) at once (TTL 2h, covering the entire dispatch window). Sub-skills run in delegated mode and do not issue their own sentinel — they reuse the feature-level one.

Bypass: `HARNESS_SF_SKIP_RESOLUTION_GATE=1` (avoid using — violates principle).

#### Step 5.3: Design score recording (advisory)

Right after the approval sentinel, compute a score:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {feature-slug}
```
The score is based on `## Reviews` resolution thoroughness — unresolved HIGH × −3, MEDIUM × −1, shallow × −0.5. The result is recorded at `.harness-sf/.cache/scores/{slug}.json` and the average is shown in the statusline. **Not a blocking gate** — for reporting and trend tracking.

Recording per-stage scores after dispatch is also recommended (optional):
- After code authoring + `sf-apex-code-reviewer`: `score-cli.js record {slug} code_review {0-10} --detail "🔴×N 🟡×M"`
- After tests pass: `score-cli.js record {slug} test {coverage%/10} --detail "..."`
- After `sf-deploy-validator`: `score-cli.js record {slug} deploy {pass?10:0} --detail "..."`

### Step 5.5: Library adoption (when applicable, once before dispatch)

If design.md `## Decisions` contains a feature-level library adoption (e.g. TriggerHandler, Nebula Logger), invoke `/sf-library-install` in delegated mode in batch **before** Step 6 dispatch:
- Input: design.md path + library list
- The install skill plans → executes → verifies → records each library in `.harness-sf/decisions.md`
- The inventory is refreshed before dispatch starts, so each sub-skill (`/sf-apex`, `/sf-lwc`) reviewer is aware of the new library when it runs.
- Skip if no adoption decisions.

### Step 6: Dispatch in dependency order

#### Step 6.0: Initialize dispatch state (required)

Once on entering Step 6 — persist the Step 3.9 validator's `order` result as a machine-readable state file:
```bash
node .claude/hooks/_lib/dispatch-state-cli.js init {feature-slug} \
  .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  '[{"id":"order-sobject","type":"sobject","sub_skill":"/sf-sobject"}, {"id":"order-status-field","type":"field","sub_skill":"/sf-field"}, ...]'
```
- `feature-slug`: the design.md frontmatter `name`, or extracted from the filename.
- artifacts JSON: in the validator stdout `order` order, each entry `{id, type, sub_skill}`.
- For types without a sub-skill (`permission-set`/`flow`), use `sub_skill: null` — guidance output only.

This file is the source of truth for the statusline `dispatch:X/N` display and for resuming progress on session loss.

Session resume case: if `dispatch-state/{slug}.json` already exists, ask the user "previous dispatch progressed to {idx}/{total}, continue?" then resume from `current_index`.

#### Step 6.1: Per-artifact dispatch loop

Process each artifact in `## Artifacts` in dispatch-state order. For each:

**1. Issue delegated token** (right before invoking the sub-skill, per artifact):
```bash
node .claude/hooks/_lib/issue-delegated-token.js \
  .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  {artifact-id}
```
TTL 30 minutes. The sub-skill's Step 0 verifies this token to branch into delegated mode.

**2. Set state to in_progress**:
```bash
node .claude/hooks/_lib/dispatch-state-cli.js start {feature-slug} {artifact-id}
```

**3. Invoke sub-skill** — pass:
- feature design.md path
- artifact ID to handle
- "Skip Steps 1–1.9 (intent / design / review) and start from Step 2 (context-explorer)"
- Note that the token has been issued — sub-skill verifies it in its own Step 0

The sub-skill reads the matching artifact section in design.md to grasp intent and proceeds with code work without its own design step. No per-artifact review (the feature review covers it).

**4. Record results** (canonical state.json is the single source of truth — never edit `## Artifacts [status: ...]` at runtime; that tag is an initial plan marker only):
- Success: `dispatch-state-cli.js done {slug} {id}` + one line append in design.md `## Dispatch Log` (e.g. `2026-04-30 14:23 order-handler done`)
- Failure: `dispatch-state-cli.js fail {slug} {id} "error summary"` + one line in `## Dispatch Log`, ask user [Retry / Skip / Abort]
- If a depended-on artifact is failed, mark subsequent dispatches as `skip` via `dispatch-state-cli.js` and report

For sub-skill-less items like `permission-set`/`flow`, output guidance and immediately mark `done` (or after the user does manual work).

### Step 7.5: Auto deploy validate + auto-fix loop (required)

Dispatch finishing is not the end. Auto-run validate-only + RunLocalTests; auto-fix mechanical errors (after design-consistency check), defer logical errors or design drift to the user. Iteration cap of 4 stops infinite loops.

#### Step 7.5.0: Initialize validate-loop state

```bash
node .claude/hooks/_lib/validate-loop-state.js init {feature-slug}
```

#### Step 7.5.1: Run deploy validate (auto-loop mode)

Invoke `sf-deploy-validator` via the `Agent` tool. State `--auto-loop {feature-slug}` context in the prompt — the agent Writes results to `.harness-sf/.cache/deploy-findings/{slug}.json`.

#### Step 7.5.2: Verdict branching

```bash
cat .harness-sf/.cache/deploy-findings/{feature-slug}.json | jq -r .verdict
```

- `ready` → proceed to Step 8 (report). Clean up validate-loop state (`reset` call).
- `blocked` → proceed to Step 7.5.3 classification.

#### Step 7.5.3: Error classification

```bash
node .claude/hooks/_lib/classify-deploy-error.js \
  .harness-sf/.cache/deploy-findings/{feature-slug}.json \
  --out .harness-sf/.cache/deploy-classify/{feature-slug}.json
```

Branch on classification (`auto_fix_eligible: true|false`):

- `auto_fix_eligible: false` (contains 1+ logical errors) → **do not attempt auto-fix**. Show classification table to the user + AskUserQuestion:
  ```
  Logical errors present, outside auto-fix scope.
    [1] Delegate to /sf-bug-investigator (root cause analysis)
    [2] Fix manually
    [3] Defer (no sentinel issued, follow-up by user)
  ```
- `auto_fix_eligible: true` (mechanical only) → enter the Step 7.5.4 auto-fix loop.

#### Step 7.5.4: Auto-fix attempts per mechanical error

Process each mechanical error in classification sequentially:

**(a) Generate fix proposal** — deterministic transformation per error category:

| category | proposal action | example |
|---|---|---|
| `field-not-found` (typo: code → existing field) | `typo` | `from: Recpient__c` → `to: Recipient__c` (canonical name in design) |
| `fls-missing-in-ps` | `add` | add fieldPermissions block in PS XML |
| `class-access-missing-in-ps` | `add` | add classAccesses block in PS XML |
| `cmt-record-missing` | `add` | create customMetadata/{type}.{record}.md-meta.xml |
| `ps-field-reference-stale` | `remove` | remove stale fieldPermissions line from PS |

**(b) Design-consistency check**:

```bash
echo '<proposal-json>' | node .claude/hooks/_lib/verify-fix-against-design.js \
  --design .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  --proposal -
```

`consistent: true` → (c). `consistent: false` → (d) 3-way branch.

**(c) Apply automatically (consistent)**:

1. Apply fix via Edit tool (file_path)
2. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} code-fix --note "<category>:<target>"` — auto-abort and delegate to user when cap reached
3. Once all mechanical errors are processed, loop back to Step 7.5.1 (revalidate)

**(d) 3-way branch (inconsistent — disagrees with design)**:

Force a choice via AskUserQuestion:

```
Mechanical auto-fix proposal disagrees with the design.
Target: {target} ({category})
Proposal: {action} {to_value}
Design evidence: {evidence_or_"not declared in design"}

  [1] Code correction — design is correct, apply auto-fix as proposed
  [2] Design correction — design is missing/incorrect, augment then re-dispatch
  [3] Defer — user decides manually
```

Per-branch handling:
- `[1]` → apply Edit + `incr code-fix`. Abort on cap.
- `[2]` → enter Step 7.5.5 design-correction loop.
- `[3]` → mark this error Skip, move to next mechanical error. After all mechanicals are processed (with any Skips), proceed to Step 8 noting "user follow-ups: N items".

#### Step 7.5.5: Design-correction loop (reuses Step 5.1.5 revision flow)

1. Use AskUserQuestion to narrow which artifact's which item to augment.
2. Edit design.md + increment frontmatter `revision: N+1` + record `revision_block_personas: [eng, library, (optional) security]`.
3. **Re-invoke only the affected personas** (re-run Step 4, but not all 4).
4. Update `## Library Verdict`.
5. Re-pass the resolution gate:
   ```bash
   node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{...}.md
   ```
6. Reset only affected artifacts in dispatch-state to `pending`:
   ```bash
   node .claude/hooks/_lib/dispatch-state-cli.js reset {slug} {affected-artifact-id} [...]
   ```
7. Re-dispatch the affected artifacts (Step 6.1).
8. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} design-fix --note "<artifact-id>: <change summary>"` — abort on cap.
9. Loop back to Step 7.5.1 (revalidate).

#### Step 7.5.6: When cap is reached

`incr` returns exit 1 + cap-exceeded:

```
Artifact 'X' triggered design corrections twice in a row at deploy stage,
or total auto-fix cap of 4 reached.

  [1] Redesign the feature scope (start sf-feature over)
  [2] Abort just this artifact, continue with the rest (mark exclusion in dispatch-state)
  [3] Override — force ahead without further corrections (1-line reason required, no validate sentinel issued)
```

Record the choice as one line in design.md `## Dispatch Log`.

### Step 8: Report

- Tree of created/modified files
- design.md final path + revision N
- Validate-loop state summary (`code-fix N times / design-fix N times / final verdict`)
- Recommended next steps:
  - User walkthrough for Permission Set assignment
  - Production org deploy (when validate sentinel issued, point to `sf project deploy start --pre-destructive-changes`)
  - Integration test scenarios (reflect design.md QA review results)

## AskUserQuestion policy

- Feature-level intent (Why/What/How/Edge Cases) — ask category-by-category if missing
- Artifact decomposition — verify only if user listed artifacts up front; otherwise ask per category whether needed
- Confirm if dispatch order needs to differ from the fixed order

## Redirect when a single artifact suffices

If decomposition yields only 1–2 artifacts with simple dependencies:
- Inform: "this is not feature-scale but a single artifact. Invoke `/sf-apex` directly is more appropriate."
- If the user still prefers sf-feature, proceed.

## Antipattern rejection

- 100 artifacts at once — too large. Recommend Phase 1/2 split.
- Dispatch without design.md — strictly forbidden. Intent definition + review must complete before dispatch.
- Dispatch ignoring dependencies (LWC referencing an sObject not yet present) — auto-blocked.
- Calling sub-skill design steps redundantly — delegated mode does not run design.

## Artifact location (the feature itself)

- Design only: `.harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md`
- Actual code/metadata: per the sub-skill artifact locations

## Invocation example

```
user> /sf-feature
user> Build the order module. Sales creates orders, tracks status, auto-timestamp on shipment.

skill> [Step 1] Battery of business/scope/operations/edge-case questions...
user> (answers)

skill> [Step 2] Decomposition proposal:
       1. Order__c sobject
       2. Order__c.Status__c picklist field
       3. Order__c.ShippedAt__c datetime field
       4. OrderTriggerHandler apex (Status → ShippedAt auto record)
       5. orderForm LWC (Record Page)
       6. Order_User permission set
       Proceed as-is? Add/edit?

user> Looks good

skill> [Step 3] Wrote design.md: .harness-sf/designs/2026-04-27-feature-order.md

skill> [Step 4] Invoking 4-persona review... (parallel)

skill> [Step 5] Review dashboard:
       [CEO] approve-with-tradeoffs — recommend reviewing Standard Order object
       [Eng] approve
       [Security] approve-with-risks — [MEDIUM] PS strategy must be specified
       [QA] approve-with-missing-cases — [required] concurrency cases
       [E]dit / [P]roceed / [A]bort?

user> E

(augment design.md → re-run Step 4 → pass)

skill> [Step 6] Begin dispatch (dependency order):
       → /sf-sobject (delegated, artifact: order-sobject)... ✓
       → /sf-field (delegated, artifact: order-status-field)... ✓
       → /sf-field (delegated, artifact: order-shippedat-field)... ✓
       → /sf-apex (delegated, artifact: order-trigger-handler)... ✓
       → /sf-lwc (delegated, artifact: order-form-lwc)... ✓
       → permission-set guidance output
       Done.
```
