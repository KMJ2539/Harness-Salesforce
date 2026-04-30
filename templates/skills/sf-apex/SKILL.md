---
name: sf-apex
description: Create or modify Salesforce Apex classes/triggers/batches/queueables/schedulables/REST resources (ensure semantics). Create if absent, modify after diff approval if present. Apply trigger framework, explicit sharing, FLS/CRUD guards, paired test class. Run sf-context-explorer first to analyze impact. Use for requests like "create an Apex class", "modify existing handler", "add/change Account trigger", "write a batch class".
---

# /sf-apex

Workflow that handles Salesforce Apex artifacts in **ensure mode** — create if absent, modify if present. The create/modify branch is decided by the tool.

## Supported artifact types
1. **Trigger + Handler** (per-object trigger + handler class)
2. **Service Class** (business logic)
3. **Selector Class** (SOQL encapsulation — fflib pattern)
4. **Batch Class** (Database.Batchable)
5. **Queueable Class**
6. **Schedulable Class**
7. **REST Resource** (`@RestResource`)
8. **Aura/LWC Controller** (`@AuraEnabled`)
9. **Invocable Action** (callable from Flow)

## Workflow

```
Step 0: Invocation mode detection (standalone vs delegated)
   ↓
Step 1: Deep Intent Elicitation (AskUserQuestion battery)        [standalone only]
   ↓
Step 1.5: Write design.md + first user review                    [standalone only]
   ↓
Step 1.7: Multi-perspective persona review (4 agents in parallel, max 3 loops)  [standalone only]
   ↓
Step 1.9: Review consolidation → user approval gate              [standalone only]
   ↓
Step 2 onwards: context-explorer + create/modify + tests + validator
```

### Step 0: Invocation mode detection

If the caller (main agent / `/sf-feature`) passes a feature design.md path and an artifact ID, this is a **delegated mode candidate**. Do not judge from prompt text alone — verify with the **delegated-mode sentinel**:

```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
- exit 0 + JSON `{mode, design_path, artifact_id, type, sub_skill}` → **delegated mode confirmed**
- exit 1 → no/expired sentinel → standalone mode, or request the caller to issue a token

**Delegated mode behavior**:
1. `Read` the feature design.md.
2. Extract the matching artifact entry from the `## Artifacts` section — type, name, role, dependencies, sharing modifier, and other intent information are there.
3. **Idempotency check (P3 — resume safety)**: read the canonical state.json for this feature slug (`.harness-sf/state/<slug>__r<rev>.json`). Find the entry with this `artifact_id`:
   - `status === 'done'` → exit immediately (no-op). Print `idempotent: <id> already done`.
   - `status === 'in_progress'` → ask the user via AskUserQuestion: `[Continue / Restart / Skip]`. Continue = proceed; Restart = reset state to `pending` then proceed; Skip = exit.
   - `pending` / `failed` / not yet present → proceed normally.
4. **Skip Step 1, 1.5, 1.7, and 1.9 entirely** — design and review have already been completed at the feature level.
5. Start from Step 2 (context-explorer). The intent source is the artifact section in the feature design.md instead of a user dialogue.
6. When code work completes, the caller (/sf-feature) updates status via `dispatch-state-cli done {slug} {id}` (canonical state.json under the hood) — this sub-skill only appends one line to design.md `## Dispatch Log`.
7. On failure, return an error summary to the caller (the caller handles `dispatch-state-cli fail`).

**Standalone mode** (default / no sentinel): start from Step 0.3 below.

### Step 0.3: Feature context gate (required when entering standalone)

Spend-time-on-design principle — gate once so a standalone artifact task does not bypass cross-cutting design review:

```bash
node .claude/hooks/_lib/check-feature-context.js
```

If the stdout JSON has `has_active_feature: true` and any `candidates` entry's type matches this skill (`apex`) with a pending artifact, propose a redirect via **AskUserQuestion**:

