# SOQL Anti-Patterns

레퍼런스: Apex/dynamic SOQL 작성/리뷰 시 Read.

## Selectivity (Indexed Filter)

표준 indexed 필드: `Id`, `Name`, `OwnerId`, `CreatedDate`, `SystemModstamp`, `RecordTypeId`, master-detail/lookup, External ID, Unique 필드.

큰 표준 객체 (Account/Contact/Case/Lead/Opportunity/Task/Event 등 200K+ rows)에서 **WHERE 절에 indexed 필드 selective 조건이 없으면 non-selective query**.

| 패턴 | 평가 |
|---|---|
| `SELECT ... FROM Account` (no WHERE) | 🔴 large org에서 timeout |
| `WHERE Status__c = 'Active'` (non-indexed) | 🟡 비율 따라 selective |
| `WHERE Id IN :ids` | 🟢 selective |
| `WHERE Name LIKE '%foo%'` | 🔴 leading wildcard, index 무효 |
| `WHERE Name LIKE 'foo%'` | 🟢 trailing wildcard, index 사용 |
| `WHERE CreatedDate >= LAST_N_DAYS:30` | 🟢 indexed |

## SOQL Injection

```apex
// 🔴 위험
String userInput = ApexPages.currentPage().getParameters().get('q');
Database.query('SELECT Id FROM Account WHERE Name = \'' + userInput + '\'');

// 🟢 escape
String safe = String.escapeSingleQuotes(userInput);
Database.query('SELECT Id FROM Account WHERE Name = \'' + safe + '\'');

// 🟢 더 좋음 — bind variable
[SELECT Id FROM Account WHERE Name = :userInput];
```

dynamic SOQL이 꼭 필요한 경우만 사용. 가능하면 static query + bind variable.

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

- `[SELECT COUNT() FROM ...]` → Integer 반환, row 한도 미적용.
- subquery `[SELECT Id, (SELECT Id FROM Contacts) FROM Account]` → Contact rows도 50K 한도에 합산.
- GROUP BY: `AggregateResult` 반환, `get('expr0')`로 값 추출.

## LIMIT 강제

큰 객체 query는 항상 LIMIT 또는 selective WHERE. trigger context에서 trigger.new.size 기반 IN clause는 OK (max 200).

## SOSL vs SOQL

- 텍스트 검색 → SOSL (`FIND :term IN ALL FIELDS RETURNING Account(Id, Name)`).
- 정확한 필드 매칭 → SOQL.

## 관련 토픽

- governor-limits.md
- sharing-fls-crud.md (WITH USER_MODE)
