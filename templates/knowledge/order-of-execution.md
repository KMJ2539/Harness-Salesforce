# Order of Execution (Salesforce Save Order)

레퍼런스: agent가 트리거/Flow/Validation Rule 충돌을 추론할 때 Read.

## Save Order (insert/update on standard objects)

1. Original record loaded (또는 신규 sObject 초기화)
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

## 충돌 패턴

- **Before-save Flow + Before Trigger**: Flow가 먼저. 같은 필드를 둘 다 수정 시 trigger가 최종.
- **WFR field update가 트리거 재호출**: recursion 위험. trigger에 `Trigger.new`/`Trigger.old` 비교 가드 또는 static flag.
- **Validation Rule이 trigger 이후 평가됨** (Custom VR): trigger에서 set한 값이 VR 통과 못 하면 전체 롤백.
- **Roll-Up Summary**: 자식 DML → 부모 update fires → 부모 trigger fires (예상 못 한 chain).
- **Process Builder는 deprecated** but 잔존 시 after-save Flow 위치에서 동작.

## Async/post-commit

- `System.enqueueJob()`, `@future`, Platform Event publish는 **commit 후** 실행. 같은 트랜잭션에서 콜백받지 못함.
- Mixed DML (setup ↔ non-setup sObject 같은 트랜잭션) → `@future` 또는 Queueable 필요.

## 관련 토픽

- governor-limits.md (트리거 bulk 처리)
- async-mixed-dml.md (commit 후 처리)