```
Active feature design.md found within the last 14 days:
  - {candidate.path} (pending: {N} — {artifact ids})

If this work is part of that feature, entering /sf-feature is recommended.
  [r] Redirect to /sf-feature (recommended)
  [s] Continue standalone — reason required
  [a] Abort
```

- `r` → instruct the user to invoke `/sf-feature` and exit this skill.
- `s` → take a 1–2 sentence reason and write a stub at `.harness-sf/designs/{YYYY-MM-DD}-{ClassName}-standalone.md`:
  ```yaml
  ---
  type: apex
  name: {ClassName}
  date: {YYYY-MM-DD}
  standalone_override: true
  override_reason: "{user input}"
  ---
  ```
  This stub is the starting point of Step 1. Force a redirect if no reason is given.
- `a` → exit.

If `has_active_feature: false` or no type match, the gate passes — proceed to Step 0.5.

Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1` (avoid using).

### Step 0.5: Project convention check

Project conventions (`.harness-sf/PROJECT.md` + `local.md`) are injected as context at session start by the SessionStart hook (`session-start-context.js`). No additional Read needed. If the injected conventions are not visible (hook-less environment), fall back to `Read .harness-sf/PROJECT.md` and `Read .harness-sf/local.md`. All later Steps apply those conventions as `[recommend]`.

### Step 1: Deep Intent Elicitation
**The legacy "ask only class type and name" is retired.** Collect all of the following via AskUserQuestion (skip what the user already volunteered, but verify):

**Basics**
- Type (one of the 9 above)
- Class name
- Target object (where applicable)
- Trigger timing/event (for triggers)

**Why (business)**
- What business problem this solves (one sentence)
- What goes wrong if it does not run (cost of failure)
- Why Flow / Validation Rule / Workflow cannot solve it

**What (scope)**
- Inputs: which objects/fields/events
- Outputs: data changes / external calls / events emitted
- Non-goals: things explicitly out of scope

**How (execution context)**
- Sync/async (trigger / @future / Queueable / Batch / Schedulable)
- Expected record volume (1 / 200 bulk / 100k batch)
- Whether external callouts are involved
- User context (UI / API / Apex caller)
- Sharing modifier (pick one of 4 candidates — see policy section)

**Edge cases (counter-questions for blind spots)**
- Behavior under bulk insert 200+
- Recursion (self-object update)
- Mixed DML (Setup + Non-Setup)
- Rollback scope on exception
- null / empty / unauthorized user

**Test strategy**
- Which of positive / negative / bulk / governor-boundary cases to test
- Assertion intent (mere execution pass vs state verification)

### Step 1.5: Write design.md

Save the collected answers to `.harness-sf/designs/{YYYY-MM-DD}-{ClassName}.md` using this schema:

```markdown
---
name: {ClassName}
type: apex
subtype: trigger-handler / batch / queueable / ...
target-object: Account
created: 2026-04-27
harness-sf: 0.1.x
---

# {ClassName} Design

## Why (Business)
...
## What (Scope)
- In: ...
- Out: ...
- Non-goals: ...
## How (Execution)
- context: synchronous / before update
- volume: up to 200 records per transaction
- sharing: with sharing  [recommend]
- order-of-execution: after Before-Save Flow "X", before Validation Rules
## Edge Cases
- bulk: ...
- recursion: ...
- mixed DML: ...
- failure mode: ...
## Test Strategy
- positive: ...
- negative: ...
- bulk: ...
- governor boundary: ...

