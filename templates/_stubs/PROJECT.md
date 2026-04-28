# PROJECT.md

이 파일은 **팀 공유** 레이어입니다. 커밋해서 모두 같은 룰로 동작하도록 합니다.
개인 override는 같은 디렉터리의 `local.md`에 작성하세요 (gitignore됨).

design-first skill (`/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-feature`)들이
Step 1 시작 전 이 파일을 Read합니다. 우선순위: `local.md` > `PROJECT.md` > 프로젝트 `CLAUDE.md`.

자유 양식이지만, 아래 섹션이 있으면 agent들이 활용합니다.

---

## Naming Convention

(예시 — 프로젝트에 맞게 수정)
- Apex 클래스: `{Domain}{Type}` (예: `AccountService`, `OrderTriggerHandler`)
- 테스트: `{Class}Test` (suffix `Test`, `_Test` 아님)
- LWC: `camelCase` (예: `accountSummaryCard`)
- Custom Object: `{Domain}__c` (예: `Order__c`)
- Custom Field: `{Purpose}__c` (예: `ApprovalStatus__c`)

## Sharing Default

(예시)
- 모든 신규 클래스: `with sharing` 명시 필수.
- `without sharing`은 코드 리뷰 승인 + 클래스 상단 주석으로 사유 명시.

## 금지 패턴

(예시)
- profile 직접 수정 금지 — Permission Set만.
- 하드코딩 ID/URL 금지.
- `SeeAllData=true` 금지.
- (프로젝트 특유 룰 추가)

## Permission Set 전략

(예시)
- 신규 객체/필드는 `{Domain}_User` PermSet에 추가.
- 관리자용은 `{Domain}_Admin` PermSet 분리.

## API Version Floor

(예시)
- 신규 클래스 최소 API version: 60.0 (USER_MODE 사용 가능).

## Test Coverage Target

(예시)
- Org 75% (gate), 클래스별 90% 권장.

## Logging Convention

이 섹션이 있으면 `sf-apex-code-reviewer` / `sf-deploy-validator` / `sf-apex-test-author` 가
진입점(배치/REST/Callout/Invocable/Queueable/Schedulable)에 **로그 sObject 적재 도달성 + 테스트 단언**을 강제합니다.
스키마/검출 규칙 상세는 `.claude/knowledge/logging-convention.md` 참조.

섹션을 통째로 비워두면 룰 OFF — 신규 org / 컨벤션 미수립 프로젝트 기본값.

```yaml
logging:
  log_sobject: IF_Log__c            # 프로젝트의 로그 객체 API name (예: IF_Log__c, Application_Log__c, txn_log__c)
  required_fields:                   # 적재 시 채워야 할 필드 (존재 검증만)
    - ApexName__c
    - StatusCode__c
    - StartDatetime__c
  entry_points:                      # 강제할 진입점 종류 (필요한 것만 켬)
    - batch
    - rest_resource
    - callout
    - invocable
    - queueable
    - schedulable
  enforcement:
    detection: behavioral            # behavioral | name | marker
    test_assertion: required         # required | optional
    callout_wrapper: IF_Callout      # (선택) callout 진입점 검사 시 이 래퍼 *내부*는 제외
```

의도적 우회는 클래스/메서드에 `// @no-log` 주석을 달면 룰 skip (본문에 정보로 1줄 표시).
