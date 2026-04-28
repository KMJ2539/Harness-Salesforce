---
name: sf-apex
description: Salesforce Apex 클래스/트리거/배치/큐어블/스케줄러블/REST 리소스를 생성하거나 수정(ensure 시맨틱). 대상이 없으면 생성, 있으면 diff 승인 후 수정. 트리거 프레임워크 적용, sharing 명시, FLS/CRUD 가드, 테스트 클래스 동반. 사용 전 sf-context-explorer로 영향 영역 분석. "Apex 클래스 만들어줘", "기존 핸들러 수정", "Account 트리거 추가/변경", "배치 클래스 작성" 같은 요청 시 사용.
---

# /sf-apex

Salesforce Apex 산출물을 **ensure 모드**로 다루는 워크플로우 — 같은 이름이 없으면 생성, 있으면 수정. create/modify 분기는 도구가 결정.

## 지원 산출물 종류
1. **Trigger + Handler** (객체 단위 트리거 + 핸들러 클래스)
2. **Service Class** (비즈니스 로직)
3. **Selector Class** (SOQL 캡슐화 — fflib 패턴)
4. **Batch Class** (Database.Batchable)
5. **Queueable Class**
6. **Schedulable Class**
7. **REST Resource** (`@RestResource`)
8. **Aura/LWC Controller** (`@AuraEnabled`)
9. **Invocable Action** (Flow에서 호출 가능)

## 워크플로우

```
Step 0: 호출 모드 판별 (standalone vs delegated)
   ↓
Step 1: Deep Intent Elicitation (AskUserQuestion 배터리)        [standalone 만]
   ↓
Step 1.5: design.md 작성 + 사용자 1차 검토                       [standalone 만]
   ↓
Step 1.7: 다관점 persona review (4개 agent 병렬, 최대 3회 루프)  [standalone 만]
   ↓
Step 1.9: 리뷰 통합 → 사용자 승인 게이트                         [standalone 만]
   ↓
Step 2 이후: context-explorer + create/modify + 테스트 + validator
```

### Step 0: 호출 모드 판별

호출자(메인 agent / `/sf-feature`)가 feature design.md 경로와 artifact ID 를 전달하면 **delegated 모드 후보**. 단, 프롬프트 텍스트만으로 판단하지 않고 **delegated-mode sentinel** 로 검증:

```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
- exit 0 + JSON `{mode, design_path, artifact_id, type, sub_skill}` → **delegated 모드 확정**
- exit 1 → sentinel 없음/만료 → standalone 모드 또는 호출자에게 토큰 발급 요청

**delegated 모드 동작**:
1. feature design.md 를 `Read` 로 로드.
2. `## Artifacts` 섹션에서 해당 artifact 항목 추출 — 종류, 이름, 역할, 의존성, sharing modifier 등 의도 정보가 거기 있음.
3. **Step 1, 1.5, 1.7, 1.9 모두 건너뜀** — design 과 review 는 feature 레벨에서 이미 완료.
4. Step 2 (context-explorer) 부터 실행. 의도 정보의 출처는 사용자 대화 대신 feature design.md 의 artifact 섹션.
5. 코드 작업 완료 시 호출자(/sf-feature) 가 `dispatch-state-cli.js done {slug} {id}` 로 상태 갱신 — 본 sub-skill 은 design.md `## Dispatch Log` 에 한 줄만 추가.
6. 실패 시 호출자에게 에러 요약 반환 (호출자가 `dispatch-state-cli.js fail` 처리).

**standalone 모드** (기본 / sentinel 없음): 아래 Step 0.3 부터 실행.

### Step 0.3: feature 컨텍스트 게이트 (standalone 진입 시 필수)

설계에 시간 쏟기 원칙 — 단독 artifact 작업이 cross-cutting 설계 검토를 우회하지 않도록 게이트 1회 통과:

```bash
node .claude/hooks/_lib/check-feature-context.js
```

