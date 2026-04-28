# Governor Limits

레퍼런스: Apex 작성/리뷰 시 Read.

## Per-Transaction (Synchronous)

| 항목 | 한도 |
|---|---|
| SOQL queries | 100 |
| SOQL rows returned | 50,000 |
| SOSL queries | 20 |
| DML statements | 150 |
| DML rows | 10,000 |
| CPU time | 10,000 ms |
| Heap size | 6 MB |
| Callouts | 100 |
| Callout total time | 120 sec |
| Future calls | 50 |
| Queueable enqueues | 50 (chain limit 없음 prod, 5 in dev) |

## Async (Batch / Future / Queueable / Schedulable)

| 항목 | 한도 |
|---|---|
| SOQL queries | 200 |
| SOQL rows | 50,000 |
| DML statements | 150 |
| CPU time | 60,000 ms |
| Heap size | 12 MB |

## Batch Apex 추가

- Batch size: default 200, max 2000
- 동시 batch 5개
- `Database.QueryLocator`: 50M rows
- Iterable batch: 50,000 rows

## 위반 패턴 (정적 분석 대상)

- **SOQL/DML in for loop**: 거의 항상 bug. for 루프 외부에서 collection 모은 뒤 일괄 처리.
- **SOQL in trigger handler 직접 호출** without bulk: trigger는 항상 bulk context (1~200 records).
- **`@future` from `@future`**: 금지. Queueable에서 Queueable chain은 가능.
- **Callout in trigger** (sync): 금지. `@future(callout=true)` 또는 Queueable 사용.
- **Heap 누적**: 큰 collection을 멤버 변수로 보유. 처리 후 null 할당.

## CPU time hot spots

- 큰 List sort/contains 반복
- Map<Id, sObject> 대신 List linear scan
- nested loop O(n*m)
- Schema describe 반복 호출 (캐시 권장)

## 관련 토픽

- async-mixed-dml.md
- soql-anti-patterns.md
