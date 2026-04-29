# Metadata / Deploy Rules

Reference: Read when authoring/reviewing deploy-validator, sf-sobject, sf-field.

## sObject sharingModel

| Value | Meaning |
|---|---|
| `Private` | OWD private. Accessed only via sharing rules / manual sharing. |
| `Read` | OWD Read. Everyone reads, only owner edits. |
| `ReadWrite` | OWD Read/Write. Everyone reads/edits. |
| `ControlledByParent` | Follows the master-detail parent. |

**Risk on change**: `ReadWrite → Private` reduces data exposure — affects existing users. Strong warning.

## Field change safety

| Change | Safety | Reason |
|---|---|---|
| label, description, help text | 🟢 safe | No data impact |
| length expansion (Text 80 → 255) | 🟢 safe | Existing data fits |
| picklist value addition | 🟢 safe | Existing records unaffected |
| picklist value deletion | 🟡 risky | Existing record values become inactive picklist |
| length shrink | 🔴 risky | Truncation or deploy failure |
| type change (Text → Number) | 🔴 risky | Data loss |
| required: false → true | 🔴 risky | Existing null records fail on update |
| add unique | 🔴 risky | Fails on existing duplicates |
| field deletion | 🔴 very risky | Permanent data loss, 15-day grace |

## Permission

- Direct profile modification is forbidden. Permission Sets only.
- Permission Set update is mandatory when adding fields (otherwise invisible).
- Granting `Modify All Data`, `View All Data` is subject to security review.

## Deploy strategy

| Command | Use |
|---|---|
| `sf project deploy validate` | Check-only, no data changes |
| `sf project deploy start` | Actual deploy |
| `sf project deploy quick --job-id <id>` | Run validated deploy (skips test re-run) |
| `sf project deploy report --job-id <id>` | Progress status |

## Production deploy gate

- **Always validate first.**
- Detect production org: `sf data query -q "SELECT IsSandbox FROM Organization LIMIT 1"`.
- IsSandbox=false → `--test-level RunLocalTests` or `RunSpecifiedTests` enforced.
- coverage <75% → BLOCKED.
- Strong confirmation if destructive changes are included.

## destructiveChanges.xml

- Specify components to delete inside `<Package>`.
- Field deletion causes data loss. Recoverable within 15 days (recycle bin).
- Object deletion is immediate and permanent (all related fields/records).

## API version management

- `sourceApiVersion` in `sfdx-project.json` is the default.
- `<apiVersion>` can be specified per metadata file.
- 60.0+ required for new features (USER_MODE, etc.).

## Related topics

- sharing-fls-crud.md
- soql-anti-patterns.md