stdout JSON 의 `has_active_feature` 가 `true` 이고 `candidates` 중 type 이 본 skill (`apex`) 과 일치하는 pending artifact 가 있으면, **AskUserQuestion** 으로 redirect 제안:

```
최근 14일 내 active feature design.md 가 발견됨:
  - {candidate.path} (pending: {N}개 — {artifact ids})

이 작업이 그 feature 의 일부라면 /sf-feature 진입을 권장합니다.
  [r] /sf-feature 로 redirect (권장)
  [s] standalone 으로 진행 — 사유 입력 필수
  [a] abort
```

- `r` 선택 → 사용자에게 `/sf-feature` 호출 안내 + 본 skill 종료.
- `s` 선택 → 사유 1~2문장 받아 `.harness-sf/designs/{YYYY-MM-DD}-{ClassName}-standalone.md` stub 작성:
  ```yaml
  ---
  type: apex
  name: {ClassName}
  date: {YYYY-MM-DD}
  standalone_override: true
  override_reason: "{사용자 입력}"
  ---
  ```
  이 stub 이 Step 1 의 시작점. 사유 입력 없으면 redirect 강제.
- `a` 선택 → 종료.

`has_active_feature: false` 또는 type 불일치이면 게이트 통과, Step 0.5 진행.

bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1` (사용 자제).

### Step 0.5: 프로젝트 컨벤션 확인

프로젝트 컨벤션 (`.harness-sf/PROJECT.md` + `local.md`) 은 SessionStart hook (`session-start-context.js`) 이 세션 시작 시 컨텍스트로 주입함. 추가 Read 불필요. 주입된 컨벤션이 보이지 않으면 (hook 미설치 환경) `Read .harness-sf/PROJECT.md` 와 `Read .harness-sf/local.md` 로 fallback. 이후 모든 Step 은 그 컨벤션을 [recommend] 로 적용.

### Step 1: Deep Intent Elicitation
**기존의 "클래스 종류·이름만 묻기" 는 폐기.** AskUserQuestion 으로 다음을 모두 수집 (이미 사용자가 자발적으로 제공한 항목은 건너뛰되 검증):

**기본**
- 종류 (위 9가지 중)
- 클래스명
- 대상 객체 (해당 시)
- 트리거 시점/이벤트 (트리거인 경우)

**Why (비즈니스)**
- 어떤 비즈니스 문제를 푸는가 (한 문장)
- 동작 안 하면 무엇이 잘못되나 (실패 비용)
- Flow / Validation Rule / Workflow 로 풀 수 없는 이유

**What (스코프)**
- 입력: 어떤 객체/필드/이벤트
- 출력: 어떤 데이터 변경/외부 호출/이벤트 발행
- Non-goals: 명시적으로 안 할 일

**How (실행 컨텍스트)**
- 동기/비동기 (trigger / @future / Queueable / Batch / Schedulable)
- 예상 레코드 볼륨 (1건 / 200건 bulk / 100k batch)
- 외부 callout 여부
- 사용자 컨텍스트 (UI / API / Apex 호출자)
- Sharing modifier (후보 4개 중 선택 — 별도 정책 참고)

**Edge Cases (사용자가 못 본 것 역질문)**
- bulk insert 200+ 시 동작
- recursion (자기 객체 update)
- mixed DML (Setup + Non-Setup)
- 예외 발생 시 rollback 범위
- null / empty / 권한 없는 사용자

**Test Strategy**
- positive / negative / bulk / governor boundary 의 어떤 케이스를 테스트할지
- assertion 의도 (단순 실행 통과 vs 상태 검증)

### Step 1.5: design.md 작성

수집된 답변을 다음 스키마로 `.harness-sf/designs/{YYYY-MM-DD}-{ClassName}.md` 에 저장:

```markdown
---
name: {ClassName}
type: apex
subtype: trigger-handler / batch / queueable / ...
target-object: Account
created: 2026-04-27
harness-sf: 0.1.x
---

