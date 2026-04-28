# Sharing / FLS / CRUD

레퍼런스: Apex 클래스 작성/리뷰 시 Read.

## Sharing Modifier

| 선언 | 동작 |
|---|---|
| `with sharing` | 호출 user의 sharing rule 적용 |
| `without sharing` | 모든 record 접근 (system mode) |
| `inherited sharing` | 호출자 클래스의 모드 상속 |
| 미선언 | `inherited sharing`과 동일 (Spring '18+) — 단, top-level entry는 default `without sharing` 위험 |

**원칙**:
- 모든 클래스에 명시적 선언 필수 (linter rule).
- `@AuraEnabled`, REST resource, trigger handler entry: **`with sharing` 강제**.
- batch class: 데이터 처리 의도에 따라 결정. 명시적 선언 + 주석.
- `without sharing`은 코드 리뷰에서 정당화 필요.

## CRUD (Object-level)

```apex
if (!Schema.sObjectType.Account.isAccessible()) { ... }
if (!Schema.sObjectType.Account.isCreateable()) { ... }
if (!Schema.sObjectType.Account.isUpdateable()) { ... }
if (!Schema.sObjectType.Account.isDeletable()) { ... }
```

DML 직전 체크. 위반 시 `AuraHandledException` 또는 custom exception throw.

## FLS (Field-level)

**옵션 A — `WITH USER_MODE` (Apex 60+ 권장)**
```apex
List<Account> accs = [SELECT Id, Name FROM Account WITH USER_MODE];
insert as user new Account(...);
update as user accs;
```
- 자동 FLS + sharing 체크. 위반 필드는 결과에서 제외 (query) 또는 exception (DML).

**옵션 B — `Security.stripInaccessible`**
```apex
SObjectAccessDecision d = Security.stripInaccessible(AccessType.READABLE, accs);
return d.getRecords();
```

**옵션 C — `WITH SECURITY_ENFORCED` (legacy)**
```apex
[SELECT Id, Name FROM Account WITH SECURITY_ENFORCED]
```
- 위반 시 `QueryException`. 부분 access 불가. 새 코드는 USER_MODE 권장.

**옵션 D — 수동 describe** (위 셋 다 못 쓰는 케이스)
```apex
if (!Schema.sObjectType.Account.fields.Phone.isAccessible()) { ... }
```

## @AuraEnabled / Invocable / REST 노출

- 반드시 `with sharing` + USER_MODE.
- 반환 데이터에 민감 필드 포함 금지 (`stripInaccessible` 통과).
- `@AuraEnabled(cacheable=true)`는 read-only. DML 호출 금지.

## Permission Set 전략

- profile 직접 수정 금지. Permission Set / Permission Set Group만 사용.
- Apex class access: `<classAccess>`로 PermSet에 부여.
- Custom Object/Field: PermSet의 `<objectPermissions>`, `<fieldPermissions>`.

## 관련 토픽

- soql-anti-patterns.md
- order-of-execution.md
