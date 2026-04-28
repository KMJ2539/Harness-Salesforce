# LWC Data Access Patterns

레퍼런스: LWC 작성/리뷰 시 Read.

## 데이터 접근 옵션

| 옵션 | 용도 | 캐싱 |
|---|---|---|
| `lightning/uiRecordApi` (`getRecord`, `updateRecord`) | 단일 record CRUD | LDS 캐시, 자동 sharing/FLS |
| `lightning/uiObjectInfoApi` (`getObjectInfo`, `getPicklistValues`) | 메타데이터 | 자동 캐시 |
| `@wire(apexMethod)` cacheable | reactive read-only | LDS 캐시, refreshApex 가능 |
| imperative apex call | 복잡 로직, write, 비-cacheable read | 캐시 없음 |
| `lightning/uiListApi` (`getListUi`) | list view | 자동 캐시 |

## 선택 가이드

- 단일 record 표시/편집 → `lightning/uiRecordApi` (Apex 불필요, sharing/FLS 자동)
- picklist values → `getPicklistValues` (Apex 불필요)
- 복잡 query/aggregation → `@wire(cacheableApex)`
- write 작업 → imperative `myMethod({ params })`
- 큰 list / pagination → imperative + `connectedCallback` + `loadMore` 패턴

## @wire vs imperative

```js
// @wire — reactive, auto-refresh on param change
@wire(getAccounts, { status: '$selectedStatus' })
accounts;

// imperative — explicit control
async handleClick() {
    try {
        const result = await getAccounts({ status: this.selectedStatus });
        this.accounts = result;
    } catch (e) {
        this.error = e.body?.message;
    }
}
```

규칙: cacheable이면 `@wire` 우선. write 또는 trigger 기반 호출이면 imperative.

## Apex 메서드 시그니처 (LWC에서 호출)

```apex
@AuraEnabled(cacheable=true)
public static List<Account> getAccounts(String status) {
    return [SELECT Id, Name FROM Account WHERE Status__c = :status WITH USER_MODE LIMIT 50];
}
```

- `cacheable=true` → write 금지, refreshApex로 무효화.
- params는 primitive 또는 sObject. complex object는 JSON string으로.
- 예외는 `AuraHandledException` 사용 (stack trace 노출 방지).

## 이벤트 통신

- 부모 ↔ 자식: `@api` (props down) + `dispatchEvent(new CustomEvent('xxx', { detail: {}, bubbles: true, composed: true }))` (events up)
- 형제 ↔ 형제: Lightning Message Service (`lightning/messageService`) — 같은 페이지 내.
- Pub/Sub 라이브러리는 deprecated, LMS 사용.
- `composed: true`는 Shadow DOM 경계 통과. 신중하게.

## 안티패턴

- `eval()`, `innerHTML =` (XSS, Locker Service 위반)
- `window.location` 직접 조작 (NavigationMixin 사용)
- DOM query로 다른 컴포넌트 내부 접근
- Apex 호출 결과를 그대로 mutate (LDS 캐시 immutable)
- `connectedCallback`에서 무한 루프 트리거하는 reactive 변수 set

## Jest 테스트

- `jest.fn()` mock은 `@salesforce/sfdx-lwc-jest` 사용.
- `@wire` mock: `wireAdapter.emit(data)`.
- DOM assertion: `element.shadowRoot.querySelector('lightning-input')`.

## 관련 토픽

- sharing-fls-crud.md (USER_MODE)
