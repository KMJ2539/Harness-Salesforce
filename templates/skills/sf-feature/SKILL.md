---
name: sf-feature
description: Salesforce 복합 모듈/도메인 단위 작업의 진입점. 단일 클래스/LWC 가 아니라 SObject + 필드 + Apex + LWC + Permission Set 같은 cross-cutting feature 를 한 번의 의도 정의 + 한 번의 5-persona 리뷰(CEO/Eng/Security/QA 병렬 → Library 순차)로 다룸. 승인 후 산출물별 sub-skill (sf-sobject, sf-field, sf-apex, sf-lwc, sf-aura) 을 의존성 순서로 디스패치. "주문 모듈 만들어줘", "결제 도메인 추가", "Account 360 뷰 구현" 같은 복합 요청 시 사용.
---

# /sf-feature

복합 Salesforce 모듈을 **하나의 의도 → 하나의 design → 하나의 review → 의존성 순서 디스패치** 로 다루는 메타 skill. 산출물 단위 skill (`/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-field`, `/sf-aura`) 의 상위 오케스트레이터.

## 언제 이 skill 을 쓰는가

- 사용자 요청이 단일 산출물보다 큰 도메인/feature 단위 ("주문 모듈", "결제 흐름", "Account 360 뷰", "구독 갱신 시스템")
- 여러 산출물(SObject + 필드 + Apex + LWC + …) 이 **하나의 의도** 로 묶임
- 산출물 간 의존성이 있어서 순서가 중요함

단일 산출물 (Apex 한 개, LWC 한 개) 이면 하위 skill 직접 사용.

## 워크플로우

```
Step 1: Feature Intent Elicitation
   ↓
Step 2: Decomposition → 산출물 + 의존성 그래프
   ↓
Step 3: composite design.md 작성
   ↓
Step 4: 5-persona review (CEO/Eng/Security/QA 4명 병렬 → Library 1명 순차, feature 레벨 1회)
   ↓
Step 5: 사용자 승인 게이트 (최대 3회 Edit 루프)
   ↓
Step 6: 의존성 순서로 sub-skill 디스패치 (delegated 모드)
   ↓
Step 7.5: 자동 deploy validate + 자동 수정 루프 (mechanical/logical 분류 + design 일치 게이트, cap 4회)
   ↓
Step 8: 보고
```

### Step 0.5: 프로젝트 컨벤션 확인

프로젝트 컨벤션 (`PROJECT.md` + `local.md`) 은 SessionStart hook 이 세션 시작 시 컨텍스트로 주입함. 추가 Read 불필요. 주입이 보이지 않으면 (hook 미설치) `Read .harness-sf/PROJECT.md` 와 `Read .harness-sf/local.md` 로 fallback.

sub-skill 에 dispatch 할 때 feature design.md 에 컨벤션의 핵심 default 를 명시 — sub-skill 은 delegated 모드에서 Step 0.5 를 다시 실행하지 않으므로, feature 레벨에서 한 번 통합해야 일관성 보장.

### Step 1: Feature Intent Elicitation

AskUserQuestion 으로 **feature 레벨** 정보 수집. 산출물 단위 디테일은 묻지 않음 (그건 sub-skill 단계).

**Why (도메인/비즈니스)**
- 이 feature 가 표현하는 비즈니스 개념 한 문장
- 현재 어떻게 처리하고 있나 (수동 엑셀, 다른 시스템, 미존재)
- 이 feature 없이는 무엇이 잘못되나 (실패 비용)
- 표준 Salesforce 기능 (Opportunity, Order standard object, Sales Cloud 등) 으로 처리 불가한 이유

**What (스코프)**
- 핵심 사용자 작업 3~5개 (예: "주문 생성", "주문 상태 추적", "주문 취소")
- 데이터 형태 — 어떤 엔티티가 필요한가 (대표 객체 1~2개)
- 외부 시스템 연동 여부
- Non-goals: 이 feature 가 안 할 일

**How (운영/규모)**
- 사용자 페르소나 (영업, 운영, 외부 파트너 등)
- 예상 트랜잭션 볼륨 (일 10건 / 1k건 / 100k건)
- 보안 요구 (org-wide / role-based / external 노출)
- Phase 1 vs 향후 확장 계획

**Edge Cases (feature 레벨)**
- 동시성: 같은 레코드를 여러 사용자가 동시 수정 가능?
- 데이터 정합성: 트랜잭션 경계
- 실패 모드: 외부 시스템 다운 시
- 마이그레이션: 기존 데이터를 옮길지

### Step 2: Decomposition

수집한 의도를 산출물 목록으로 분해. AskUserQuestion 으로 사용자 확인.

