# Apex Test Patterns

레퍼런스: 테스트 클래스 작성/리뷰 시 Read.

## 커버리지 정책

- Org 전체 75% 최소 (production deploy 게이트).
- 트리거: 1% 이상 (실질적으로 100% 필수).
- 변경된 클래스 단위로도 75% 권장 (deploy-validator에서 강제).
- **Coverage ≠ Quality**: assertion 없는 execution-only 테스트 금지.

## 테스트 구조

```apex
@isTest(SeeAllData=false)
private class AccountServiceTest {

    @TestSetup
    static void setup() {
        // 모든 테스트 공통 데이터. context별 1회 실행.
        TestDataFactory.createAccountsWithContacts(200);
    }

    @isTest
    static void positive_singleRecord() {
        Account a = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        AccountService.process(a.Id);
        Test.stopTest();

        Account refreshed = [SELECT Status__c FROM Account WHERE Id = :a.Id];
        System.assertEquals('Processed', refreshed.Status__c, 'Status should be set');
    }

    @isTest
    static void bulk_200Records() {
        List<Account> accs = [SELECT Id FROM Account];

        Test.startTest();
        AccountService.processAll(accs);
        Test.stopTest();

        Integer processed = [SELECT COUNT() FROM Account WHERE Status__c = 'Processed'];
        System.assertEquals(200, processed);
    }

    @isTest
    static void negative_invalidInput() {
        try {
            AccountService.process(null);
            System.assert(false, 'Should have thrown');
        } catch (IllegalArgumentException e) {
            System.assert(e.getMessage().contains('null'), 'Message: ' + e.getMessage());
        }
    }
}
```

## 필수 케이스

| 카테고리 | 예 |
|---|---|
| Positive | happy path, 1 record |
| Bulk | 200 records (트리거/batch 한도 검증) |
| Negative | null, empty, 잘못된 ID, 권한 없음 |
| Boundary | 0 records, 정확히 한도 (200, 10K) |
| Async | `Test.startTest()`/`stopTest()` 내부 호출 |
| Permission | `System.runAs(restrictedUser)` |
| FLS | restricted user에서 stripInaccessible 결과 검증 |

## 안티패턴

- `SeeAllData=true` (격리 깨짐, 빌드 환경 의존)
- `@TestVisible` 남용 (private 의도 우회)
- assertion 없이 execute만
- hardcoded ID
- 같은 테스트에서 100+ DML (governor 한도와 무관한 slowness)
- mock 없이 callout (실제 콜아웃은 `Test.setMock(HttpCalloutMock.class, ...)` 필수)

## Mocking

```apex
Test.setMock(HttpCalloutMock.class, new MockHttpResponseGenerator());
Test.setMock(WebServiceMock.class, new SoapMock());
```

DML/SOQL은 mock 없음 — 실제 데이터로 테스트 (TestDataFactory).

## 관련 토픽

- governor-limits.md (bulk test 한도)
- sharing-fls-crud.md (permission test)
