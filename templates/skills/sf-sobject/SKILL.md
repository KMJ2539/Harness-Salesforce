---
name: sf-sobject
description: Create or modify Custom SObjects with ensure semantics. Create if no same API name exists; if it does, modify sharing/label/list view/tab metadata after diff approval. Use for requests like "create an object", "change Order__c sharing model", "add a list view", "define a Custom Object".
---

# /sf-sobject

Treat Salesforce Custom Objects as metadata in **ensure mode** — create if the same API name directory does not exist, modify if it does. Source-controlled, not UI-clicks.

```
Step 0: Invocation mode detection → [standalone only] Step 1 → 1.5 → 1.7 → 1.9 → Step 2 onwards
```

## Step 0: Invocation mode detection

If the caller (typically `/sf-feature`) passes a feature design.md path + artifact ID, this is a **delegated mode candidate**. Verify with the sentinel:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated mode confirmed; exit 1 → standalone.

**Delegated mode behavior**:
- Load the matching sobject artifact section from design.md `## Artifacts` (API name, label, sharing model, name field, etc.).
- Skip Steps 1–1.9.
- Start from Step 2; intent comes from design.md.
- On completion/failure, the caller (/sf-feature) updates status via dispatch-state-cli — this sub-skill only appends one line to design.md `## Dispatch Log`.

For standalone mode, start from Step 0.3 below.

## Step 0.3: Feature context gate (required when entering standalone)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

If `has_active_feature: true` and a pending artifact of type=`sobject` exists, propose a redirect via AskUserQuestion: `[r]` `/sf-feature` / `[s]` reason then stub (`type: sobject, standalone_override: true`) / `[a]` abort. Pass through if no match. Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

## Step 0.5: Project convention check

Project conventions are injected by the SessionStart hook at session start. No additional Read needed. If injection is not visible (hook-less environment), fall back to `Read .harness-sf/PROJECT.md` and `Read .harness-sf/local.md`. Use convention defaults as `[recommend]` for sharing model / API name / PermSet questions.

## Step 1: Deep Intent Elicitation (use AskUserQuestion aggressively)

Beyond the basic metadata (label, API name, sharing, etc.), also collect:

**Why (domain)**
- One-sentence real-world/business concept this object represents
- Why fields/record types on existing objects (Account/Contact/Opportunity, etc.) cannot handle it
- Expected record count in 6 months (1k / 100k / 1M+)

**What (scope)**
- What data it carries (3–5 representative fields)
- Relationships with which objects (Lookup / Master-Detail)
- Non-goals: what this object will not store

**How (operations)**
- Who creates records (user form / integration API / Apex auto-creation)
- Who reads (all users / specific PS / external API)
- Lifecycle: edited after creation? soft delete vs hard delete

**Edge cases**
- Possibility of becoming a Master-Detail child (forced sharing change)
- External system sync: unique/external ID strategy
- Bulk import/export scenarios
- Roll-up summary dependencies on the parent side

**Test strategy**
- Deploy validation (`sf project deploy validate-only`)
- Plan to verify impact on sharing/OWD changes
- User walkthrough after Permission Set assignment

**Basic metadata (as before — label, plural, API name, name field, sharing model, etc.)**

**Required information**
- Label (Korean OK): "Order"
- Plural label: "Orders"
- API name: `Order__c` (auto-suggest, then confirm)
- Description: one line
- Name field type:
  - **Text**: user input (e.g. "Order #: ORD-0001")
  - **Auto Number**: auto-numbered (e.g. `ORD-{0000}`) — generally recommended
- Sharing Model — present all candidates with `[default]` / `[recommend]` tags, then let the user pick:
  - `Private` — **[recommend]** invisible without an explicit share. Secure default.
  - `Read` (Public Read Only) — org-wide read, write to owner/share.
  - `ReadWrite` (Public Read/Write) — **[default]** automatically applied by Setup UI when creating a Custom Object. Everyone can edit — risky. Not recommended without explicit intent.
  - `ReadWriteTransfer` (Public Read/Write/Transfer) — Lead/Case only. Not applicable to Custom Objects.
  - `FullAccess` — Campaign only.
  - `ControlledByParent` — forced for Master-Detail children. Not user-selectable; determined by the parent-child relationship.

  Display rule: show all candidates in the order above with `[default]`/`[recommend]` tags and a one-line description. If the user does not choose explicitly, apply **[recommend] = `Private`** (do not follow the SF UI default `ReadWrite` — security first). Make the divergence from the SF UI explicit to the user.
- Allow Activities (Tasks/Events possible?)
- Allow Reports (reportable?)
- Allow Bulk API / Streaming API / Search?
- Deployment Status: Deployed / In Development

