# SOQL Anti-Patterns

Reference: Read when authoring/reviewing Apex/dynamic SOQL.

## Selectivity (Indexed Filter)

Standard indexed fields: `Id`, `Name`, `OwnerId`, `CreatedDate`, `SystemModstamp`, `RecordTypeId`, master-detail/lookup, External ID, Unique fields.

On large standard objects (Account/Contact/Case/Lead/Opportunity/Task/Event etc., 200K+ rows), **a query with no selective indexed-field condition in the WHERE clause is a non-selective query**.

| Pattern | Verdict |
|---|---|
| `SELECT ... FROM Account` (no WHERE) | 🔴 timeout in large orgs |
| `WHERE Status__c = 'Active'` (non-indexed) | 🟡 selective depending on ratio |
| `WHERE Id IN :ids` | 🟢 selective |
| `WHERE Name LIKE '%foo%'` | 🔴 leading wildcard, index unused |
| `WHERE Name LIKE 'foo%'` | 🟢 trailing wildcard, index used |
| `WHERE CreatedDate >= LAST_N_DAYS:30` | 🟢 indexed |

## SOQL Injection

```apex
// 🔴 unsafe
String userInput = ApexPages.currentPage().getParameters().get('q');
Database.query('SELECT Id FROM Account WHERE Name = \'' + userInput + '\'');

// 🟢 escape
String safe = String.escapeSingleQuotes(userInput);
Database.query('SELECT Id FROM Account WHERE Name = \'' + safe + '\'');

// 🟢 better — bind variable
[SELECT Id FROM Account WHERE Name = :userInput];
```

Use dynamic SOQL only when truly necessary. Prefer static query + bind variable when possible.

## N+1 / Loop SOQL

```apex
// 🔴
for (Account a : accounts) {
    List<Contact> cs = [SELECT Id FROM Contact WHERE AccountId = :a.Id]; // 100 SOQL limit
}

// 🟢
Set<Id> ids = (new Map<Id, Account>(accounts)).keySet();
Map<Id, List<Contact>> byAcc = new Map<Id, List<Contact>>();
for (Contact c : [SELECT Id, AccountId FROM Contact WHERE AccountId IN :ids]) {
    if (!byAcc.containsKey(c.AccountId)) byAcc.put(c.AccountId, new List<Contact>());
    byAcc.get(c.AccountId).add(c);
}
```

## Aggregate / Subquery

- `[SELECT COUNT() FROM ...]` → returns Integer, no row-limit applied.
- subquery `[SELECT Id, (SELECT Id FROM Contacts) FROM Account]` → Contact rows count toward the 50K limit too.
- GROUP BY: returns `AggregateResult`, retrieve values via `get('expr0')`.

## LIMIT enforcement

Queries on large objects always require LIMIT or a selective WHERE. In trigger context, an IN clause based on `trigger.new.size` is OK (max 200).

## SOSL vs SOQL

- Text search → SOSL (`FIND :term IN ALL FIELDS RETURNING Account(Id, Name)`).
- Exact field matching → SOQL.

## Related topics

- governor-limits.md
- sharing-fls-crud.md (WITH USER_MODE)