**산출물 카테고리**
- `sobject`: 신규 Custom Object
- `field`: 신규 또는 수정 필드 (대상 객체 명시)
- `apex`: trigger / handler / service / batch / queueable / @AuraEnabled controller
- `lwc`: Lightning Web Component
- `aura`: Aura 컴포넌트 (LWC 불가능한 경우만)
- `permission-set`: Permission Set (현재 sub-skill 미존재 → 가이드 + 메타 직접 생성)
- `flow`: Flow (현재 sub-skill 미존재 → 가이드만)

**각 산출물에 대해 수집**
- 산출물 ID (예: `order-sobject`, `order-trigger-handler`, `order-form-lwc`)
- 종류와 이름
- 역할 한 줄 (이 feature 에서 무엇을 담당하는가)
- 의존하는 다른 산출물 (예: trigger handler 는 sobject 와 fields 에 의존)

**의존성 그래프 자동 추론 + 사용자 확인**
고정 디스패치 순서 (이 안에서 같은 카테고리는 작성 순서대로):
1. sobject
2. field (의존: sobject)
3. apex (의존: sobject, field)
4. lwc / aura (의존: apex, sobject, field)
5. permission-set, flow

순서가 다르게 필요한 경우 (예: 부모 객체에 자식 객체의 roll-up 필드 — 자식 sobject 먼저 만들어야) 사용자에게 확인.

### Step 3: composite design.md 작성

`.harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md` 에 저장. 단일 파일에 feature 의도 + 모든 산출물 sketch.

**스키마**:
```markdown
---
name: {feature-slug}
type: feature
created: 2026-04-27
harness-sf: 0.1.x
artifacts: 7
---

# {Feature Name} Design

## Why (Business)
...

## What (Scope)
- Core actions: ...
- Entities: ...
- Non-goals: ...

## How (Operations)
- Personas: ...
- Volume: ...
- Security: ...
- Phasing: ...

## Edge Cases
- Concurrency: ...
- Failure modes: ...
- Migration: ...

## Artifacts

### 1. order-sobject  [type: sobject]  [status: pending]
- API name: Order__c
- Sharing: Private  [recommend]
- Name field: AutoNumber ORD-{0000}
- Role: 주문 도메인 루트 엔티티
- Depends on: -

### 2. order-status-field  [type: field]  [status: pending]
- Object: Order__c
- API: Status__c
- Type: Picklist (Pending, Confirmed, Shipped, Cancelled)
- Role: 주문 상태 추적
- Depends on: order-sobject

### 3. order-trigger-handler  [type: apex]  [subtype: trigger-handler]  [status: pending]
- Class: OrderTriggerHandler
- Sharing: with sharing  [recommend]
- Role: Status 변경 시 ShippedAt__c 자동 기록
- Depends on: order-sobject, order-status-field, order-shippedat-field

### ...

## Reviews
(Step 4 결과로 자동 채워짐)

## Dispatch Log
(Step 6 진행 시 산출물별 완료 시각/sub-skill 호출 결과 기록)
```

저장 후 사용자에게 design.md 경로 보여주고 1차 검토 요청.

### Step 3.5: design.md 확인 질의 (recommend + 비즈니스 사유)

design.md 가 첫 draft 로 작성된 직후, **사용자 확정이 필요한 결정 항목**을 AskUserQuestion 으로 역질문. 각 질문은 다음 형식 강제:

```
[항목]: 어떤 결정이 필요한가
[후보]: 합리적 옵션 모두 나열, [default]/[recommend] 태그 부여
[recommend 사유 — 비즈니스 우선]: 한 문장. 기술 디테일 아님.
[기술 사유]: (있으면) 한 줄 부차
```

**recommend 는 항상 비즈니스 우선 관점**으로 작성:
- 무엇이 **사고 비용 / 되돌림 비용 / 신뢰 손상**을 줄이는가
- 무엇이 **사용자 혼란 / 운영 복잡도**를 줄이는가
- 무엇이 **출시 속도 vs 후회 비용** 의 균형을 맞추는가
- 기술 best practice 가 비즈니스 사유와 충돌하면 비즈니스 우선

**확인 카테고리** (design.md 의 Why/What/How/Artifacts 를 보고 해당하는 것만 질문):

1. **Phasing**: 산출물 전부 vs Phase 분리
   - recommend: 산출물 5개 이상 또는 사용자 의도가 명확히 단계적이면 **"Phase 1 만 먼저"**.
   - 사유: "잘못된 결정을 되돌리는 비용이 빠른 전체 출시 비용보다 큼. 6개월 후 사용 패턴 확인하고 Phase 2 결정."

