# Async Apex / Mixed DML

레퍼런스: 비동기 처리 / mixed DML 결정 시 Read.

## Async 옵션 비교

| 옵션 | 시나리오 | 제약 |
|---|---|---|
| `@future` | 단순 fire-and-forget | 50/tx, primitive params만, future→future 금지, 모니터링 약함 |
| Queueable | 복잡 객체 params, chain 가능 | 50 enqueue/tx, chain depth 제한 (prod 무제한) |
| Batch | 50K+ 레코드 처리 | start/execute/finish, batch size 200 default |
| Schedulable | cron 시간 트리거 | Schedulable + Queueable 조합 패턴 |
| Platform Event | pub/sub, cross-tx | replay, capture in trigger after publish |

## 선택 가이드

- 트리거 안에서 비동기 필요 → **Queueable** (params 자유, chain 가능, 모니터링 우수)
- 콜아웃 + 트리거 컨텍스트 → `@future(callout=true)` 또는 Queueable + `Database.AllowsCallouts`
- 100k+ 레코드 정기 처리 → Batch + Schedulable
- 외부 시스템 알림 → Platform Event (재시도 자동)

## Mixed DML 위반

같은 트랜잭션에서 setup + non-setup sObject DML 금지.

**Setup objects**: User, UserRole, Group, GroupMember, PermissionSet, Profile, etc.
**Non-setup**: Account, Contact, custom objects, etc.

**해결**: Setup DML을 `@future` 또는 Queueable로 분리. 또는 반대로.

```apex
// 위반
insert new Account(Name='X');
insert new Group(Name='Y');

// 해결
insert new Account(Name='X');
System.enqueueJob(new SetupDmlQueueable(...));
```

## Test 컨텍스트 예외

- Test 메서드는 `System.runAs(user)` 블록 내에서 setup+non-setup mixed DML 허용.

## Recursion 가드 (트리거에서 Queueable 호출 시)

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

## 관련 토픽

- governor-limits.md
- order-of-execution.md
