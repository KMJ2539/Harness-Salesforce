# Library Catalog

`sf-design-library-reviewer` 가 design.md 검토 시 **반드시 Read** 하는 패턴 카탈로그.
"design 에 X 패턴이 있고 인벤토리에 Y 가 없으면 → 카테고리 권고 강제" 의 if-then 룰 모음.

이 파일의 역할은 **카테고리 권고 의무화**. 구체 라이브러리명은 카테고리 안의 "대표 후보" 로만 거론하고, 사용자가 직접 04t/git URL/npm명을 확정한 뒤 `/sf-library-install` 로 도입한다 (Iron Law — 환각 금지).

---

## 사용 방법 (reviewer 측)

Step 3 rubric 적용 시 본 카탈로그의 각 항목을 순회:

1. `trigger-when` 조건이 design.md 와 매칭되는가?
2. 매칭되면 인벤토리에 `inventory-marker` 흔적이 있는가?
3. 흔적 없음 → **`Category Recommendations` 에 해당 카테고리 권고 1줄 + `Library Verdict` 에 해당 artifact 를 `library-recommended: <category>` 로 기록 강제**.
4. 흔적 있음 → `Reuse Opportunities` 에 "이미 도입됨, reuse" + `Library Verdict` 에 `library-applied: <name>` 기록.
5. trigger-when 자체가 매칭 안 됨 → `Library Verdict` 에 `library-not-applicable: <reason>` 기록.

`Library Verdict` 섹션은 모든 artifact 가 셋 중 하나로 분류되어야 한다 — "검토 안 함" 상태가 design.md 에 남는 것을 막는다 (validate-design.js `--check-library-verdict` 가 차단).

---

## 패턴 목록

### 1. trigger-framework

- **trigger-when**: design.md `## Artifacts` 에 `[type: apex]` 이고 subtype 이 `trigger`, `trigger-handler`, `trigger+handler` 중 하나인 artifact 가 1개 이상 존재.
- **inventory-marker**: 다음 중 하나라도 있으면 "도입됨".
  - `force-app/**/classes/TriggerHandler.cls` (kevinohara80 패턴)
  - `force-app/**/classes/fflib_SObjectDomain.cls` (fflib)
  - `force-app/**/classes/sfab_*.cls` (sfab)
  - `.harness-sf/decisions.md` 에 `trigger-framework` 카테고리 도입 기록
- **대표 후보** (구체명 거론은 인벤토리 있을 때만, 없을 때는 카테고리만):
  - kevinohara80/sfdc-trigger-framework — 학습 비용 낮음, 단일 책임. 소규모/중간 규모 권장 default.
  - fflib-apex-common (Apex Enterprise Patterns) — Domain/Selector/Service 풀 스택. 대규모 + 패턴 정합성 중시 시.
  - sfab — context dispatch + before/after override 가벼운 베이스.
- **권고 사유 (디폴트 문구)**: "객체당 트리거 1개 + before/after 분기 + recursion guard + bypass 패턴은 trigger framework 카테고리 표준 해법. 자체 static 클래스로 시작하면 두 번째 트리거 도입 시 패턴 분기 비용 누적."

### 2. selector-pattern

- **trigger-when**: design.md 에 `[type: apex]` artifact 중 SOQL 을 직접 작성하는 service/handler 가 2개 이상이거나, 동일 객체에 대한 SOQL 이 design 안에 3회 이상 등장.
- **inventory-marker**: `force-app/**/classes/*Selector.cls`, `force-app/**/classes/fflib_SObjectSelector.cls`, decisions.md 에 `selector-pattern` 기록.
- **대표 후보**:
  - fflib_SObjectSelector — Apex Enterprise Patterns selector 베이스.
  - 자체 mini-selector (간단 케이스).
- **권고 사유**: "SOQL 분산 시 FLS/sharing 일관성 검증 비용 + 필드 추가 시 N개 클래스 동시 수정 비용. Selector 1개로 집중 시 변경 비용 O(1)."

### 3. unit-of-work

