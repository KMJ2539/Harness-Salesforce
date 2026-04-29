# harness-sf end-to-end walkthrough

This walks through `/sf-apex` on a small SFDX project where an existing
`OrderHandler.cls` needs an FLS guard added. It exercises every gate
`harness-sf` ships:

1. **session-start-context** auto-loads `.harness-sf/PROJECT.md`.
2. **design-first** writes `.harness-sf/designs/{slug}.md`.
3. **5-persona review** runs in parallel and emits risk-graded findings.
4. **Resolution gate** requires every HIGH/MEDIUM risk to have a resolution
   line before approval can be issued.
5. **Design link gate** would block a *new* file write without an approval
   sentinel; this run is MODIFY mode so the **modify approval gate** runs
   instead.
6. **Profile deny** would block any attempt to edit a `.profile-meta.xml`.
7. **Deploy gate** blocks `sf project deploy start` until
   `sf-deploy-validator` succeeds with coverage ≥ 80% (project override).

The fixture under this directory is intentionally minimal — one Order custom
object, two fields, one handler with a known FLS gap. The pre-baked
`.harness-sf/designs/20260429-order-fls.md` already contains review +
resolution so you can step into Step 04 without doing the whole intent
battery yourself.

## Setup

```bash
cd examples/sfdx-demo
npx --prefix ../.. harness-sf init   # installs .claude/ from templates/
```

`init` writes `.claude/{agents,skills,knowledge,hooks}` and merges
`.claude/settings.json`. After it completes, restart Claude Code so it picks
up the new agents/skills/hooks.

## Step 01 — invoke /sf-apex

```
> /sf-apex
> add an FLS guard to OrderHandler.afterInsert before it writes Status__c
```

The skill loads `.harness-sf/PROJECT.md` (`coverage_target_percent: 80`,
`with sharing` default, no-profile-edits) and starts the intent battery.

## Step 02 — context map

`/sf-apex` calls `sf-context-explorer` with target `Order__c`. It returns a
report under `.harness-sf/reports/sf-context-explorer/order-c-{ts}.md`
listing:

- `OrderHandler.cls` (this file)
- `Order__c` object (Private sharing model)
- Fields: `Amount__c`, `Status__c`
- No existing Flows, no Validation Rules, no other triggers

The body is ≤80 lines, ending with `Details: <report path>`.

## Step 03 — design.md + 5-persona review

`/sf-apex` writes `.harness-sf/designs/{date}-order-fls.md` (the pre-baked one
in this fixture). It then dispatches all five reviewers in parallel:

- **CEO** — surfaces tradeoff: "Apex handler vs Before-Save Flow"
- **Eng** — `[M1]` confirms bulk-fail vs per-record-skip choice
- **Security** — `[H1]` flags the missing FLS guard (the actual bug being fixed)
- **QA** — `[M1]` asks for a runAs no-FLS test
- **Library** — emits `library-not-applicable: direct platform schema check`

Each reviewer body is ≤80 lines. None can emit `block` —
`stop-reviewer-validate.js` enforces this.

## Step 04 — resolution gate

You add the `## Review Resolution` block (already pre-baked in the demo) and
ask the skill to issue the design approval:

```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/20260429-order-fls.md
# stdout: approved DESIGN: .harness-sf/designs/20260429-order-fls.md (type=apex, name=OrderHandler, head=…, expires in 2h)
```

If `## Review Resolution` were empty or shallow (`H1: ok`),
`validate-design.js --check-resolution` would have rejected with
`unresolved HIGH risks: security:H1` or `shallow resolutions`.

## Step 05 — modify approval gate (MODIFY mode)

`OrderHandler.cls` already exists, so the skill is in MODIFY mode. It shows
you the diff plan and waits for explicit confirmation. Once you say yes, the
skill issues the modify-approval sentinel and writes:

```bash
node .claude/hooks/_lib/issue-modify-approval.js force-app/main/default/classes/OrderHandler.cls
# stdout: approved MODIFY: force-app/main/default/classes/OrderHandler.cls (head=…, expires in 30m)
```

Without that sentinel, `pre-modify-approval-gate.js` would have blocked the
Edit with:

```
[harness-sf] modify gate: 'force-app/main/default/classes/OrderHandler.cls' exists (MODIFY mode) but no approval sentinel found.
  Skill must call: node .claude/hooks/_lib/issue-modify-approval.js '...'
  AFTER showing diff plan and receiving explicit user approval.
```

After the edit lands, `OrderHandler.cls` looks like:

```apex
public with sharing class OrderHandler {
    public static void afterInsert(List<Order__c> newOrders) {
        if (!Schema.sObjectType.Order__c.fields.Status__c.isUpdateable()) {
            for (Order__c o : newOrders) {
                o.addError('You do not have permission to update Status__c.');
            }
            return;
        }
        for (Order__c o : newOrders) {
            if (o.Amount__c != null && o.Amount__c > 1000) {
                o.Status__c = 'High Value';
            }
        }
        update newOrders;
    }
}
```

## Step 06 — test author

`sf-apex-test-author` writes `OrderHandlerTest.cls` (CREATE mode → no
modify-approval needed) covering:

1. Single insert >$1,000 → tagged High Value.
2. Bulk insert with mixed amounts → only >$1,000 ones tagged.
3. `System.runAs` user with no FLS on `Status__c` → addError fires, insert
   rejected.

The author runs `sf apex run test` against the scratch org and iterates if
any case fails — the self-verify loop.

## Step 07 — pre-deploy validation

```
> /sf-deploy-validator
```

The validator runs static analysis (no SOQL injection, sharing declared,
FLS guards present), LWC Jest if applicable, then
`sf project deploy validate-only` against the target org with
`--test-level RunLocalTests`. On success it writes:

```json
// .harness-sf/last-validation.json
{
  "validation_result": "Succeeded",
  "validated_at": "2026-04-29T14:32:11Z",
  "head_sha": "abc1234...",
  "coverage_overall": 87.5
}
```

## Step 08 — deploy gate

```bash
sf project deploy start --target-org demo
```

`pre-deploy-gate.js` reads the validation file and confirms:

- `validation_result === 'Succeeded'` ✓
- `validated_at` within 30 min ✓
- `head_sha` matches current HEAD ✓
- `coverage_overall` (87.5) ≥ target 80 ✓

Deploy proceeds.

If you tried to deploy without running validation first, you would see:

```
[harness-sf] deploy gate: no .harness-sf/last-validation.json found. Run /sf-deploy-validator first.
```

## What you just exercised

| Layer | Files in this fixture | Hook involved |
|---|---|---|
| Project config | `.harness-sf/PROJECT.md` | `session-start-context.js` |
| Design + review | `.harness-sf/designs/20260429-order-fls.md` | `validate-design.js` (--check-resolution) |
| Sentinel issuance | `.harness-sf/.cache/design-approvals/*.json` | `issue-design-approval.js` |
| Modify gate | `force-app/main/default/classes/OrderHandler.cls` | `pre-modify-approval-gate.js` |
| Modify sentinel | `.harness-sf/.cache/modify-approvals/*.json` | `issue-modify-approval.js` |
| Deploy gate | `.harness-sf/last-validation.json` | `pre-deploy-gate.js` |

## Try it negative-path

To see each gate fire, run the inverse:

| Negative case | Expected denial |
|---|---|
| Skip Step 04 (no `## Review Resolution`), run `issue-design-approval.js` | `fails review/verdict gate: unresolved HIGH risks: security:H1` |
| Skip Step 05 (no modify sentinel), edit `OrderHandler.cls` | `modify gate: ... no approval sentinel found` |
| Edit `force-app/main/default/profiles/Admin.profile-meta.xml` | `Profile edits are forbidden — use a Permission Set instead` |
| Skip Step 07, run `sf project deploy start` | `deploy gate: no .harness-sf/last-validation.json found` |
| Set `coverage_overall: 70` in last-validation.json, deploy | `deploy gate: coverage 70% < target 80%` |

Each can be bypassed with `HARNESS_SF_SKIP_*=1` if you need to (`SKIP_CREATE_GATE`,
`SKIP_MODIFY_GATE`, `SKIP_DEPLOY_GATE`, `SKIP_LIBRARY_GATE`,
`SKIP_RESOLUTION_GATE`, `ALLOW_PROFILE_EDIT`). Use sparingly — the gates are
the value proposition.