2. **Sharing model 일관성** (sObject 가 있는 경우): Private / Public Read Only / Public Read/Write
   - recommend: 일반적으로 **`Private`**.
   - 사유: "데이터 노출 사고는 거래처 신뢰 손상 + 컴플라이언스 위반 비용. 운영 편의 ('모두 보이게') 보다 사고 한 번 비용이 훨씬 큼."

3. **Permission Set 전략**: 단일 PS 통합 / 페르소나별 분리 (예: 영업 PS / 관리자 PS)
   - recommend: 페르소나가 2개 이상 명시되면 **"분리"**.
   - 사유: "단일 PS 로 시작하면 권한 사고 시 영향 범위 못 좁힘. 나중에 분리하는 비용이 처음부터 분리하는 비용보다 큼."

4. **UI 노출 범위** (LWC 가 있는 경우): 내부 사용자 / 파트너 커뮤니티 / 외부 고객
   - recommend: 명시 안 했으면 **"내부 사용자만 (Phase 1)"**.
   - 사유: "외부 노출은 보안/UX 요구가 다름. 내부에서 검증 후 외부 확장이 사고 비용을 가장 줄임."

5. **외부 API 노출** (Apex 가 있는 경우): @AuraEnabled / @RestResource / 미노출
   - recommend: feature 의도가 외부 시스템 연동 명시 안 했으면 **"미노출"**.
   - 사유: "노출 면적이 늘면 보안 리뷰 + 버전 관리 부담. 진짜 필요해진 시점에 추가가 미리 노출보다 비용 적음."

6. **데이터 보존 정책** (sObject 가 있는 경우): hard delete / soft delete (Status=Deleted) / archive
   - recommend: 비즈니스 데이터 (주문/계약 등) 면 **"soft delete"**, 일시 데이터면 **"hard delete"**.
   - 사유: "지워진 비즈니스 데이터 복구 요구는 거의 항상 옴 (감사/분쟁/실수 복구). 데이터 보존 비용 < 복구 불가 비용."

7. **Audit / Field History Tracking** (sObject): on / off
   - recommend: 금전/계약/상태 전이 필드면 **"on (해당 필드만)"**.
   - 사유: "분쟁/감사 시 '누가 언제 바꿨는지' 못 답하면 운영 비용 폭증. 켜는 비용은 미미."

8. **마이그레이션 / 기존 데이터 처리** (수정 모드 또는 대체 시스템 있는 경우): 마이그레이션 스크립트 / 신규 시스템만 / 병행 운영
   - recommend: 기존 데이터 명시되면 **"병행 운영 (Phase 1)"**.
   - 사유: "절단 마이그레이션은 사고 시 롤백 불가. 병행 운영 비용 < 데이터 유실 비용."

**적용 규칙**:
- design.md draft 가 이미 명확한 답을 가진 항목 → 질문 대신 "design.md 에 X 로 명시됨, 확정? [Y/edit]" 짧은 확인.
- design.md 가 모호하거나 비어있는 항목 → 위 형식으로 풀 질문.
- recommend 는 강요하지 않음 — 사용자가 다른 선택 시 design.md `## Decisions` 에 사유 기록 (review 시 reviewer 가 참고).
- 질문은 한 번에 1~3개씩 묶어서 — 사용자 피로도 관리.

질문 결과를 design.md 에 반영 (`## Artifacts` 의 sharing modifier 갱신, `## Phasing` 섹션 추가 등) → Step 4 진행.

### Step 3.9: design.md 스키마 검증 (필수, Step 4 진입 전)

review 호출 직전 Bash 로 design.md 무결성 확인:
```bash
node .claude/hooks/_lib/validate-design.js .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md
```
검증 항목 (validator 가 자동 수행):
- frontmatter `type: feature` + `name` 필수
- `## Artifacts` 섹션에 ≥1개 artifact, 각각 `[type: X]` 태그 + 유니크 id
- 모든 `Depends on:` 이 정의된 artifact id 참조
- 의존성 그래프가 DAG (사이클 없음)
- frontmatter `artifacts: N` 명시 시 실제 개수와 일치

실패 시 stderr 의 진단 메시지를 사용자에게 보여주고 design.md 수정 요청 → 재검증. 통과해야 Step 4 진입.

성공 시 stdout 으로 `{type, name, artifacts, order}` JSON 반환 — 이 `order` 가 Step 6 의 dispatch 순서 후보가 됨 (사용자 확인 후 확정).

### Step 4: 5-Persona Review (feature 레벨, 1회)

**2단계 호출** — 라이브러리 reviewer 가 다른 4명의 findings 를 활용해야 하므로 순서 고정.