**Optional information**
- Tab creation + tab icon
- Help Settings (help URL)
- Track Field History
- Activate Feed Tracking

## Step 1.5: Write design.md

Save at `.harness-sf/designs/{YYYY-MM-DD}-{ApiName}.md`. Frontmatter `type: sobject`, body has Why/What/How/Edge Cases/Test Strategy/basic metadata/Reviews sections.

## Step 1.6: design.md confirmation queries (recommend + business reasoning)

Right after the draft, counter-question via AskUserQuestion. **Recommend is business-first** — judged from data-exposure incidents / rollback cost / user trust.

Question format: `[Item] / [Candidates + default/recommend] / [Recommend reasoning — business-first] / [Technical reasoning]`.

**Confirmation categories**:

1. **Sharing model**: Private / Read / ReadWrite (UI default) / ReadWriteTransfer / FullAccess / ControlledByParent
   - recommend: typically **`Private`**.
   - Reason: "Data-exposure incidents have customer-trust / compliance cost overwhelmingly larger than operational convenience ('visible to all'). Note divergence from the SF UI default of `ReadWrite`."

2. **Name field type**: Text / AutoNumber
   - recommend: for human-spoken identifiers ("Order #", "Invoice #"), **AutoNumber + meaningful prefix**. For free-form user input, Text.
   - Reason: "Consistent format reduces operational incidents when humans memorize/search IDs. Free-form Text invites typos/duplicates and high tracking cost."

3. **Soft delete vs hard delete**: hard delete / soft delete (Status=Archived) / archive
   - recommend: for business data (orders/contracts/transactions), **soft delete**. For temporary/session data, hard.
   - Reason: "Recovery requests for deleted business data almost always come — audit/dispute/user mistakes. Retention cost < irrecoverable cost."

4. **Field History Tracking**: all on / key fields only / off
   - recommend: when there are money/contract/state-transition fields, **key fields only**.
   - Reason: "If 'who changed it when' cannot be answered during disputes/audits, operational cost explodes. Tracking everything inflates storage cost — key fields only strikes the balance."

5. **Activities / Reports / Search enable**: on / off
   - recommend: **"all on"** (matches default).
   - Reason: "Turning these on later costs more in user-discovery cost than turning on now. Off only if the reason is clear."

6. **Tab visibility scope**: all users / Permission Set holders only / hidden
   - recommend: **"PS holders only (TabVisibilities=Available)"**.
   - Reason: "Showing the tab to unauthorized users is just confusing — clicking shows 'No access'. Tying PS to visibility keeps the UX consistent."

7. **External ID field for system sync**: create new / not prepared
   - recommend: if external system integration is plausible, **"new External ID field (Unique=true)"**.
   - Reason: "Without an External ID, future integrations face huge data-matching cost. The pre-created field cost is near zero."

**Application rules**: short confirmation if design.md already answers, full question if not. Record in `## Decisions` if the user picks differently. Bundle 1–3 questions.

After reflecting results, proceed to Step 1.7.

## Step 1.7: Persona Reviews (parallel, max 3 loops)

Use the `Agent` tool to invoke 5 reviewers in parallel from a single message:
- `sf-design-ceo-reviewer` — review existing object reuse / Big Object / Platform Event alternatives
- `sf-design-eng-reviewer` — sharing model fit, relationship model, name field, indexing, scalability
- `sf-design-security-reviewer` — OWD fit, Master-Detail sharing inheritance, PS strategy
- `sf-design-qa-reviewer` — deploy validation, sharing change impact, PS-grant walkthrough
- `sf-design-library-reviewer` — AppExchange/Unlocked Package duplication (often returns "not applicable")

## Step 1.9: Review consolidation + per-risk user approval gate

No bulk [P]roceed. Force [1] proceed / [2] revise per `[H#]`/`[M#]` risk + a 1-line reason (8+ chars) is mandatory. Any HIGH at [2] → re-invoke that persona only (revision N+1, update `revision_block_personas`). All HIGH at [1] → reasons auto-fill design.md `## Review Resolution` → proceed to Step 1.92. MEDIUM same; LOW not asked. Iteration cap: 5 revisions or HIGH from same persona twice in a row → require explicit override. Show progress counter `[3/N]`.

Detailed gate behavior: refer to `/sf-feature` Step 5.

## Step 1.92: Issue design approval sentinel (required)

