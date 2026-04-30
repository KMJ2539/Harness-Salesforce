---
name: sf-aura
description: Create or modify Aura components (ensure semantics) — but strongly recommend LWC if feasible. Create if no same-named component, modify after diff approval if present. Only proceed when Aura is truly needed (legacy integration, areas LWC cannot cover). Use for requests like "create an Aura component", "modify existing Aura".
---

# /sf-aura

Aura component **ensure mode** — create if absent, modify if present. **The recommended path is LWC.** Aura is legacy and Salesforce no longer adds new features to it.

## Step -1: Invocation mode detection

If the caller (`/sf-feature`) passes a feature design.md path + artifact ID, this is a **delegated mode candidate**. Verify with the sentinel:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated mode confirmed. Load the matching aura artifact from design.md `## Artifacts`. **Idempotency check (P3)**: read canonical state.json; if this artifact id is `done` exit no-op (`idempotent: <id> already done`); if `in_progress` AskUserQuestion `[Continue / Restart / Skip]`. Otherwise skip the Step 0 LWC feasibility check and Step 1 intent questions (covered at feature level), start from Step 2. On completion/failure the caller updates status via dispatch-state-cli (canonical `.harness-sf/state/<slug>__r<rev>.json`).
exit 1 → standalone mode (start from Step -0.5 below).

## Step -0.5: Feature context gate (required when entering standalone)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

If `has_active_feature: true` and a pending artifact of type=`aura` exists, propose a redirect via AskUserQuestion (`[r]` `/sf-feature` / `[s]` reason then stub / `[a]` abort). Stub: `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}-standalone.md` (`type: aura, standalone_override: true`). Bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

If no match, proceed to Step 0.

## Step 0: LWC feasibility check (most important)

First ask the user:
> "Reviewed whether this requirement is implementable in LWC. Is there a specific reason Aura is required?"

**Cases LWC cannot cover (Aura needed)**
- ❌ Child invoked directly inside an existing Aura app (LWC works too but requires wrapping)
- ❌ Some marker interfaces like `force:appHostable`, `force:lightningQuickAction`
- ❌ `lightning:availableForFlowActions` invocable Aura action
- ❌ Direct dependence on external Aura libraries (`ltng:require`)
- ❌ Salesforce Console API (some features Aura-only)

**Cases LWC can cover (most)** → recommend redirecting to `/sf-lwc`

If the user still wants Aura, proceed. Record the reason in the report.

## Step 1: Intent clarification
- Component name (PascalCase, e.g. `AccountSummary`)
- Exposure location
- Data source
- Reason Aura was chosen over LWC (for the record)

## Step 1.92: Issue design approval sentinel (required before entering CREATE mode)

New files under `force-app/main/default/aura/**` are blocked by `pre-create-design-link-gate.js` without a design-approval sentinel. Aura has no formal 5-persona review flow, so do one of:

- **Recommended**: enter `/sf-feature` → composite design.md + 5-persona review → sentinel auto-issued. Then this skill is invoked in delegated mode (Step -1).
- **Standalone direct**: save the Step 1 intent (especially the reason for choosing Aura over LWC) at `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}.md` with frontmatter `type: aura, name: {ComponentName}`, then:
  ```bash
  node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ComponentName}.md
  ```
  (TTL 2h + git HEAD match). If only running MODIFY mode, this step can be skipped — `pre-modify-approval-gate.js` requires a separate sentinel.

## Step 2: Context analysis
If a target object exists, **invoke `sf-context-explorer` via the `Agent` tool**.

## Step 2.5: Mode decision (CREATE vs MODIFY)

Check whether the component directory exists with `Glob force-app/**/aura/{Name}/{Name}.cmp`:

**Absent → CREATE mode**: continue from Step 3 (keep the LWC recommendation note).

