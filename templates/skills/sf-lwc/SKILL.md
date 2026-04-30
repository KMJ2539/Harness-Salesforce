---
name: sf-lwc
description: Create or modify Lightning Web Components (LWC) with ensure semantics. Scaffold 4 files if no same-named component, modify after diff approval if present. Apply SLDS, choose @wire vs imperative, accessibility, paired Jest tests. Use for requests like "create an LWC", "modify existing component", "add a Lightning component field".
---

# /sf-lwc

Handle LWC components in **ensure mode** — create if absent, modify if present.

## Workflow

```
Step 0: Invocation mode detection (standalone vs delegated)
   ↓
[standalone only] Step 1 → 1.5 → 1.7 → 1.9
   ↓
Step 2 onwards: context-explorer + create/modify + tests + audit
```

### Step 0: Invocation mode detection

If the caller (typically `/sf-feature`) passes a feature design.md path + artifact ID, this is a **delegated mode candidate**. Do not judge from prompt alone — verify with the sentinel:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated mode confirmed; exit 1 → standalone.

**Delegated mode behavior**:
- Load the matching LWC artifact section from design.md `## Artifacts` (name, exposure location, data source, @api surface, etc.).
- **Idempotency check (P3)**: read canonical state.json for this slug. If this artifact id is `done` → exit no-op (`idempotent: <id> already done`). If `in_progress` → AskUserQuestion `[Continue / Restart / Skip]`. Otherwise proceed.
- Skip Steps 1–1.9.
- Start from Step 2; intent comes from design.md.
- On completion/failure, the caller (/sf-feature) updates status via dispatch-state-cli (writes canonical state.json) — this sub-skill only appends one line to design.md `## Dispatch Log`.

For standalone mode, start from Step 0.3 below.

### Step 0.3: Feature context gate (required when entering standalone)

Spend-time-on-design principle — gate to prevent a standalone LWC task from bypassing cross-cutting design review:

```bash
node .claude/hooks/_lib/check-feature-context.js
```

If the stdout JSON has `has_active_feature: true` and `candidates` includes a pending artifact of type=`lwc`, propose a redirect via AskUserQuestion:
- `[r]` → instruct user to invoke `/sf-feature` and exit.
- `[s]` → take a reason and write a stub `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}-standalone.md` (`type: lwc, standalone_override: true, override_reason: ...`). Force redirect if no reason given.
- `[a]` → exit.

If no matching candidate, pass. Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

### Step 0.5: Project convention check

Project conventions are injected by the SessionStart hook at session start. No additional Read needed. If injection is not visible (hook-less environment), fall back to `Read .harness-sf/PROJECT.md` and `Read .harness-sf/local.md`. Use convention defaults as `[recommend]` in subsequent Steps.

### Step 1: Deep Intent Elicitation
Collect all of the following via AskUserQuestion:

**Basics**
- Component name (camelCase, e.g. `accountSummary`)
- Exposure: App Page / Record Page / Home Page / Community / Quick Action / Flow Screen / child only
- Target object (if Record Page)
- One-line core function

**Why (user value)**
- What user task it simplifies/automates
- Why standard Lightning components / Record Page alone are insufficient
- Whether existing LWC reuse was considered

**What (scope)**
- Information shown: which fields of which object
- User actions: click/input/submit and resulting changes
- Non-goals

**How (data/communication)**
- Data source: LDS Wire / Imperative Apex / parent props / none
- If imperative chosen when LDS works, the reason
- Public surface to expose via `@api` (props/methods)
- Custom events emitted or Lightning Message Service channels
- Parent/child component relationships

**Edge cases**
- Contexts without a recordId
- Wire errors (permissions/network)
- Large list rendering (pagination/virtualization needed?)
- Use of external libraries restricted by Locker / CSP
- Mobile / narrow viewport

**Test strategy**
- Render smoke / @api change / @wire mock / event dispatch / error branch — coverage scope
- Whether to adopt automated accessibility checks (jest-axe, etc.)

### Step 1.5: Write design.md

Save at `.harness-sf/designs/{YYYY-MM-DD}-{componentName}.md`. Frontmatter `type: lwc`, with `subtype` covering record-page / flow-screen / etc. Body has Why/What/How/Edge Cases/Test Strategy/Reviews sections.

### Step 1.6: design.md confirmation queries (recommend + business reasoning)

Right after the draft, counter-question via AskUserQuestion. **Recommend is business-first** — judged from user experience / loss of trust / rollback cost.

Question format: `[Item] / [Candidates + default/recommend] / [Recommend reasoning — business-first] / [Technical reasoning]`.