# {ClassName} Design

## Why (Business)
...
## What (Scope)
- In: ...
- Out: ...
- Non-goals: ...
## How (Execution)
- context: synchronous / before update
- volume: up to 200 records per transaction
- sharing: with sharing  [recommend]
- order-of-execution: after Before-Save Flow "X", before Validation Rules
## Edge Cases
- bulk: ...
- recursion: ...
- mixed DML: ...
- failure mode: ...
## Test Strategy
- positive: ...
- negative: ...
- bulk: ...
- governor boundary: ...

## Reviews
(Step 1.7 결과로 자동 채워짐)
```

저장 직후 사용자에게 design.md 경로 보여주고 1차 review 요청 — "이 의도가 맞는지 확인 후 진행" 게이트.

### Step 1.6: design.md 확인 질의 (recommend + 비즈니스 사유)

design.md draft 직후, 사용자 확정이 필요한 결정 항목을 AskUserQuestion 으로 역질문. **recommend 는 비즈니스 우선** — 사고/되돌림/신뢰 손상 비용 관점.

**질문 형식**:
```
[항목]: <결정 필요>
[후보]: <옵션들 + [default]/[recommend] 태그>
[recommend 사유 — 비즈니스 우선]: <한 문장>
[기술 사유]: (있으면 한 줄)
```

**확인 카테고리** (해당하는 것만):

1. **Sharing modifier**: `with sharing` / `without sharing` / `inherited sharing` / 생략
   - recommend: `with sharing`.
   - 사유: "sharing 우회는 데이터 노출 사고 비용이 운영 편의보다 큼. 의도된 system context 가 아니면 항상 강제."

2. **비동기 vs 동기 실행 컨텍스트**: trigger / Queueable / Batch / @future / Schedulable
   - recommend (volume 많으면): **"Queueable 또는 Batch"**.
   - 사유: "동기 trigger 가 governor 한계 부딪히면 사용자가 '저장이 안 됨' 으로 체감 — 신뢰 손상. 비동기 분리가 사용자 경험 안정성을 우선."

3. **트리거 프레임워크 적용**: 신규 vs 기존 핸들러 확장
   - recommend: 객체에 트리거 1개라도 존재하면 **"기존 확장"**.
   - 사유: "트리거 2개 이상은 OoE 충돌로 production 사고 빈발. 중복 trigger 의 운영 비용이 코드 분리 비용보다 큼."

4. **테스트 데이터 전략**: `@TestSetup` / 인라인 / Test Data Factory
   - recommend: 같은 데이터 4회 이상 사용 또는 객체 의존성 복잡하면 **"Test Data Factory"**.
   - 사유: "테스트 데이터 중복은 새 필드 required 추가 시 N개 테스트 동시 실패 — 배포 차단 비용 큼."

5. **에러 처리 정책**: 예외 throw / catch + log / partial rollback
   - recommend (비즈니스 트랜잭션이면): **"partial rollback (`Database.SaveResult` + savepoint)"**.
   - 사유: "한 건 실패로 200건 전체 실패하면 사용자 신뢰 손상. 부분 성공이 일관성보다 비즈니스 가치 큼."

6. **외부 노출 (`@AuraEnabled` / `@RestResource`)**: 노출 / 미노출
   - recommend: feature 의도에 외부 호출자 명시 안 됐으면 **"미노출"**.
   - 사유: "노출 면적은 보안 리뷰 + 버전 호환 부담. 필요해진 시점에 추가가 미리 노출보다 비용 적음."

**적용 규칙** (`/sf-feature` 와 동일):
- design.md 가 이미 답한 항목 → 짧은 확인만
- 모호하면 풀 질문
- 사용자가 recommend 와 다르게 선택 시 design.md `## Decisions` 섹션에 사유 기록
- 1~3개씩 묶어 질문

결과를 design.md 에 반영 후 Step 1.7 진행.