**Present → MODIFY mode**:
1. `Read` every existing file: `.cmp`, `Controller.js`, `Helper.js`, `.css`, `.design`, `.cmp-meta.xml`, etc.
2. Preserve:
   - `implements="..."` interface list (avoid breaking App Builder / Quick Action exposure)
   - `aura:attribute` `name`/`type` (externally set attributes — explicit approval to change)
   - `access="global|public"` modifiers
   - `controller="..."` reference (Apex controller — keep separated)
3. **Risk-rank classification of changes** (present as a table to the user):
   - **safe** — label/copy changes, SLDS class swap, internal helper refactor, new private methods, adding `.css`
   - **medium** — adding a new `aura:attribute` (no impact on existing parents), new `aura:handler`, helper signature additions, `.design` attribute additions
   - **high (explicit approval required)** — change/remove `implements=`, downgrade `access` (e.g. `global`→`public`), change/remove existing `aura:attribute` `name`/`type`, swap `controller=`, change existing controller action signature (breaks external callers)
4. **User approval gate**: show files-to-change + diff preview + the risk-rank table → confirm before write. Any `high` item requires per-item explicit approval.
5. **Issue approval sentinel (required)**: immediately after user approval, and before Edit/Write, issue with all files-to-modify as arguments:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../aura/{Name}/{Name}.cmp force-app/.../aura/{Name}/{Name}Controller.js ...
   ```
   The `pre-modify-approval-gate.js` hook blocks without a sentinel (TTL 30 min + git HEAD match). Issuing a sentinel without user approval is a policy violation.
6. **Re-run existing tests (before adding new ones)**: run the linked Apex controller's (`controller="..."`) test class first via `sf apex run test -n {ControllerName}Test` to confirm baseline green. If red, isolate the cause before changes. Then change → then add new tests. Violating the order mixes regressions with new defects, blowing up debugging cost.
7. Add a one-line "does this modification further delay LWC migration?" assessment to the report.

## Step 3: File generation

**`{Name}.cmp` skeleton**
```xml
<aura:component
    implements="force:appHostable,flexipage:availableForRecordHome,force:hasRecordId"
    access="global"
    controller="MyController">

    <aura:attribute name="recordId" type="Id" />
    <aura:attribute name="record" type="Object" />

    <aura:handler name="init" value="{!this}" action="{!c.doInit}"/>

    <lightning:card title="Account">
        <p class="slds-p-horizontal_small">
            {!v.record.Name}
        </p>
    </lightning:card>
</aura:component>
```

**`{Name}Controller.js`**
- `init` handler
- Event handlers
- Helper delegation only (logic body in helper)

**`{Name}Helper.js`**
- Business logic body
- Apex calls (`$A.enqueueAction`)
- Promise pattern recommended

**`{Name}.css`**
- SLDS first

**`{Name}.design`** (when needed)
- App Builder exposed properties

**`{Name}.svg`** (when needed)
- Lightning App Builder icon

**`{Name}.cmp-meta.xml`**
- API version
- description

### Step 4: Apex Controller (when needed)
Invoke `/sf-apex` — create/modify the `@AuraEnabled` controller.

### Step 5: Enforce best patterns
- ✅ Explicit `access="global"` or `public`
- ✅ `cacheable=true` on `@AuraEnabled` methods when possible
- ✅ Promise pattern: wrap with `$A.getCallback` in helper
- ✅ Error handling: `response.getError()` branch + Toast event
- ❌ Direct DOM manipulation (avoid except `$A.util.toggleClass`)
- ❌ Heavy synchronous work inside `aura:iteration`

### Step 6: Report
- List of created files
- **Migration recommendation**: "This Aura component should be migrated to LWC in the future. The accompanying Apex controller can be reused as-is"
- Suggest preparatory work for future migration (e.g. keep the Apex controller separated)

## AskUserQuestion policy
- Component name, exposure location (required)
- Reason for choosing Aura over LWC (required — for the record)

## Artifact locations
- `force-app/main/default/aura/{Name}/{Name}.cmp` and other files

## Tone
Do not hard-sell LWC every time — guide the user clearly once and respect the user's decision. Leave only a migration note in the report.