Right after approval, run via Bash:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ObjectApiName}.md
```
This sentinel must be present for Writes of new metadata files under `force-app/main/default/objects/{ApiName}/...` to pass (TTL 2h + git HEAD match). Otherwise `pre-create-design-link-gate.js` blocks.

## Step 1.93: Score recording (advisory)

Right after the approval sentinel: `node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {ObjectApiName}`. Reporting only. Recommended to call `score-cli.js record {slug} deploy 10` after `sf-deploy-validator` passes.

## Step 1.95: Library adoption (when applicable)

Library adoption is rare at the sObject level, but if design.md `## Decisions` specifies one (e.g. dependence on a base object in an internal unlocked package), invoke `/sf-library-install` in delegated mode. Skip otherwise.

## Step 2: Mode decision (CREATE vs MODIFY)

- Check whether the object directory exists via `Glob force-app/**/objects/{ApiName}/{ApiName}.object-meta.xml`.
- Check name collision with standard objects (Account, Contact, etc.) — error immediately on collision.

**Absent → CREATE mode**: continue from Step 3.

**Present → MODIFY mode**:
1. `Read` the existing `{ApiName}.object-meta.xml`.
2. The following changes require **strong warning + explicit approval** (direct impact on data/sharing in deployed orgs):
   - `sharingModel` change (especially Public→Private, or becoming a Master-Detail child)
   - `nameField.type` change (Text ↔ AutoNumber — affects existing records)
   - Turning off `enableActivities`, `enableHistory`, `enableFeeds` (turning on is safe; turning off can cause data loss)
   - Reverting `deploymentStatus` from Deployed to InDevelopment
3. Adding listView/tab/help is safe ancillary metadata — proceed after diff preview.
4. **User approval gate**: show changes + diff → confirm before write. No silent overwrites.
5. **Issue approval sentinel (required)**: immediately after user approval, before Edit/Write, issue with all metadata files-to-modify as args:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../objects/{ApiName}/{ApiName}.object-meta.xml ...
   ```
   The `pre-modify-approval-gate.js` hook blocks without a sentinel (TTL 30 min + git HEAD match). Issuing a sentinel without user approval is a policy violation.
6. Field add/modify is not handled by this skill → guide to `/sf-field`.

## Step 3: Generate metadata

**`force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Order</label>
    <pluralLabel>Orders</pluralLabel>
    <nameField>
        <label>Order Number</label>
        <type>AutoNumber</type>
        <displayFormat>ORD-{0000}</displayFormat>
        <startingNumber>1</startingNumber>
    </nameField>
    <sharingModel>Private</sharingModel>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>Order management</description>
    <enableActivities>true</enableActivities>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableBulkApi>true</enableBulkApi>
    <enableStreamingApi>true</enableStreamingApi>
    <enableHistory>false</enableHistory>
    <enableFeeds>false</enableFeeds>
</CustomObject>
```

## Step 4: Generate default List View

**`force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListView xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>All</fullName>
    <filterScope>Everything</filterScope>
    <label>All</label>
</ListView>
```

## Step 5: Tab generation (on request)

**`force-app/main/default/tabs/{ApiName}.tab-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
    <customObject>true</customObject>
    <motif>Custom20: Cash</motif>
    <label>Order</label>
</CustomTab>
```

Present icon motif options to the user (built-in motif list or Custom Image).

## Step 6: Permission setup guidance

The skill creates only the object — separate permission grants — **recommend Permission Set**:
- Create a new PS or add to an existing PS
- Object Access (Read/Create/Edit/Delete/View All/Modify All)
- Guide as separate skill or manual work

⚠️ **Granting permissions directly in Profiles is not recommended** — Permission Set is the model

## Step 7: Impact notes
- New object, so no impact on existing components
- Recommend `/sf-field` for future field add/modify
- Triggers/Flows via `/sf-apex` or Flow Builder

## Step 8: Report
- List of created files (path)
- API name, sharing model, name field type
- Recommended next steps:
  1. Add fields (`/sf-field`)
  2. Permission Set grant
  3. Page Layout setup
  4. (If needed) trigger/Flow

## AskUserQuestion policy
The following must be confirmed:
- Label, plural label, API name
- Name field type (text vs auto-number)
- Sharing model — present 6 candidates with `[default]`/`[recommend]` tags and require explicit selection (default to `Private` if no response, with the divergence from the SF UI default `ReadWrite` made explicit)
- Whether to create a tab

The following apply defaults and inform the user:
- enableActivities=true, enableReports=true, enableSearch=true, enableBulkApi=true
- Tell the user to ask if they want changes

## Artifact locations
- `force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`
- `force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`
- `force-app/main/default/tabs/{ApiName}.tab-meta.xml` (optional)

## Antipattern rejection
- Reject inserting a namespace prefix directly in the API name (sfdx-project handles it)
- Reject Public Read/Write as default (only when user is explicit)
- Reject auto-creating Master-Detail — handled separately in `/sf-field`
