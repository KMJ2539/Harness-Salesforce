# LWC Data Access Patterns

Reference: Read when authoring/reviewing LWC.

## Data access options

| Option | Use | Caching |
|---|---|---|
| `lightning/uiRecordApi` (`getRecord`, `updateRecord`) | Single-record CRUD | LDS cache, automatic sharing/FLS |
| `lightning/uiObjectInfoApi` (`getObjectInfo`, `getPicklistValues`) | Metadata | Auto cache |
| `@wire(apexMethod)` cacheable | Reactive read-only | LDS cache, refreshApex possible |
| Imperative apex call | Complex logic, write, non-cacheable read | No cache |
| `lightning/uiListApi` (`getListUi`) | List view | Auto cache |

## Selection guide

- Display/edit a single record → `lightning/uiRecordApi` (no Apex needed, sharing/FLS automatic)
- Picklist values → `getPicklistValues` (no Apex needed)
- Complex query/aggregation → `@wire(cacheableApex)`
- Write operations → imperative `myMethod({ params })`
- Large list / pagination → imperative + `connectedCallback` + `loadMore` pattern

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

Rule: prefer `@wire` if cacheable. Use imperative for writes or trigger-based invocations.

## Apex method signature (called from LWC)

```apex
@AuraEnabled(cacheable=true)
public static List<Account> getAccounts(String status) {
    return [SELECT Id, Name FROM Account WHERE Status__c = :status WITH USER_MODE LIMIT 50];
}
```

- `cacheable=true` → no writes, invalidate via refreshApex.
- params are primitives or sObjects. Pass complex objects as JSON strings.
- Use `AuraHandledException` for exceptions (prevents stack-trace exposure).

## Event communication

- Parent ↔ child: `@api` (props down) + `dispatchEvent(new CustomEvent('xxx', { detail: {}, bubbles: true, composed: true }))` (events up)
- Sibling ↔ sibling: Lightning Message Service (`lightning/messageService`) — within the same page.
- The Pub/Sub library is deprecated; use LMS.
- `composed: true` crosses Shadow DOM boundaries. Use carefully.

## Anti-patterns

- `eval()`, `innerHTML =` (XSS, Locker Service violation)
- Direct `window.location` manipulation (use NavigationMixin)
- DOM queries reaching into another component's internals
- Mutating Apex call results in place (LDS cache is immutable)
- Setting reactive variables in `connectedCallback` that triggers an infinite loop

## Jest tests

- Use `@salesforce/sfdx-lwc-jest` for `jest.fn()` mocks.
- `@wire` mock: `wireAdapter.emit(data)`.
- DOM assertion: `element.shadowRoot.querySelector('lightning-input')`.

## Related topics

- sharing-fls-crud.md (USER_MODE)
