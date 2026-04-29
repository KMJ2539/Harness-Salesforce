# Sharing / FLS / CRUD

Reference: Read when authoring/reviewing Apex classes.

## Sharing Modifier

| Declaration | Behavior |
|---|---|
| `with sharing` | Calling user's sharing rules apply |
| `without sharing` | Access to all records (system mode) |
| `inherited sharing` | Inherits the caller class's mode |
| Unspecified | Same as `inherited sharing` (Spring '18+) — but a top-level entry defaulting to `without sharing` is risky |

**Principles**:
- Explicit declaration is mandatory on every class (linter rule).
- `@AuraEnabled`, REST resource, trigger handler entry: **`with sharing` enforced**.
- Batch class: decide based on data-processing intent. Explicit declaration + comment.
- `without sharing` requires justification in code review.

## CRUD (Object-level)

```apex
if (!Schema.sObjectType.Account.isAccessible()) { ... }
if (!Schema.sObjectType.Account.isCreateable()) { ... }
if (!Schema.sObjectType.Account.isUpdateable()) { ... }
if (!Schema.sObjectType.Account.isDeletable()) { ... }
```

Check immediately before DML. On violation, throw `AuraHandledException` or a custom exception.

## FLS (Field-level)

**Option A — `WITH USER_MODE` (Apex 60+, recommended)**
```apex
List<Account> accs = [SELECT Id, Name FROM Account WITH USER_MODE];
insert as user new Account(...);
update as user accs;
```
- Automatic FLS + sharing checks. Violating fields are excluded from results (query) or raise an exception (DML).

**Option B — `Security.stripInaccessible`**
```apex
SObjectAccessDecision d = Security.stripInaccessible(AccessType.READABLE, accs);
return d.getRecords();
```

**Option C — `WITH SECURITY_ENFORCED` (legacy)**
```apex
[SELECT Id, Name FROM Account WITH SECURITY_ENFORCED]
```
- On violation, throws `QueryException`. No partial access. USER_MODE is recommended for new code.

**Option D — manual describe** (when none of the above apply)
```apex
if (!Schema.sObjectType.Account.fields.Phone.isAccessible()) { ... }
```

## @AuraEnabled / Invocable / REST exposure

- Always `with sharing` + USER_MODE.
- No sensitive fields in returned data (must pass `stripInaccessible`).
- `@AuraEnabled(cacheable=true)` is read-only. No DML calls.

## Permission Set strategy

- Direct profile modification is forbidden. Use Permission Sets / Permission Set Groups only.
- Apex class access: grant via `<classAccess>` on a Permission Set.
- Custom Object/Field: `<objectPermissions>`, `<fieldPermissions>` on a Permission Set.

## Related topics

- soql-anti-patterns.md
- order-of-execution.md