#### Step 4a: 1차 — 4명 병렬 호출

`Agent` 툴로 **단일 메시지에서 4개 동시 호출**, design.md 경로 input.
- `sf-design-ceo-reviewer`
- `sf-design-eng-reviewer`
- `sf-design-security-reviewer`
- `sf-design-qa-reviewer`

각 reviewer 출력을 design.md `## Reviews` 에 본문 그대로 추가 (각자 `# CEO Review:` / `# Eng Review:` ... 헤더 유지).

#### Step 4b: 2차 — Library reviewer 순차 호출

4명 출력이 design.md 에 반영된 후, `sf-design-library-reviewer` 1명 호출. 이 reviewer 는 입장 시:
- `.claude/knowledge/library-catalog.md` 를 Read (필수 if-then 룰)
- design.md `## Reviews` 의 Eng 블록을 Read 하고, "framework / pattern / 추상화 / 공통 모듈" 키워드 risk 가 있으면 라이브러리 매칭 후보로 활용
- 출력 마지막에 `## Library Verdict` 섹션 — 모든 artifact 를 `library-applied` / `library-recommended` / `library-not-applicable` 셋 중 하나로 분류

이 순서는 **선택이 아니라 강제** — `issue-design-approval.js` 가 `--check-library-verdict` 게이트로 verdict 누락 시 sentinel 발급 차단.

#### 각 reviewer 관점

- **CEO**: feature 자체의 ROI, 표준 기능 / 외부 솔루션으로 가능한 부분, 스코프 줄일 여지
- **Eng**: 산출물 분해 적정성, 의존성 그래프 합리성, 트랜잭션 경계, 비동기 분리 필요성
- **Security**: feature 전체의 OWD/sharing 일관성, 외부 노출 면적, PS 전략 명시 여부
- **QA**: feature 통합 테스트 전략 (E2E 시나리오), 산출물별 단위 테스트 합산이 feature 검증으로 충분한가
- **Library**: cross-artifact 라이브러리 일관성, 카탈로그 매칭 패턴(trigger framework / selector / unit-of-work / http-mock / test-data / structured-logging) 누락 점검, 인벤토리 실측 기반 재사용 기회. Eng findings 의 "framework/pattern" 신호 받아서 후속 권고.

각 산출물의 세부 (sharing modifier 선택 등) 는 sub-skill 단계로 위임 — feature review 는 **구조 적정성**에 초점.

### Step 5: 리뷰 통합 + 사용자 승인 게이트 (per-risk 결정)

**전체 일괄 [P]roceed 금지.** 각 risk 항목별로 사용자가 명시 결정해야 한다 — design 에 시간 쏟기 원칙은 "묶어 통과" 를 허용하지 않는다.

#### Step 5.0: per-risk 결정 루프

`## Reviews` 의 모든 `[H#]`, `[M#]` 항목을 순회. 각 항목마다 AskUserQuestion 으로 선택지 강제:

```
[3/7] [eng] H1: sharing modifier missing → add with sharing
  [1] 진입 — 이대로 진행 (design 변경 없이 Resolution 에 사유 기록)
  [2] 추가수정 — design.md 보강 필요 (해당 persona 재호출)
```

답변 시 1줄 사유(8자+) 동반 의무 — "왜 진입인지" 또는 "어떻게 수정할지". 이 1줄이 Resolution log entry 가 됨. 빈/짧은 응답은 sentinel 차단되므로 다시 물음.

규칙:
- **HIGH (`H#`) 1건이라도 [2] 선택 시** → Step 5.1.5 revision 루프 진입 (해당 persona 만 재호출).
- **HIGH 모두 [1] 처리** → 사유들이 Resolution log 에 자동 채워짐 + 사용자가 한 번 더 본 뒤 Step 5.2 진행.
- **MEDIUM (`M#`)**: 같은 [1]/[2] 선택지. 재호출 비용 고려해 [2] 는 신중히.
- **LOW (`L#`) 는 묻지 않음** — 무시 가능.
- "연기 / phase 2 / 재설계" 같은 변형은 [1] 선택 + 사유 1줄에 표현 ("연기: phase 2 로", "재설계: Order 구조 자체 재검토 후 phase 1 abort").

CEO reviewer 의 `[H#]` Tradeoffs 도 동일하게 per-item 묻기.

진행 카운터: `[3/7] H2 결정 중...` 형식으로 사용자에게 진척도 표시.

#### Step 5.1: Review Resolution log 작성 (Step 5.2 진입 전 필수)