## Reviews
(auto-filled by Step 1.7)
```

Right after saving, show the user the design.md path and request the first review — gate of "confirm intent before proceeding".

### Step 1.6: design.md confirmation queries (recommend + business reasoning)

Right after the design.md draft, counter-question the items requiring user confirmation via AskUserQuestion. **Recommend is business-first** — judged from the cost of incidents/rollbacks/loss of trust.

**Question format**:
```
[Item]: <decision required>
[Candidates]: <options + [default]/[recommend] tags>
[Recommend reasoning — business-first]: <one sentence>
[Technical reasoning]: (one line if any)
```

**Confirmation categories** (only those that apply):

1. **Sharing modifier**: `with sharing` / `without sharing` / `inherited sharing` / omitted
   - recommend: `with sharing`.
   - Reason: "Bypassing sharing has data-exposure incident cost greater than operational convenience. Always enforce unless an intentional system context."

2. **Async vs sync execution context**: trigger / Queueable / Batch / @future / Schedulable
   - recommend (high volume): **"Queueable or Batch"**.
   - Reason: "When a sync trigger hits governor limits, users feel 'save failed' — trust loss. Async separation prioritizes user-experience stability."

3. **Trigger framework adoption**: new vs extend existing handler
   - recommend: if any trigger already exists on the object, **"extend existing"**.
   - Reason: "Two or more triggers on one object cause frequent OoE-conflict incidents in production. Operational cost of duplicate triggers exceeds the cost of code separation."

4. **Test data strategy**: `@TestSetup` / inline / Test Data Factory
   - recommend: if the same data is used 4+ times or object dependencies are complex, **"Test Data Factory"**.
   - Reason: "Duplicated test data fails N tests at once when a new required field is added — heavy deploy-blocking cost."

5. **Error handling policy**: throw / catch + log / partial rollback
   - recommend (for business transactions): **"partial rollback (`Database.SaveResult` + savepoint)"**.
   - Reason: "Failing 200 records over one bad record damages user trust. Partial success delivers more business value than strict consistency."

6. **External exposure (`@AuraEnabled` / `@RestResource`)**: exposed / not exposed
   - recommend: if the feature intent does not specify external callers, **"not exposed"**.
   - Reason: "Exposure surface incurs security review + version compatibility burden. Adding it later is cheaper than exposing prematurely."

**Application rules** (same as `/sf-feature`):
- Items already answered in design.md → short confirmation only
- Ambiguous items → full question
- If the user picks something other than recommend, record the reason in the design.md `## Decisions` section
- Bundle 1–3 items per question

Reflect results in design.md, then proceed to Step 1.7.

### Step 1.7: Persona Reviews (parallel, max 3 loops)

Use the `Agent` tool to **invoke these 5 in parallel from a single message**, with the design.md path as input:
- `sf-design-ceo-reviewer` — business / alternative tradeoffs
- `sf-design-eng-reviewer` — OoE / governor / bulkification / async appropriateness
- `sf-design-security-reviewer` — sharing / FLS / dynamic SOQL / @AuraEnabled exposure
- `sf-design-qa-reviewer` — test strategy adequacy, missing cases, assertion quality
- `sf-design-library-reviewer` — direct implementation vs adopting an existing trigger framework / logging / mocking library (inventory-grounded, category recommendations)

Each reviewer returns **only tradeoffs and risk grades** — no block verdicts.

### Step 1.9: Review consolidation + per-risk user approval gate

Show the 5 reports as a consolidated dashboard. **No bulk [P]roceed** — force an explicit user decision per `[H#]`/`[M#]` risk.

```
=== Design Review for {ClassName} ===

[CEO]      approve-with-tradeoffs
[Eng]      approve-with-risks       (H1, M1)
[Security] approve
[QA]       approve-with-missing-cases (H1)
[Library]  approve-with-risks       (M1)

Total risks: HIGH 2 / MEDIUM 2 / LOW ?

[1/4] [eng] H1: OoE may race with Before-Save Flow "X"
  [1] Proceed — accept as-is (one-line reason required)
  [2] Revise — augment design.md (re-invoke that persona)
```

