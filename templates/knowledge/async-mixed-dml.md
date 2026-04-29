# Async Apex / Mixed DML

Reference: Read when deciding async processing / mixed DML.

## Async option comparison

| Option | Scenario | Constraints |
|---|---|---|
| `@future` | Simple fire-and-forget | 50/tx, primitive params only, no future→future, weak monitoring |
| Queueable | Complex object params, chainable | 50 enqueue/tx, chain depth limit (unlimited in prod) |
| Batch | 50K+ record processing | start/execute/finish, batch size 200 default |
| Schedulable | Cron-time trigger | Schedulable + Queueable combo pattern |
| Platform Event | pub/sub, cross-tx | replay, capture in trigger after publish |

## Selection guide

- Async needed inside a trigger → **Queueable** (free-form params, chainable, good monitoring)
- Callout + trigger context → `@future(callout=true)` or Queueable + `Database.AllowsCallouts`
- Scheduled processing of 100k+ records → Batch + Schedulable
- External system notification → Platform Event (auto-retry)

## Mixed DML violation

Setup + non-setup sObject DML in the same transaction is forbidden.

**Setup objects**: User, UserRole, Group, GroupMember, PermissionSet, Profile, etc.
**Non-setup**: Account, Contact, custom objects, etc.

**Resolution**: Split setup DML into `@future` or Queueable. Or vice versa.

```apex
// Violation
insert new Account(Name='X');
insert new Group(Name='Y');

// Resolution
insert new Account(Name='X');
System.enqueueJob(new SetupDmlQueueable(...));
```

## Test context exception

- Test methods allow setup+non-setup mixed DML inside a `System.runAs(user)` block.

## Recursion guard (when invoking Queueable from a trigger)

```apex
public class TriggerHandler {
    private static Boolean asyncDispatched = false;
    public static void afterUpdate() {
        if (asyncDispatched) return;
        asyncDispatched = true;
        System.enqueueJob(new MyQueueable());
    }
}
```

## Related topics

- governor-limits.md
- order-of-execution.md