design.md 에 `## Review Resolution` 섹션 작성 — 모든 `[H#]` HIGH risk와 `[M#]` MEDIUM risk에 대해 사용자 응답 기록. reviewer 는 차단권 없음, 차단은 *사용자 미응답*에 걸림.

스키마:
```markdown
## Review Resolution

### sf-design-eng-reviewer
- H1: handler 를 sync 로 전환, future call 은 별도 queueable 로 분리. (해결)
- M1: 200 batch size 유지. AccountTrigger 평균 50 records, 4x 여유 충분. (수용 안 함)

### sf-design-security-reviewer
- H1: `with sharing` 명시함. (해결)
- M1: phase 2 로 연기, 본 feature 범위 외. (연기)

### sf-design-ceo-reviewer
- H1: standard Order 객체 검토 결과 채택, custom Order__c 폐기. (재설계)
```

규칙:
- HIGH(`H#`)는 반드시 응답 — "해결 / 수용 안 함 / 연기 / 재설계" 중 하나 + 사유 8자 이상.
- MEDIUM(`M#`)도 1줄 응답 — "연기"든 "기각"이든 명시.
- LOW(`L#`)는 의무 없음 — 무시 가능.
- 빈 응답("ok", "수용") 1단어는 sentinel이 차단.

작성 후 user 가 다시 한 번 design.md 본 뒤 [P]roceed.

승인 시 Step 5.2 → 5.5 → 6 순서로 진행. design.md 의 `## Artifacts` 섹션이 dispatch 의 작업 목록.

#### Step 5.1.5: Targeted re-review (revision flow)

Step 5.0 에서 1건 이상 [2] 추가수정 선택 시:
- 사용자에게 design.md 의 어느 섹션(`## What`, `## Artifacts` 의 특정 artifact 등)을 수정할지 가이드.
- 수정 완료되면 frontmatter `revision: N` 을 N+1 로 증가 + `revision_block_personas: [persona-1, persona-2]` 에 [2] 선택된 risk 의 발급 persona 만 기록.
- Step 4 재실행 시 **그 persona 들만** 재호출 (병렬, 다른 persona 는 건너뜀 — 비용 절감).
- 이전 review 본문은 `## Reviews` 에 `(rev N, superseded)` 표기 후 보존 — 감사 추적.
- 재호출 후 새 risk 가 나오면 다시 Step 5.0 per-risk 결정 루프 진입.
- **iteration cap**: 동일 persona 가 연속 2회 HIGH 발급 시 AskUserQuestion 으로 사용자 명시 override 요구:
  ```
  [persona] 가 revision N 과 N+1 에서 모두 HIGH 발급. 더 이상 재검토하지 않고 진행하시겠습니까?
    [1] override 진행 — 사유 입력 필수 (Resolution log 에 기록)
    [2] design 더 수정
    [3] feature 자체 abort
  ```
- 최대 revision 5회까지 — 그 이상은 강제 abort + 사용자에게 "feature scope 자체를 재검토하세요" 안내.

### Step 5.2: design 승인 sentinel 발급 (필수)

승인 직후 Bash 실행:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{FeatureName}.md
```
이 sentinel 발급 전에 issuer가 자동으로 `validate-design.js --check-resolution` 을 호출 — `## Reviews` 가 존재하면 `## Review Resolution` 의 모든 HIGH/MEDIUM ID 응답을 검증한다. 미해결 risk가 있으면 issuance 차단되고 Step 5.1 로 되돌림. 1건이 dispatch 되는 모든 sub-skill(`/sf-apex`, `/sf-lwc`, `/sf-sobject`) 의 force-app/ CREATE Write 를 한꺼번에 unlock 한다 (TTL 2h, dispatch 전체 윈도우 커버). sub-skill 들은 delegated 모드라 자체 sentinel 을 다시 발급하지 않으며, feature 레벨 sentinel 을 그대로 사용한다.

bypass: `HARNESS_SF_SKIP_RESOLUTION_GATE=1` (사용 자제 — 원칙 위반).

#### Step 5.3: design 점수 기록 (advisory)

승인 sentinel 발급 직후 점수 산출:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {feature-slug}
```
점수는 `## Reviews` resolution 충실도 기반 — 미해결 HIGH × −3, MEDIUM × −1, shallow × −0.5. 결과는 `.harness-sf/.cache/scores/{slug}.json` 에 기록되고 statusline 에 평균 점수 표시. **차단 게이트 아님** — 보고/추세 추적용.

dispatch 후 각 단계 점수도 기록 권장 (선택):
- 코드 작성 + `sf-apex-code-reviewer` 후: `score-cli.js record {slug} code_review {0-10} --detail "🔴×N 🟡×M"`
- 테스트 통과 후: `score-cli.js record {slug} test {coverage%/10} --detail "..."`
- `sf-deploy-validator` 후: `score-cli.js record {slug} deploy {pass?10:0} --detail "..."`