### Step 1.7: Persona Reviews (병렬, 최대 3회 루프)

`Agent` 툴로 다음 5개를 **단일 메시지에서 병렬 호출**, design.md 경로 input:
- `sf-design-ceo-reviewer` — 비즈니스/대안 트레이드오프
- `sf-design-eng-reviewer` — OoE / governor / bulkification / 비동기 적정성
- `sf-design-security-reviewer` — sharing / FLS / dynamic SOQL / @AuraEnabled 노출
- `sf-design-qa-reviewer` — 테스트 전략 충분성, 누락 케이스, assertion 품질
- `sf-design-library-reviewer` — 직접 구현 vs 기존 트리거 프레임워크/로깅/Mocking 라이브러리 활용 트레이드오프 (인벤토리 실측 기반, 카테고리 권고)

각 reviewer 는 **트레이드오프와 risk 등급만 반환** — block 평결은 발행하지 않음.

### Step 1.9: 리뷰 통합 + per-risk 사용자 승인 게이트

5개 보고서를 통합 dashboard 로 표시. **전체 일괄 [P]roceed 금지** — 각 `[H#]`/`[M#]` risk 마다 사용자 명시 결정 강제.

```
=== Design Review for {ClassName} ===

[CEO]      approve-with-tradeoffs
[Eng]      approve-with-risks       (H1, M1)
[Security] approve
[QA]       approve-with-missing-cases (H1)
[Library]  approve-with-risks       (M1)

총 risks: HIGH 2 / MEDIUM 2 / LOW ?

[1/4] [eng] H1: OoE Before-Save Flow "X" 와 race 가능
  [1] 진입 — 이대로 진행 (사유 1줄 입력)
  [2] 추가수정 — design.md 보강 (해당 persona 재호출)
```

**per-risk 결정 루프**:
- 모든 `[H#]`, `[M#]` risk 순회, 각 항목 [1]/[2] 강제. 답변 시 1줄 사유(8자+) 의무.
- HIGH 1건이라도 [2] → design.md 수정 후 Step 1.7 재실행 (해당 persona 만 재호출).
- HIGH 모두 [1] → 사유들이 design.md `## Review Resolution` 에 자동 채워짐 → Step 1.92 진행.
- MEDIUM 도 동일 [1]/[2], 단 [2] 는 재호출 비용 고려.
- LOW 는 묻지 않음.
- "연기/재설계" 변형은 [1] + 사유 1줄로 표현 ("연기: phase 2", "재설계: 구조 재검토").

**iteration cap**: revision 5회 도달 또는 동일 persona 연속 2회 HIGH → 명시 override 요구 (사유는 Resolution 에 기록).

진행 카운터 `[3/N]` 표시.

리뷰 최종 결과는 design.md `## Reviews` 섹션에 기록 (traceability).

### Step 1.92: design 승인 sentinel 발급 (필수)

Step 1.9 가 approve / approve-with-tradeoffs 로 통과하면 **즉시** Bash 로 다음을 실행:

```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ClassName}.md
```

이 sentinel 이 없으면 Step 3 이후 force-app/main/default/{classes,triggers,...}/ 에 신규 파일 Write 가 `pre-create-design-link-gate.js` 에 의해 차단된다 (TTL 2h + git HEAD match). MODIFY 모드는 별도 sentinel(`issue-modify-approval.js`) 이 처리. 발급 명령 출력에 `approved DESIGN: ...` 가 떠야 다음 단계 진행.

### Step 1.93: 점수 기록 (advisory)

