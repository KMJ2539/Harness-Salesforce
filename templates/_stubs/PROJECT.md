# PROJECT.md

This file is the **team-shared** layer. Commit it so everyone runs under the same rules.
Personal overrides go in `local.md` in the same directory (gitignored).

The design-first skills (`/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-feature`) Read this file
before Step 1 begins. Priority: `local.md` > `PROJECT.md` > project `CLAUDE.md`.

The format is free-form, but agents will use the sections below if present.

---

## Naming Convention

(Example — adjust to your project)
- Apex class: `{Domain}{Type}` (e.g. `AccountService`, `OrderTriggerHandler`)
- Test: `{Class}Test` (suffix `Test`, not `_Test`)
- LWC: `camelCase` (e.g. `accountSummaryCard`)
- Custom Object: `{Domain}__c` (e.g. `Order__c`)
- Custom Field: `{Purpose}__c` (e.g. `ApprovalStatus__c`)

## Sharing Default

(Example)
- All new classes: `with sharing` must be explicit.
- `without sharing` requires code review approval plus a comment at the top of the class explaining why.

## Forbidden Patterns

(Example)
- No direct profile edits — Permission Sets only.
- No hardcoded IDs/URLs.
- No `SeeAllData=true`.
- (Add project-specific rules)

## Permission Set Strategy

(Example)
- New objects/fields go on the `{Domain}_User` PermSet.
- Admin-only items go on a separate `{Domain}_Admin` PermSet.

## API Version Floor

(Example)
- Minimum API version for new classes: 60.0 (USER_MODE available).

## Test Coverage Target

(Example)
- Org 75% (gate), 90% recommended per class.

## Logging Convention

If this section is present, `sf-apex-code-reviewer` / `sf-deploy-validator` / `sf-apex-test-author`
enforce **log sObject persistence reachability + test assertions** at entry points
(batch / REST / callout / invocable / queueable / schedulable).
See `.claude/knowledge/logging-convention.md` for schema/detection rule details.

Leaving the entire section blank turns the rule OFF — the default for new orgs / projects without an established convention.

```yaml
logging:
  log_sobject: IF_Log__c            # the project's log object API name (e.g. IF_Log__c, Application_Log__c, txn_log__c)
  required_fields:                   # fields that must be populated when logging (existence check only)
    - ApexName__c
    - StatusCode__c
    - StartDatetime__c
  entry_points:                      # entry-point types to enforce (turn on only what you need)
    - batch
    - rest_resource
    - callout
    - invocable
    - queueable
    - schedulable
  enforcement:
    detection: behavioral            # behavioral | name | marker
    test_assertion: required         # required | optional
    callout_wrapper: IF_Callout      # (optional) when checking callout entry points, exclude code *inside* this wrapper
```

Intentional bypass: add a `// @no-log` comment to the class/method to skip the rule (a 1-line informational note will appear in the body).
