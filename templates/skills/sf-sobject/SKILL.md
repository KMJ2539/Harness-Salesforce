---
name: sf-sobject
description: Create or modify Custom SObjects with ensure semantics. Create if no same API name exists; if it does, modify sharing/label/list view/tab metadata after diff approval. Use for requests like "create an object", "change Order__c sharing model", "add a list view", "define a Custom Object".
---

# /sf-sobject

Custom SObject metadata in **ensure mode** — create if absent, modify with diff approval if present. Source-controlled, not UI-clicks.

```
Step 0 → [standalone] 0.3 → 0.5 → 1 → 1.5 → 1.6 → 1.7 → 1.9 → 1.92 → Step 2+
```

## Step 0: Invocation mode detection

If caller (typically `/sf-feature`) passes a feature design.md path + artifact ID → **delegated mode candidate**. Verify:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated; exit 1 → standalone.

**Delegated**: load the sobject artifact from design.md `## Artifacts` (API name, label, sharing, name field, …). **Idempotency check (P3)**: read canonical state.json; `done` → exit no-op; `in_progress` → AskUserQuestion `[Continue / Restart / Skip]`. Then skip Steps 1–1.9, start at Step 2. On done/fail append one line to `## Dispatch Log`; the caller updates state.json.

Standalone → continue.

## Step 0.3: Feature context gate (standalone only)

```bash
node .claude/hooks/_lib/check-feature-context.js
```
If `has_active_feature: true` and a pending `type=sobject` artifact exists, AskUserQuestion redirect: `[r]` `/sf-feature` / `[s]` reason+stub (`type:sobject, standalone_override:true`) / `[a]` abort. Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

## Step 0.5: Project convention check

Conventions injected by SessionStart hook. If injection missing (hook-less env), `Read .harness-sf/PROJECT.md` + `local.md`. Use as `[recommend]` defaults.

## Step 1: Deep Intent Elicitation (AskUserQuestion, bundle 1–3 per ask)

- **Why**: domain concept this object represents; why existing objects (Account/Contact/Opportunity) can't fit; 6-month record volume (1k / 100k / 1M+).
- **What**: 3–5 representative fields; relationships (Lookup / Master-Detail); non-goals.
- **How**: who creates (form / integration / Apex auto); who reads; lifecycle; soft vs hard delete.
- **Edge**: MD-child demotion risk; external ID strategy; bulk import/export; parent roll-up dependencies.
- **Test**: `sf project deploy validate-only`; sharing/OWD impact verification; PS-grant walkthrough.

**Required metadata**: label, plural, API name (`Foo__c`, auto-suggest then confirm), description, name field type (Text vs **AutoNumber recommended**), enableActivities/Reports/BulkApi/StreamingApi/Search, deploymentStatus.

**Sharing model** — present all 6 with `[default]`/`[recommend]`:

| Value | Note |
|---|---|
| `Private` | **[recommend]** invisible without explicit share — secure default |
| `Read` | org-wide read, owner/share write |
| `ReadWrite` | **[default in SF UI]** — risky, requires explicit intent |
| `ReadWriteTransfer` | Lead/Case only — N/A for custom |
| `FullAccess` | Campaign only |
| `ControlledByParent` | forced for MD children — not user-selectable |

If user does not pick → apply **`Private`** (security first; make divergence from SF UI default explicit).

**Optional**: tab + icon, help URL, Track Field History, Feed Tracking.

## Step 1.5: Write design.md

Save at `.harness-sf/designs/{YYYY-MM-DD}-{ApiName}.md`. Frontmatter `type: sobject`. Body: Why / What / How / Edge / Test / metadata / Reviews.

## Step 1.6: design.md confirmation queries

After draft, AskUserQuestion counter-questions. **Recommend is business-first** (data-exposure cost / rollback cost / user trust). Format: `[Item] / [Candidates + default/recommend] / [Business reason] / [Technical reason]`. Recommend in **bold**:

1. **Sharing model** → **`Private`**. Reason: incident cost (customer trust / compliance) >> "visible to all" convenience. Diverges from SF UI default `ReadWrite`.
2. **Name field type** → **AutoNumber + meaningful prefix** for human-spoken IDs ("Order #", "Invoice #"); Text for free-form. Reason: consistent format reduces memorize/search incidents; free-form invites typos/dupes.
3. **Soft vs hard delete** → **soft** (Status=Archived) for business data (orders/contracts/transactions); hard for ephemeral. Reason: recovery requests (audit/dispute/mistake) almost always come; retention cost < irrecoverable cost.
4. **Field History Tracking** → **key fields only** when money/contract/state-transition fields exist. Reason: dispute/audit answerability vs storage cost — key fields strikes the balance.
5. **Activities / Reports / Search** → **all on** (matches default). Reason: user-discovery cost of enabling later > enabling now.
6. **Tab visibility scope** → **PS holders only** (`TabVisibilities=Available`). Reason: showing tab to unauthorized users → confusing "No access" clicks.
7. **External ID for system sync** → **new field with Unique=true** if integration plausible. Reason: future data-matching cost without one is huge; pre-creation cost ~zero.