- **trigger-when**: design.md 에 `[type: apex]` artifact 중 단일 트랜잭션에서 3개 이상 sObject 를 insert/update 하거나, 부모-자식 관계의 동시 insert (parent → external Id → child) 가 명시됨.
- **inventory-marker**: `fflib_SObjectUnitOfWork.cls`, decisions.md 에 `unit-of-work` 기록.
- **대표 후보**:
  - fflib_SObjectUnitOfWork — DML 묶기 + 의존성 자동 해소.
- **권고 사유**: "수동 DML 순서 관리는 cross-object dependency 누락 사고 + DML 횟수 governor 위반의 최다 원인. UoW 가 commit 시점에 의존성 해소."

### 4. http-callout-mock

- **trigger-when**: design.md 에 `Database.AllowsCallouts` 또는 `HttpRequest` 또는 외부 API 연동이 명시되고, Test Strategy 가 `HttpCalloutMock` 직접 구현을 가정.
- **inventory-marker**: `force-app/**/classes/*HttpMock*.cls`, `force-app/**/classes/*MultiMock*.cls`, decisions.md 에 `http-callout-mock` 기록.
- **대표 후보**:
  - financialforcedev/MultiRequestMock 패턴 — endpoint 별 분기 mock.
  - 자체 enum-based mock factory.
- **권고 사유**: "엔드포인트별 분기 mock 을 매 테스트에서 직접 구현하면 retry/error/timeout 시나리오마다 N×M 케이스 boilerplate. 재사용 가능한 mock factory 한 번 도입이 장기적으로 유리."

### 5. test-data-factory

- **trigger-when**: design.md `## Artifacts` 에 `[type: apex]` `[subtype: test]` artifact 가 있고, TestSetup 으로 만들어야 할 sObject 종류가 3개 이상 (예: Account + Contact + Order + OrderItem).
- **inventory-marker**: `force-app/**/classes/TestDataFactory.cls`, `force-app/**/classes/*TestUtil.cls`, decisions.md 에 `test-data-factory` 기록.
- **대표 후보**:
  - 자체 TestDataFactory 패턴 (정적 메서드 / fluent builder).
  - sfdx-falcon test-utils.
- **권고 사유**: "테스트 데이터 셋업이 클래스마다 흩어지면 required 필드 추가 시 N개 테스트 동시 깨짐. Factory 1개에 집중 시 변경 비용 O(1)."

### 6. structured-logging

- **trigger-when**: design.md 에 batch / queueable / schedulable / @RestResource / 외부 callout 진입점이 있고, PROJECT.md `logging` 섹션이 채워져 있지 않음 (또는 `System.debug` 직접 사용 명시).
- **inventory-marker**: Nebula Logger namespace `nebc__*`, `force-app/**/classes/Logger.cls` (자체), `force-app/**/classes/IF_Log*.cls`, decisions.md 에 `structured-logging` 기록, **또는** PROJECT.md `logging.log_sobject` 가 명시됨 (자체 컨벤션 수립됨으로 간주).
- **대표 후보**:
  - jongpie/NebulaLogger — Salesforce 진영 표준 OSS 로거.
  - 자체 log sObject + IF_Logger 패턴.
- **권고 사유**: "운영 사고 시 'who/when/which payload' 답하지 못하면 trace 불가. System.debug 는 7일 후 휘발 + production 미수집. 구조화 로깅은 사고 1회 당 시간 비용 절감이 도입 비용을 상회."

---

## 카탈로그 외 패턴

위 6개 외 패턴(예: state machine, event bus, OAuth helper)은 design 에 명시적으로 등장하면 그때 reviewer 가 자체 판단으로 카테고리 권고. 카탈로그는 **누락 빈도가 높은 핵심 패턴** 만 강제 점검 대상으로 둔다.

새 패턴을 카탈로그에 추가할 때는:
1. trigger-when 조건이 grep/glob 으로 **객관적으로 판정 가능** 해야 함 (주관적 표현 금지).
2. inventory-marker 가 file pattern + decisions.md key 둘 다 정의되어야 함.
3. 권고 사유는 비즈니스 비용 (사고 비용 / 변경 비용) 으로 기술 — 기술 선호 어휘 금지.