승인 sentinel 직후:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {ClassName}
```
보고용. 차단 아님. 이후 `sf-apex-code-reviewer` / `sf-apex-test-author` / `sf-deploy-validator` 통과 시 각각 `score-cli.js record {slug} code_review|test|deploy <0-10>` 호출 권장.

### Step 1.95: 라이브러리 도입 (해당 시)

design.md `## Decisions` 에 새 라이브러리 도입 결정이 있으면 (Library reviewer 의 권고 채택 또는 사용자 직접 결정), Step 2 전에 `/sf-library-install` 을 **delegated 모드** 로 호출:
- 입력: design.md 경로 + 도입 라이브러리 목록
- install skill 이 plan 승인 → 실행 → 검증 → `.harness-sf/decisions.md` 기록 → 본 skill 로 복귀
- install 실패 시 사용자에게 보고하고 Step 2 진행 여부 확인 (직접 구현으로 fallback 할지)
- 도입 결정 없으면 본 단계 skip.

### Step 2: 컨텍스트 분석 (필수)
**`Agent` 툴로 `sf-context-explorer` 호출** — 대상 객체와 변경 의도 전달.

반환된 Context Pack을 사용자에게 요약 보여주고:
- 같은 객체에 트리거 이미 있으면 → "신규 트리거 대신 기존 핸들러 확장"을 권유
- Before-Save Flow가 같은 로직 처리 중이면 → "Flow 확장 vs Apex" 판단 요청

### Step 2.5: 모드 결정 (CREATE vs MODIFY)

대상 클래스/트리거 파일 존재 여부 확인 (`Glob force-app/**/{Name}.cls` 등):

**없음 → CREATE 모드**: Step 3 이후 그대로 진행.

**있음 → MODIFY 모드**:
1. 기존 파일을 `Read` 로 로드.
2. 기존의 다음 요소를 **반드시 보존**:
   - `with sharing` / `without sharing` / `inherited sharing` 모디파이어 (변경하려면 사용자 명시 승인 필요)
   - 클래스가 구현한 인터페이스 (`Database.Batchable`, `Schedulable`, `Queueable`, `Database.AllowsCallouts`, `RestResource` 등)
   - `@AuraEnabled`, `@InvocableMethod`, `@TestVisible` 같은 어노테이션
   - public/global 시그니처 (외부 호출자 깨짐 방지)
