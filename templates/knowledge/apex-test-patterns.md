# Apex Test Patterns

Reference: Read when authoring/reviewing test classes.

## Coverage policy

- Org-wide 75% minimum (production deploy gate).
- Triggers: 1%+ (in practice 100% required).
- 75% per changed class also recommended (enforced by deploy-validator).
- **Coverage != Quality**: execution-only tests without assertions are forbidden.

## Test structure

```apex
@isTest(SeeAllData=false)
private class AccountServiceTest {

    @TestSetup
    static void setup() {
        // Shared data for all tests. Runs once per context.
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

## Required cases

| Category | Example |
|---|---|
| Positive | happy path, 1 record |
| Bulk | 200 records (validates trigger/batch limits) |
| Negative | null, empty, invalid ID, no permission |
| Boundary | 0 records, exactly at the limit (200, 10K) |
| Async | invoked inside `Test.startTest()`/`stopTest()` |
| Permission | `System.runAs(restrictedUser)` |
| FLS | verify stripInaccessible result under restricted user |

## Anti-patterns

- `SeeAllData=true` (breaks isolation, depends on build environment)
- Overuse of `@TestVisible` (bypasses private intent)
- Execute-only without assertions
- Hardcoded ID
- 100+ DML in a single test (slowness unrelated to governor limits)
- Callouts without mocks (real callouts require `Test.setMock(HttpCalloutMock.class, ...)`)

## Mocking

```apex
Test.setMock(HttpCalloutMock.class, new MockHttpResponseGenerator());
Test.setMock(WebServiceMock.class, new SoapMock());
```

DML/SOQL have no mocks — test against real data (TestDataFactory).

## Related topics

- governor-limits.md (bulk test limits)
- sharing-fls-crud.md (permission tests)