### Step 5.5: 라이브러리 도입 (해당 시, dispatch 전 1회)

design.md `## Decisions` 에 feature 레벨 라이브러리 도입(예: TriggerHandler, Nebula Logger)이 있으면 Step 6 dispatch **전에** `/sf-library-install` delegated 모드로 일괄 호출:
- 입력: design.md 경로 + 도입 라이브러리 목록
- install skill 이 각 라이브러리를 plan → 실행 → 검증 → `.harness-sf/decisions.md` 기록
- feature dispatch 시작 전에 인벤토리가 갱신되므로, 각 sub-skill (`/sf-apex`, `/sf-lwc`) 의 reviewer 가 새 라이브러리를 인지한 상태로 작업.
- 도입 결정 없으면 skip.

### Step 6: 의존성 순서 디스패치

#### Step 6.0: dispatch state 초기화 (필수)

Step 6 진입 직후 한 번 — Step 3.9 validator 의 `order` 결과를 머신리더블 상태 파일로 영속화:
```bash
node .claude/hooks/_lib/dispatch-state-cli.js init {feature-slug} \
  .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  '[{"id":"order-sobject","type":"sobject","sub_skill":"/sf-sobject"}, {"id":"order-status-field","type":"field","sub_skill":"/sf-field"}, ...]'
```
- `feature-slug`: design.md frontmatter `name` 값 또는 파일명에서 추출.
- artifacts JSON: validator stdout 의 `order` 순서대로, 각 항목 `{id, type, sub_skill}`.
- `permission-set`/`flow` 같이 sub-skill 미존재 type 은 `sub_skill: null` 로 — 가이드 출력만.

이 파일이 statusline 의 `dispatch:X/N` 표시 + 세션 재개 시 진행 위치 복구의 source of truth.

세션 재개 케이스: 기존 `dispatch-state/{slug}.json` 존재하면 사용자에게 "이전 dispatch 가 {idx}/{total} 까지 진행됨, 이어서 진행할까?" 확인 후 `current_index` 부터 재개.

#### Step 6.1: 산출물별 dispatch 루프

design.md `## Artifacts` 의 산출물을 dispatch-state 의 순서로 처리. 각 산출물에 대해:

**1. delegated 토큰 발급** (sub-skill 호출 직전, 매 artifact 마다):
```bash
node .claude/hooks/_lib/issue-delegated-token.js \
  .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  {artifact-id}
```
TTL 30분. sub-skill 의 Step 0 가 이 토큰을 verify 해서 delegated 모드로 분기.

**2. 상태를 in_progress 로**:
```bash
node .claude/hooks/_lib/dispatch-state-cli.js start {feature-slug} {artifact-id}
```

**3. sub-skill 호출** — 다음 정보를 전달:
- feature design.md 경로
- 처리할 artifact ID
- "Step 1~1.9 (intent / design / review) 건너뛰고 Step 2 (context-explorer) 부터 실행"
- 토큰 발급됨을 명시 — sub-skill 은 자체 Step 0 에서 검증

sub-skill 은 design.md 의 해당 artifact 섹션을 읽어 의도 파악, 자체 design 단계 없이 코드 작업 진행. 산출물 단위 review 없음 (feature review 가 커버).

**4. 결과 기록**:
- 성공: `dispatch-state-cli.js done {slug} {id}` + design.md `## Dispatch Log` 한 줄 + `## Artifacts` status `pending → done`
- 실패: `dispatch-state-cli.js fail {slug} {id} "에러 요약"` + design.md status `failed`, 사용자에게 [Retry / Skip / Abort] 묻기
- 의존하는 산출물이 failed 면 후속 dispatch 는 `skip` 으로 마킹 + 보고

`permission-set`/`flow` 같은 sub-skill 미존재 항목은 가이드 출력 후 즉시 `done` 처리 (또는 사용자가 수동 작업한 뒤 done 표시).

### Step 7.5: 자동 배포 검증 + 자동 수정 루프 (필수)

dispatch 가 끝났다고 끝이 아니다. validate-only + RunLocalTests 를 자동 실행하고, mechanical 에러는 design 일치 검증을 거쳐 자동 수정, logical 에러나 design drift 는 사용자에게 위임. iteration cap 4회로 무한 루프 차단.

#### Step 7.5.0: validate-loop 상태 초기화

```bash
node .claude/hooks/_lib/validate-loop-state.js init {feature-slug}
```