**Per-risk decision loop**:
- Iterate every `[H#]`, `[M#]` risk; force [1]/[2]. A 1-line reason (8+ chars) is mandatory.
- Any HIGH at [2] → revise design.md and re-run Step 1.7 (only that persona).
- All HIGH at [1] → reasons auto-fill design.md `## Review Resolution` → proceed to Step 1.92.
- MEDIUM same [1]/[2], but consider re-invocation cost for [2].
- LOW is not asked.
- "Defer/redesign" variants are expressed as [1] + 1-line reason ("defer: phase 2", "redesign: structure rethink").

**Iteration cap**: 5 revisions total, or HIGH from the same persona twice in a row → require explicit override (reason recorded in Resolution).

Show progress counter `[3/N]`.

The final review result is recorded in design.md `## Reviews` (traceability).

### Step 1.92: Issue design approval sentinel (required)

When Step 1.9 passes as approve / approve-with-tradeoffs, **immediately** run via Bash:

```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ClassName}.md
```

Without this sentinel, new file Writes under force-app/main/default/{classes,triggers,...}/ from Step 3 onward are blocked by `pre-create-design-link-gate.js` (TTL 2h + git HEAD match). MODIFY mode is handled by a separate sentinel (`issue-modify-approval.js`). Only proceed when the issuance command output shows `approved DESIGN: ...`.

### Step 1.93: Score recording (advisory)

Right after the approval sentinel:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {ClassName}
```
Reporting only. Not a block. Recommended to call `score-cli.js record {slug} code_review|test|deploy <0-10>` after each of `sf-apex-code-reviewer` / `sf-apex-test-author` / `sf-deploy-validator` passes.

### Step 1.95: Library adoption (when applicable)

If the design.md `## Decisions` includes a new library adoption (Library reviewer recommendation accepted, or user direct decision), invoke `/sf-library-install` in **delegated mode** before Step 2:
- Input: design.md path + library list to adopt
- The install skill performs plan approval → execute → verify → record in `.harness-sf/decisions.md` → return to this skill
- On install failure, report to the user and confirm whether to proceed with Step 2 (fall back to direct implementation)
- If no adoption decisions, skip this step.

### Step 2: Context analysis (required)
**Invoke `sf-context-explorer` via the `Agent` tool** — pass the target object and the change intent.

Summarize the returned Context Pack to the user:
- If a trigger already exists on the same object → recommend "extend the existing handler instead of a new trigger"
- If a Before-Save Flow already handles the same logic → ask the user to choose "extend Flow vs Apex"

### Step 2.5: Mode decision (CREATE vs MODIFY)

Check whether the target class/trigger file exists (`Glob force-app/**/{Name}.cls`, etc.):

**Absent → CREATE mode**: continue from Step 3.

**Present → MODIFY mode**:
1. `Read` the existing file.
2. **Preserve** the following:
   - `with sharing` / `without sharing` / `inherited sharing` modifier (changing requires explicit user approval)
   - Implemented interfaces (`Database.Batchable`, `Schedulable`, `Queueable`, `Database.AllowsCallouts`, `RestResource`, etc.)
   - Annotations like `@AuraEnabled`, `@InvocableMethod`, `@TestVisible`
   - public/global signatures (avoid breaking external callers)