**Confirmation categories** (only those that apply):

1. **Data access pattern**: LDS Wire / Imperative Apex / Custom UI API
   - recommend: for a single record / related list, **"LDS Wire"**.
   - Reason: "LDS gives caching, reactivity, and automatic FLS. Starting with imperative leads to cache-consistency-bug debugging, which damages user trust."

2. **Public surface (`@api`) size**: minimal / rich
   - recommend: **"minimal"** (recordId, mode, that level).
   - Reason: "More props = more external dependencies — N parents break on future changes. A small surface preempts the change cost."

3. **Event model**: dispatchEvent / Lightning Message Service / pubsub (deprecated)
   - recommend (sibling communication on the same page): **"dispatchEvent"**. Cross-page/tab: **"LMS"**.
   - Reason: "The wrong communication model raises maintenance burden — code complexity grows without user benefit. Simple is the business value."

4. **Error/loading UX**: Toast / inline message / silent
   - recommend: **"inline message + loading spinner"**.
   - Reason: "Toasts are easy to miss — users left in 'something failed but I do not know' is the largest trust loss."

5. **External exposure scope**: internal users / partner community / external customers
   - recommend: if unspecified, **"internal users (Phase 1)"**.
   - Reason: "External exposure has different Locker/CSP/a11y/i18n requirements. Validating internally first minimizes external-incident cost."

6. **Accessibility (a11y) automated checks**: adopt jest-axe / manual only
   - recommend: for external exposure or government/finance domains, **"jest-axe"**.
   - Reason: "a11y violations carry legal cost and fully exclude some users. Automated checks cost once, manual misses cost every time."

**Application rules**: short confirmation if design.md already answers, full question if not. Record in `## Decisions` if the user picks differently. Bundle 1–3 questions.

After reflecting results, proceed to Step 1.7.

### Step 1.7: Persona Reviews (parallel, max 3 loops)

Use the `Agent` tool to invoke 5 reviewers in parallel from a single message:
- `sf-design-ceo-reviewer` — review standard component / existing LWC reuse alternatives
- `sf-design-eng-reviewer` — LDS vs imperative appropriateness, @api surface size, performance patterns
- `sf-design-security-reviewer` — @AuraEnabled controller exposure, innerHTML/CSP, sensitive data
- `sf-design-qa-reviewer` — render / wire mock / event / error branch coverage
- `sf-design-library-reviewer` — base components / LDS modules / static resource reuse, npm dependency limits, LWS/Locker compatibility

### Step 1.9: Review consolidation + per-risk user approval gate

No bulk [P]roceed. Force [1] proceed / [2] revise per `[H#]`/`[M#]` risk + a 1-line reason (8+ chars) is mandatory. Any HIGH at [2] → re-invoke that persona only (revision N+1, update `revision_block_personas`). All HIGH at [1] → reasons auto-fill design.md `## Review Resolution` → proceed to Step 1.92. MEDIUM same; LOW not asked. Iteration cap: 5 revisions or HIGH from same persona twice in a row → require explicit override. Show progress counter `[3/N]`.

Detailed gate behavior is identical to `/sf-feature` Step 5 — refer to that section.

### Step 1.92: Issue design approval sentinel (required)

Right after approval, run via Bash:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{componentName}.md
```
Without it, new file Writes under `force-app/main/default/lwc/{componentName}/...` are blocked by `pre-create-design-link-gate.js` (TTL 2h + git HEAD match).

### Step 1.93: Score recording (advisory)

Right after the approval sentinel:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {componentName}
```
Reporting only. Not a block. Recommended to call `score-cli.js record {slug} code_review|test|deploy <0-10>` after each of `sf-lwc-auditor` / Jest results / `sf-deploy-validator` passes.

### Step 1.95: Library adoption (when applicable)

If design.md `## Decisions` includes a new library adoption (e.g. adopt jest-axe, register Chart.js as a static resource), invoke `/sf-library-install` in delegated mode before Step 2. Skip if no adoption decisions. Install results are recorded in `.harness-sf/decisions.md` so the next design's reviewer is aware.

### Step 2: Context analysis (when object-dependent)
If a target object is involved, **invoke `sf-context-explorer` via the `Agent` tool**.
- If existing LWC already uses this object → recommend "review reuse/extension" to the user
- Identify recommended fields (accessible, FLS-passing)

### Step 2.5: Mode decision (CREATE vs MODIFY)

Check whether the component dir exists via `Glob force-app/**/lwc/{name}/{name}.js`:

**Absent → CREATE mode**: continue from Step 3.

**Present → MODIFY mode**:
1. `Read` all 4–5 files (`{name}.js`, `.html`, `.css`, `.js-meta.xml`, `__tests__/{name}.test.js`).
2. **Preserve** the following:
   - Public API: `@api` property/method signatures (external parents/Flows depend on these — explicit user approval to change)
   - `targets` and `targetConfigs` (App Builder may be using them)
   - Names and detail shapes of emitted custom events
3. Identify the change area — judge whether the new feature can be added consistently with the existing data access pattern (LDS vs imperative).
4. **User approval gate**: show diff preview of which file gets which change → confirm before write. No silent overwrites.
5. **Issue approval sentinel (required)**: immediately after user approval, before Edit/Write, issue with all files-to-modify as args:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../lwc/{name}/{name}.js force-app/.../lwc/{name}/{name}.html ...
   ```
   The `pre-modify-approval-gate.js` hook blocks without a sentinel (TTL 30 min + git HEAD match). Issuing a sentinel without user approval is a policy violation.
6. If existing Jest tests exist, record path — re-run before the Step 7 audit.

### Step 3: Choose data access pattern

**LDS Wire (preferred)** — caching, reactive, automatic FLS
- Single record: `getRecord`
- Related list: `getRelatedListRecords`
- Picklist: `getPicklistValues`
- Object info: `getObjectInfo`

**Imperative Apex** — only when LDS cannot
- Aggregate, custom logic, complex joins
- Apply `cacheable=true` when possible

**Custom UI API** (REST) — for external system integration

### Step 4: Generate the 4 files

**`{name}.js` skeleton**
```javascript
import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';

import NAME_FIELD from '@salesforce/schema/Account.Name';

export default class ComponentName extends LightningElement {
    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: [NAME_FIELD] })
    record;

    get name() {
        return getFieldValue(this.record.data, NAME_FIELD);
    }

    handleError(event) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Error', message: event.detail.message, variant: 'error'
        }));
    }
}
```

**`{name}.html` principles**
- Use SLDS classes (`slds-card`, `slds-grid`, ...)
- Prefer Lightning Base Components (`<lightning-card>`, `<lightning-input>`)
- `key` is mandatory in `for:each`
- Conditional rendering uses `lwc:if` (modern)
- Accessibility: form inputs with labels, buttons with text, images with alt

**`{name}.css` principles**
- Style isolation (Shadow DOM) — only use `:host` when intentional bleed-through
- Prefer SLDS design tokens (`var(--lwc-...)`)

**`{name}.js-meta.xml` principles**
- API version: project sourceApiVersion
- `isExposed`: true if exposure required
- targets: explicit (RecordPage / AppPage / HomePage / Community / FlowScreen / QuickAction)
- Use targetConfigs for propertyTypes (Flow inputs, etc.)

### Step 5: Auto-apply risk guards
- ❌ `eval`, `Function` constructor
- ❌ `innerHTML =` (use `lwc:dom="manual"` + sanitize when needed)
- ❌ Lingering `console.log` (remove after dev)
- ✅ wire error handling branch
- ✅ try-catch in async methods
- ✅ JSDoc on public API (`@api`)

### Step 6: Paired Jest tests (create or augment)
- CREATE mode: create `__tests__/{name}.test.js`.
- MODIFY mode: re-run existing tests → confirm no regressions → add cases for new behavior.

Test cases:
- Render smoke test
- Behavior on @api property change
- @wire mock (`registerLdsTestWireAdapter`)
- Event dispatch verification

### Step 7: Audit
**Invoke `sf-lwc-auditor` via the `Agent` tool** — pass the path of the just-created component.
Show the user the dependency / accessibility / antipattern report.

### Step 8: Report
- 4–5 created files (path)
- Exposure location / how to use
- Jest run command

## AskUserQuestion policy
Ask when required info is missing:
- Component name, exposure location, data source (required)
- Target object (for Record Page)

## Artifact locations
- `force-app/main/default/lwc/{name}/{name}.js`
- `force-app/main/default/lwc/{name}/{name}.html`
- `force-app/main/default/lwc/{name}/{name}.js-meta.xml`
- `force-app/main/default/lwc/{name}/{name}.css` (when needed)
- `force-app/main/default/lwc/{name}/__tests__/{name}.test.js`

## Antipattern rejection
- Reject targets on a non-exposed (`isExposed=false`) component
- If imperative Apex is used where LDS would suffice — recommend LDS
- Excessive props surface on a child-only component — recommend decomposition