#### Step 7.5.1: deploy validate 실행 (auto-loop 모드)

`Agent` 툴로 `sf-deploy-validator` 호출. 프롬프트에 `--auto-loop {feature-slug}` 컨텍스트 명시 — agent 가 결과를 `.harness-sf/.cache/deploy-findings/{slug}.json` 으로 Write.

#### Step 7.5.2: verdict 분기

```bash
cat .harness-sf/.cache/deploy-findings/{feature-slug}.json | jq -r .verdict
```

- `ready` → Step 8 (보고) 로 진행. validate-loop state 정리 (`reset` 호출).
- `blocked` → Step 7.5.3 분류 단계로.

#### Step 7.5.3: 에러 분류

```bash
node .claude/hooks/_lib/classify-deploy-error.js \
  .harness-sf/.cache/deploy-findings/{feature-slug}.json \
  --out .harness-sf/.cache/deploy-classify/{feature-slug}.json
```

분류 결과 (`auto_fix_eligible: true|false`) 기준 분기:

- `auto_fix_eligible: false` (logical 에러 1건 이상 포함) → **자동 수정 시도 안 함**. 사용자에게 분류 결과 표 제시 + AskUserQuestion:
  ```
  logical 에러가 포함되어 자동 수정 영역이 아닙니다.
    [1] /sf-bug-investigator 위임 (root cause 분석)
    [2] 직접 수정
    [3] 보류 (본 sentinel 미발급, 사용자 후속 작업)
  ```
- `auto_fix_eligible: true` (mechanical only) → Step 7.5.4 자동 수정 루프 진입.

#### Step 7.5.4: mechanical 에러별 자동 수정 시도

분류 결과의 각 mechanical 에러에 대해 순차 처리:

**(a) fix proposal 생성** — 에러 카테고리별 결정적 변환:

| category | proposal action | 예시 |
|---|---|---|
| `field-not-found` (코드 → 존재하는 필드 typo) | `typo` | `from: Recpient__c` → `to: Recipient__c` (design 의 정식 명) |
| `fls-missing-in-ps` | `add` | PS XML 에 fieldPermissions 블록 추가 |
| `class-access-missing-in-ps` | `add` | PS XML 에 classAccesses 블록 추가 |
| `cmt-record-missing` | `add` | customMetadata/{type}.{record}.md-meta.xml 생성 |
| `ps-field-reference-stale` | `remove` | PS 에서 stale fieldPermissions 라인 제거 |

**(b) design 일치 검증**:

```bash
echo '<proposal-json>' | node .claude/hooks/_lib/verify-fix-against-design.js \
  --design .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  --proposal -
```

`consistent: true` → (c) 로. `consistent: false` → (d) 3-way 분기로.

**(c) 자동 적용 (consistent)**:

1. Edit 도구로 fix 적용 (해당 file_path)
2. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} code-fix --note "<카테고리>:<target>"` — cap 도달 시 자동 abort 후 사용자 위임
3. 모든 mechanical 에러 처리 완료되면 Step 7.5.1 로 루프 (재 validate)

**(d) 3-way 분기 (inconsistent — design 와 어긋남)**:

AskUserQuestion 으로 강제 선택:

```
mechanical 자동 수정안이 design 과 일치하지 않습니다.
대상: {target} ({category})
제안: {action} {to_value}
design 증거: {evidence_or_"design 에 선언 안 됨"}

  [1] 코드 정정 — design 이 정답, 자동 수정안 그대로 적용
  [2] design 정정 — design 에 누락/오류 있음, 보강 후 재 dispatch
  [3] 보류 — 사용자가 직접 판단
```

분기별 처리:
- `[1]` → Edit 적용 + `incr code-fix`. cap 도달 시 abort.
- `[2]` → Step 7.5.5 design 정정 루프.
- `[3]` → 본 에러는 Skip 표시, 다음 mechanical 에러로. 모든 mechanical 처리 완료되면 (Skip 1건이라도 있으면) Step 8 진입 시 "사용자 후속 작업 N건" 명시.

#### Step 7.5.5: design 정정 루프 (Step 5.1.5 revision flow 재사용)

1. AskUserQuestion 으로 어느 artifact 의 어느 항목을 보강할지 좁히기.
2. design.md Edit + frontmatter `revision: N+1` 증가 + `revision_block_personas: [eng, library, (선택) security]` 기록.
3. **영향 받은 persona 만 재호출** (Step 4 재실행, 단 4명 전수 X).
4. `## Library Verdict` 갱신.
5. resolution gate 재통과:
   ```bash
   node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{...}.md
   ```