**Rules**: short confirm if design.md already answers; full question otherwise. Divergent picks → record in `## Decisions`. Bundle 1–3 per ask.

## Step 1.7: Persona Reviews (parallel, max 3 loops)

Single Agent message, 5 reviewers in parallel: `sf-design-ceo-reviewer`, `sf-design-eng-reviewer`, `sf-design-security-reviewer`, `sf-design-qa-reviewer`, `sf-design-library-reviewer`.

## Step 1.9: Per-risk approval gate

No bulk [P]roceed. Per `[H#]`/`[M#]`: [1] proceed / [2] revise + 1-line reason (8+ chars) mandatory. HIGH at [2] → re-invoke that persona only (revision N+1, update `revision_block_personas`). All HIGH at [1] → reasons auto-fill `## Review Resolution` → Step 1.92. MEDIUM same; LOW skipped. Cap: 5 revisions or HIGH from same persona twice in a row → explicit override required. Show `[3/N]`.

Detail: `/sf-feature` Step 5.

## Step 1.92: Issue design approval sentinel (required)

```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ApiName}.md
```
Required for `force-app/.../objects/{ApiName}/...` Writes (TTL 2h + git HEAD match). Otherwise `pre-create-design-link-gate.js` blocks.

## Step 1.93: Score recording (advisory)

`node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {ApiName}`. After `sf-deploy-validator` passes: `score-cli.js record {slug} deploy 10`.

## Step 1.95: Library adoption

Rare at sObject level. If `## Decisions` specifies one (e.g. internal unlocked-package base object), invoke `/sf-library-install` delegated. Skip otherwise.

## Step 2: Mode decision (CREATE vs MODIFY)

`Glob force-app/**/objects/{ApiName}/{ApiName}.object-meta.xml`. Standard-object name collision (Account, Contact, …) → error.

**Absent → CREATE**: Step 3.

**Present → MODIFY**:
1. `Read` existing meta-xml.
2. **Strong warning + explicit approval** for data/sharing-impacting changes:
   - `sharingModel` change (esp. Public→Private, becoming MD child)
   - `nameField.type` change (Text↔AutoNumber affects existing records)
   - Disabling `enableActivities`/`enableHistory`/`enableFeeds` (turning on safe; off can lose data)
   - `deploymentStatus` Deployed→InDevelopment
3. listView/tab/help additions are safe ancillary metadata — diff preview, then proceed.
4. **Approval gate**: show diff → confirm → write. No silent overwrites.
5. **Sentinel (required)**, after approval, before Edit/Write:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../objects/{ApiName}/{ApiName}.object-meta.xml ...
   ```
   `pre-modify-approval-gate.js` blocks without sentinel (TTL 30min + git HEAD). Issuing without user approval = policy violation.
6. Field add/modify → `/sf-field`.

## Step 3–5: Generate metadata

XML templates (object-meta / listView / tab) → **`Read references/templates.md`**. Files:
- `force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`
- `force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`
- `force-app/main/default/tabs/{ApiName}.tab-meta.xml` (on tab request; ask icon motif)

## Step 6–8: Permission, impact, report

- **Permission**: Permission Set only (Object Access R/C/E/D/View All/Modify All). ⚠️ Profile-direct grants not recommended. Guide as separate work.
- **Impact**: new object → no existing-component impact. Next: `/sf-field` for fields, `/sf-apex` or Flow Builder for triggers.
- **Report**: created file paths, API name, sharing model, name field type. Recommended next: fields → PS grant → page layout → (if needed) trigger/Flow.

## AskUserQuestion policy
**Must confirm**: label/plural/API name, name field type, sharing model (6 candidates, default `Private`), tab creation.
**Default + inform**: `enableActivities/Reports/Search/BulkApi=true`. User may override.

## Antipatterns
- Namespace prefix in API name (sfdx-project handles it).
- Public Read/Write as default (only when user is explicit).
- Auto-creating Master-Detail (handled in `/sf-field`).
