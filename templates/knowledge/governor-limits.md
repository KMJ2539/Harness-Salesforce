# Governor Limits

Reference: Read when authoring/reviewing Apex.

## Per-Transaction (Synchronous)

| Item | Limit |
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
| Queueable enqueues | 50 (no chain limit in prod, 5 in dev) |

## Async (Batch / Future / Queueable / Schedulable)

| Item | Limit |
|---|---|
| SOQL queries | 200 |
| SOQL rows | 50,000 |
| DML statements | 150 |
| CPU time | 60,000 ms |
| Heap size | 12 MB |

## Batch Apex extras

- Batch size: default 200, max 2000
- 5 concurrent batches
- `Database.QueryLocator`: 50M rows
- Iterable batch: 50,000 rows

## Violation patterns (static analysis targets)

- **SOQL/DML in for loop**: almost always a bug. Collect into a collection outside the loop and process in bulk.
- **SOQL invoked directly in a trigger handler** without bulk handling: triggers always run in bulk context (1~200 records).
- **`@future` from `@future`**: forbidden. Queueable→Queueable chaining is allowed.
- **Callout in trigger** (sync): forbidden. Use `@future(callout=true)` or Queueable.
- **Heap accumulation**: holding large collections as member variables. Assign null after processing.

## CPU time hot spots

- Repeated sort/contains on large Lists
- Linear scan over List instead of Map<Id, sObject>
- Nested loops O(n*m)
- Repeated Schema describe calls (caching recommended)

## Related topics

- async-mixed-dml.md
- soql-anti-patterns.md