3. Build a **diff plan** between the change intent and existing code — which methods to add/modify/remove.
4. **User approval gate**: show a diff preview and never write before confirmation. No silent overwrites.
5. **Issue approval sentinel (required)**: immediately after the user's "y/proceed", and before Edit/Write, issue via Bash:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../{Name}.cls
   ```
   The `pre-modify-approval-gate.js` hook blocks Edit/Write without a sentinel (TTL 30 min + git HEAD match). When modifying multiple files (trigger/handler), pass them all as arguments at once. Issuing a sentinel without user approval is a policy violation.
6. If a test class (`{Name}Test.cls`) exists, record its path — must be re-run in Step 5.
7. For a trigger: keep the "one trigger per object" rule — handle by adding events / extending handler delegation in the existing trigger, not by creating a new one.

### Step 3: Convention detection
Auto-detect project conventions:
- `Glob force-app/**/classes/*Trigger*Framework*.cls` → trigger framework presence
- `*Selector*.cls` → selector pattern usage
- `*Service*.cls` → service-layer pattern
- Read sourceApiVersion from `sfdx-project.json`
- Infer naming conventions (PascalCase, suffixes, etc.)

### Step 4: Generation

**Base principles (every class)**
- Sharing modifier — present all candidates with `[default]` / `[recommend]` tags and let the user pick. Whatever is chosen, **must be explicit** (omitted modifier = `[default]` but not security-recommended):
  - `with sharing` — **[recommend]** enforces caller's sharing rules. Default for normal business logic.
  - `without sharing` — ignores sharing (system context). Only intentional cases like batch/scheduler/shared utilities. When chosen, force a top-of-class comment recording the reason.
  - `inherited sharing` — follows caller context. Meaningful for Aura/LWC `@AuraEnabled` controllers with diverse call paths.
  - (modifier omitted) — **[default]** the compiler-accepted default state. Legacy behavior similar to `without sharing` — **do not pick**, always force one of the three above.

  If the user does not choose explicitly, apply `[recommend] = with sharing`. Same rule for trigger handlers.
- Use `sourceApiVersion` from `sfdx-project.json` for the API version
- Use `sourceApiVersion` from `sfdx-project.json` for the API version
- Apply `cacheable=true` on `@AuraEnabled` methods when possible
- CRUD/FLS check before DML: `Schema.sObjectType.X.isCreateable()` or `WITH USER_MODE`
- Dynamic SOQL must use `String.escapeSingleQuotes` or bind variables
- Never hardcode IDs — use Custom Setting/Custom Metadata/Label

**Trigger pattern**
```apex
trigger AccountTrigger on Account (
    before insert, before update, before delete,
    after insert, after update, after delete, after undelete
) {
    new AccountTriggerHandler().run();
}
```
- One trigger per object
- Declare every context (even unused) — for future expansion
- Body delegates to handler only

**Handler pattern (assumes a TriggerHandler base class)**
- Per-context methods like `beforeInsert`, `afterUpdate`
- `Map<Id, SObject>`-based bulkified processing
- Recursion guard (static Boolean if base class does not provide one)

**Batch pattern**
- All of `start`, `execute`, `finish` aware of governor limits
- Recommend explicit scope size (default 200)
- Chained jobs use `Database.executeBatch` from `finish`

### Step 5: Paired tests (create or augment)
**Invoke `sf-apex-test-author` via the `Agent` tool** — pass the target class path.
- CREATE mode: write a new test class.
- MODIFY mode: re-run existing tests first to confirm regression status → add/augment tests for new branches.
Use the self-verify loop to confirm tests pass and coverage is met.

### Step 6: Validation
**Invoke `sf-deploy-validator` via the `Agent` tool** (quick mode) — static analysis only.
Confirm no risk signals on SOQL injection / sharing / FLS, etc.

### Step 7: Report
To the user:
- List of created files (path)
- Summary of patterns applied
- Recommended next steps (deploy validate, ship, etc.)

## AskUserQuestion policy
Ask the user when the following are unspecified:
- Class type (one of 9)
- Class name
- For triggers: object, events
- Sharing modifier — present 4 candidates with `[default]`/`[recommend]` tags and require explicit selection (default to `with sharing` if no response)

## Antipattern rejection
- Reject logic written directly in the trigger body — force into handler
- Reject 2+ triggers per object — push toward extending existing trigger
- Reject paired tests with no assertions

## Artifact locations
- Class: `force-app/main/default/classes/{Name}.cls` + `.cls-meta.xml`
- Trigger: `force-app/main/default/triggers/{Name}Trigger.trigger` + `.trigger-meta.xml`
- Test: `force-app/main/default/classes/{Name}Test.cls`