6. dispatch-state 의 영향 artifact 만 `pending` 으로 reset:
   ```bash
   node .claude/hooks/_lib/dispatch-state-cli.js reset {slug} {affected-artifact-id} [...]
   ```
7. 영향 artifact 재 dispatch (Step 6.1).
8. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} design-fix --note "<artifact-id>: <변경 요약>"` — cap 도달 시 abort.
9. Step 7.5.1 로 루프 (재 validate).

#### Step 7.5.6: cap 도달 시

`incr` 호출이 exit 1 + cap-exceeded 반환:

```
artifact 'X' 가 deploy 단계에서 연속 2회 design 정정을 유발했거나,
총 4회 자동 수정 cap 에 도달했습니다.

  [1] feature scope 재설계 (sf-feature 처음부터)
  [2] 이 artifact 만 abort + 나머지로 진행 (제외 dispatch-state 마킹)
  [3] override — 더 이상 정정 없이 강제 진행 (사유 1줄 필수, validate sentinel 미발급)
```

선택 결과를 design.md `## Dispatch Log` 에 한 줄 기록.

### Step 8: 보고

- 생성/수정된 파일 트리
- design.md 최종 경로 + revision N
- validate-loop state 요약 (`code-fix N회 / design-fix N회 / 최종 verdict`)
- 다음 단계 권장:
  - Permission Set 부여 사용자 walkthrough
  - production org 배포 (validate sentinel 발급된 경우 `sf project deploy start --pre-destructive-changes` 안내)
  - 통합 테스트 시나리오 (design.md QA review 결과 반영)

## AskUserQuestion 정책

- feature 레벨 의도 (Why/What/How/Edge Cases) — 명시 안 됐으면 카테고리별 묻기
- 산출물 분해 — 사용자가 처음부터 산출물 목록을 명시했으면 검증만, 아니면 카테고리별 필요 여부 묻기
- 디스패치 순서가 고정 순서와 다를 필요 있으면 확인

## 단일 산출물로 충분한 경우 redirect

decomposition 결과 산출물이 1~2개로 적고 의존성도 단순하면:
- "이건 feature 단위가 아니라 단일 산출물입니다. `/sf-apex` 직접 호출이 더 적합합니다." 안내
- 사용자가 그래도 sf-feature 로 가길 원하면 진행

## 안티패턴 거부

- 산출물 100개를 한 번에 — 너무 큼. Phase 1/2 분리 권유.
- design.md 없이 dispatch — 절대 금지. 의도 정의 + review 가 끝나야 디스패치.
- 의존성 무시 dispatch (LWC 가 아직 없는 sObject 참조) — 자동 차단.
- sub-skill 의 design 단계 중복 호출 — delegated 모드는 design 안 함.

## 산출물 위치 (feature 자체)

- design 만 작성: `.harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md`
- 실제 코드/메타: 각 sub-skill 의 산출물 위치 그대로

## 호출 예시

```
사용자> /sf-feature
사용자> 주문 모듈 만들어줘. 영업팀이 주문을 만들고 상태 추적, 출고되면 자동 timestamp.

skill> [Step 1] 비즈니스/스코프/운영/edge case 질문 배터리...
사용자> (답변)

skill> [Step 2] 분해안 제안:
       1. Order__c sobject
       2. Order__c.Status__c picklist field
       3. Order__c.ShippedAt__c datetime field
       4. OrderTriggerHandler apex (Status → ShippedAt 자동 기록)
       5. orderForm LWC (Record Page)
       6. Order_User permission set
       이대로 진행? 추가/수정?

사용자> 좋아

skill> [Step 3] design.md 작성: .harness-sf/designs/2026-04-27-feature-order.md

skill> [Step 4] 4-persona review 호출 중... (병렬)

skill> [Step 5] 리뷰 dashboard:
       [CEO] approve-with-tradeoffs — Standard Order object 검토 권장
       [Eng] approve
       [Security] approve-with-risks — [MEDIUM] PS 전략 명시 필요
       [QA] approve-with-missing-cases — [필수] 동시성 케이스
       [E]dit / [P]roceed / [A]bort?

사용자> E

(design.md 보강 → Step 4 재실행 → 통과)

skill> [Step 6] 디스패치 시작 (의존성 순):
       → /sf-sobject (delegated, artifact: order-sobject)... ✓
       → /sf-field (delegated, artifact: order-status-field)... ✓
       → /sf-field (delegated, artifact: order-shippedat-field)... ✓
       → /sf-apex (delegated, artifact: order-trigger-handler)... ✓
       → /sf-lwc (delegated, artifact: order-form-lwc)... ✓
       → permission-set 가이드 출력
       완료.
```
