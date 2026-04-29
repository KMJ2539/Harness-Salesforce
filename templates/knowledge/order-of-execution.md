# Order of Execution (Salesforce Save Order)

Reference: Read when an agent reasons about trigger/Flow/Validation Rule conflicts.

## Save Order (insert/update on standard objects)

1. Original record loaded (or new sObject initialized)
2. New record values overwrite old values
3. **System Validation Rules** — required fields, max length, datatype
4. **Before-save Flows** (Record-Triggered Flow with "Fast Field Updates")
5. **Before triggers** — `before insert`, `before update`
6. **Custom Validation Rules**
7. **Duplicate Rules**
8. Record saved to DB (still uncommitted)
9. **After triggers** — `after insert`, `after update`
10. Assignment Rules
11. Auto-response Rules
12. **Workflow Rules** — field updates re-trigger before/after update once
13. **After-save Flows** (Record-Triggered Flow "Actions and Related Records")
14. Escalation Rules
15. Entitlement Rules
16. Roll-Up Summary recalc on parent (parent before/after update may fire)
17. Sharing rule recalc
18. **Commit DML** — async actions queued (Queueable, future, Platform Events)
19. **Post-commit logic** — email send, async Apex enqueue

## Conflict patterns

- **Before-save Flow + Before Trigger**: Flow runs first. If both modify the same field, the trigger wins.
- **WFR field update re-invokes the trigger**: recursion risk. Add `Trigger.new`/`Trigger.old` comparison guard or static flag in the trigger.
- **Validation Rule evaluated after the trigger** (Custom VR): if values set in the trigger fail VR, the entire transaction rolls back.
- **Roll-Up Summary**: child DML → parent update fires → parent trigger fires (unexpected chain).
- **Process Builder is deprecated** but if it remains, runs at the after-save Flow position.

## Async/post-commit

- `System.enqueueJob()`, `@future`, Platform Event publish run **after commit**. No callback within the same transaction.
- Mixed DML (setup ↔ non-setup sObject in the same transaction) → `@future` or Queueable required.

## Related topics

- governor-limits.md (trigger bulk handling)
- async-mixed-dml.md (post-commit handling)