3. 변경 의도와 기존 코드의 **diff 계획** 수립 — 어떤 메서드를 추가/수정/삭제할지.
4. **사용자 승인 게이트**: diff 미리보기를 보여주고 확정받기 전에는 쓰기 금지. 무음 덮어쓰기 금지.
5. **승인 sentinel 발급 (필수)**: 사용자가 "y/proceed" 응답한 직후, Edit/Write 직전에 Bash로 발급:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../{Name}.cls
   ```
   `pre-modify-approval-gate.js` hook이 sentinel 없으면 Edit/Write를 차단함 (TTL 30분 + git HEAD 매칭). 트리거/handler 등 여러 파일을 수정하면 모두 한 번에 인자로 넘긴다. 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.
6. 기존 테스트 클래스(`{Name}Test.cls`)가 있으면 경로를 기록 — Step 5에서 재실행해야 함.
7. trigger인 경우: 객체당 트리거 1개 원칙 유지 — 새 trigger 생성이 아닌 기존 trigger의 이벤트 추가/handler 위임 확장으로 처리.

### Step 3: 컨벤션 탐지
프로젝트 컨벤션 자동 식별:
- `Glob force-app/**/classes/*Trigger*Framework*.cls` → 트리거 프레임워크 존재 여부
- `*Selector*.cls` → Selector 패턴 사용 여부
- `*Service*.cls` → Service 레이어 패턴
- `sfdx-project.json`에서 sourceApiVersion 확인
- 명명 규칙 추론 (PascalCase, suffix 등)

### Step 4: 생성

**기본 원칙 (모든 클래스)**
- Sharing modifier — 후보군 전체를 `[default]` / `[recommend]` 표기와 함께 제시 후 사용자 선택. 무엇이 선택되든 **반드시 명시** (modifier 생략 = `[default]` 이지만 보안상 권장 안 됨):
  - `with sharing` — **[recommend]** 호출자 sharing rule 강제. 일반 비즈니스 로직 디폴트.
  - `without sharing` — sharing 무시 (system context). batch/scheduler/공용 유틸 등 의도적 케이스에만. 선택 시 클래스 상단 주석으로 사유 기록 강제.
  - `inherited sharing` — 호출자 컨텍스트 따름. Aura/LWC `@AuraEnabled` 컨트롤러처럼 호출 경로가 다양할 때 의미 있음.
  - (modifier 생략) — **[default]** 컴파일러가 받아들이는 기본 상태. 레거시 동작은 `without sharing` 과 유사 — **선택 금지**, 항상 위 셋 중 하나로 강제.

  사용자가 명시 선택하지 않으면 `[recommend] = with sharing` 적용. trigger handler 도 동일 규칙.
- API version은 `sfdx-project.json` sourceApiVersion 사용
- API version은 `sfdx-project.json` sourceApiVersion 사용
- `@AuraEnabled` 메서드는 `cacheable=true` 가능하면 적용
- DML 직전 CRUD/FLS 체크: `Schema.sObjectType.X.isCreateable()` 또는 `WITH USER_MODE`
- 동적 SOQL은 `String.escapeSingleQuotes` 또는 binding 변수
- 하드코딩 ID 절대 금지 — Custom Setting/Custom Metadata/Label로

**트리거 패턴**
```apex
trigger AccountTrigger on Account (
    before insert, before update, before delete,
    after insert, after update, after delete, after undelete
) {
    new AccountTriggerHandler().run();
}
```
- 객체당 트리거 1개 원칙
- 모든 컨텍스트 선언 (사용 안 해도) — 미래 확장 대비
- 본문은 핸들러 위임만

**핸들러 패턴 (TriggerHandler 베이스 클래스 가정)**
- `beforeInsert`, `afterUpdate` 등 컨텍스트별 메서드
- `Map<Id, SObject>` 기반 bulkified 처리
- recursion guard (베이스 클래스가 제공하지 않으면 static Boolean)

**Batch 패턴**
- `start`, `execute`, `finish` 모두 governor 한계 인식
- scope size 명시 권장 (200 기본)
- chained job이면 `Database.executeBatch` from `finish`

### Step 5: 테스트 동반 (생성 또는 보강)
**`Agent` 툴로 `sf-apex-test-author` 호출** — 대상 클래스 경로 전달.
- CREATE 모드: 신규 테스트 클래스 작성.
- MODIFY 모드: 기존 테스트 먼저 재실행해서 회귀 확인 → 새 분기에 대한 테스트 추가/보강.
self-verify 루프 통해 테스트 통과 + 커버리지 달성 확인.

### Step 6: Validation
**`Agent` 툴로 `sf-deploy-validator` 호출** (quick 모드) — 정적 분석만 수행.
SOQL injection / sharing / FLS 등 위험 신호 없음을 확인.

### Step 7: 보고
사용자에게:
- 생성 파일 목록 (path)
- 적용된 패턴 요약
- 다음 단계 권장 (deploy validate, ship 등)

## AskUserQuestion 사용 정책
다음 정보가 명시 안 됐으면 사용자에게 물어보기:
- 클래스 종류 (위 9가지)
- 클래스명
- 트리거인 경우: 객체, 이벤트
- sharing modifier — 후보 4개를 `[default]`/`[recommend]` 표기로 제시하고 명시 선택 받기 (무응답 시 `with sharing`)

## 안티패턴 거부
- 트리거 본문에 로직 직접 작성 거부 — 핸들러로 강제
- 객체당 트리거 2개 이상 거부 — 기존 트리거 확장 유도
- assertion 없는 테스트 동반 거부

## 산출물 위치
- 클래스: `force-app/main/default/classes/{Name}.cls` + `.cls-meta.xml`
- 트리거: `force-app/main/default/triggers/{Name}Trigger.trigger` + `.trigger-meta.xml`
- 테스트: `force-app/main/default/classes/{Name}Test.cls`
