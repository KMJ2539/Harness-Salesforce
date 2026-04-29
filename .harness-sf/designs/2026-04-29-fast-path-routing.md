---
type: feature
name: fast-path-routing
date: 2026-04-29
author: mjkang2539
status: draft-v2
revision: 2
---

# 단일-artifact 작업의 fast-path 라우팅

## Why (background / problem)

현재 `/sf-feature` 는 모든 진입을 풀 사이클로 처리:
intent 수집 → decomposition → composite design.md → 5인 페르소나 리뷰 → resolution log → sentinel 발급 → dispatch → deploy validate.

문제는 **단일 artifact + 무위험 작업** 에도 같은 부담이 걸린다는 것:
- "Account 에 Description__c 1개 추가" — 페르소나 4명이 리뷰할 거리가 없음. CEO 페르소나는 대부분 "scope 적정" 한 줄만 출력.
- "기존 Apex 핸들러에 메서드 1개 추가" — design.md 작성보다 작업 자체가 빠름.

탈출구로 사용자가 직접 sub-skill (`/sf-apex`, `/sf-field`) 을 호출할 수 있지만:
1. 사용자가 어느 sub-skill 인지 매번 판단해야 함.
2. `/sf-feature` 와 sub-skill 의 진입 정책이 미세하게 다름 → 일관성 없음.
3. 모델이 "이건 단순한데" 판단해도 사용자 의도를 존중해 풀 사이클로 진행 → 비용/시간 낭비.

빈도 추정: 실제 sf 작업 중 **단일 artifact + 무위험 ≈ 60~70%**. 가장 흔한 케이스가 가장 무거운 흐름을 탄다.

## Non-goals

- design.md 자체를 없애기. fast-path 도 작업 기록은 남긴다 (간소화된 형태로).
- 페르소나 리뷰 영구 제거. 위험 신호가 있으면 자동으로 standard 로 승격.
- sub-skill 의 단독 호출 경로 제거. 사용자가 직접 `/sf-apex` 호출하는 것은 그대로.

## Design

### 분기 모델

`/sf-feature` 진입 직후 (Step 1 intent 수집 전) **complexity probe** 를 짧게 실행. 결과로 3가지 경로 분기:

| Path     | 조건                                                                          | 흐름                                                              |
| -------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| fast     | artifact 1개 예상 + risk 모두 "safe" + library 추가 없음                      | 해당 sub-skill 직접 위임 (intent 1줄, design 생략, 리뷰 생략)     |
| standard | artifact 2~3개 또는 risk "data-affecting" 1건 + library 없음                  | 기존 풀 사이클이지만 페르소나 2명만 (eng + security), CEO/QA 생략 |
| full     | artifact 4개 이상 / library 추가 / OWD/sharing 변경 / 외부 시스템 연동 / 마이그레이션 | 현재 풀 사이클 (5인 페르소나 그대로)                              |

### Complexity probe (Step 1 직전)

3개 질문만 (AskUserQuestion 1회):

```
Q1. 작업 규모 (한 줄 답변)
   - 1개 (예: 필드 1개, 메서드 1개)
   - 2~3개
   - 4개 이상

Q2. 위험 신호 (해당 모두 선택)
   - 없음 / 데이터 마이그레이션 / sharing 변경 /
     외부 시스템 연동 / 외부 라이브러리 도입

Q3. 기존 자산 수정?
   - 신규만 / 기존 수정 포함
```

라우팅:
- Q1=1 + Q2=없음 + Q3=신규만 → fast
- Q1=2~3 + Q2 ≤ "데이터 마이그레이션" 단독 → standard
- 그 외 → full

추가로 모델이 사용자 자연어 input 만으로 confidence 가 높으면 (e.g. "Account 에 필드 하나 추가") Q1~Q3 도 생략하고 추정 → 1줄 확인 ("fast-path 로 진행할까요? [Y/n]"). full 로의 강제 승격은 `/sf-feature --full` 또는 사용자가 N.

### Fast path 흐름

```
1. Intent (1줄) — 모델이 사용자 input 요약, 1회 확인
2. Sub-skill dispatch — sub-skill 의 standalone 모드로 진입
   - sf-apex / sf-field / sf-sobject / sf-lwc / sf-aura
3. Sub-skill 자체 흐름 (각 skill 의 design-first 또는 직접 모드)
4. 최소 기록: .harness-sf/designs/<date>-<slug>.md 에
   - frontmatter (state.fast_path: true)
   - "## What" 1문단
   - sub-skill 작업 결과
   - state.deploy.last_validation
```

핵심: fast-path 도 design.md 는 남긴다 (감사 추적). 단지 페르소나 리뷰/resolution log 가 없을 뿐.

### Standard path (2명 리뷰)

페르소나를 eng + security 로 한정. 근거:
- CEO: 단일~소수 artifact 에서는 scope 판정거리가 빈약.
- QA: sub-skill 의 `sf-apex-test-author` 가 이미 테스트 작성/실행 → QA 리뷰 가치 중복.
- Library: library 추가가 없으면 의미 없음 — 분기 조건에 이미 반영.

남는 eng + security 는 단일 artifact 작업에서도 의미 큼:
- eng: 트리거 프레임워크, governor limits, async 선택.
- security: with sharing, FLS/CRUD, 하드코딩 ID.

### Full path

현재 흐름 그대로. 변경 없음.

### 자동 승격 (escape valve)

fast/standard 진행 중 새로운 위험 신호가 발견되면 자동 승격:
- sub-skill 이 risk-rank "data-affecting" 변경 발견 (e.g. 필드 length 축소) → standard → full.
- library 추가 필요 발견 → full.
- artifact 가 예상보다 많이 늘어남 (probe 1개 → 실제 4개) → full.

승격 시 사용자에게 1회 알림 ("초기 평가는 fast 였으나 X 발견으로 full 로 전환합니다").

## Revision 2 deltas

- **결정적 키워드 매칭** 으로 confidence 추정 폐기:
  ```
  fast 키워드: "필드 1개", "메서드 추가", "단일 필드", "한 개"
  full 키워드: "마이그레이션", "OWD", "sharing 변경", "라이브러리", "외부 시스템"
  ```
  PROJECT.md `routing.fast_keywords` / `routing.full_keywords` 로 override.
- **Probe 1 질문 축소**: "위험 신호 (해당 모두): 없음 / 데이터 마이그레이션 / sharing 변경 / 외부 시스템 / 라이브러리 도입". 규모는 input 결정적 추정, Q3 는 Step 1 흡수.
- **`state.entered_via` 필드**: `"sf-feature-fast" | "sf-feature-standard" | "sf-feature-full" | "direct"`. statusline / audit 가 이 필드로 분기 표시. (state-consolidation schema 와 합의 필요.)
- **자동 승격 시 sentinel revoke**: `hsf design revoke <slug>` 강제 호출. revoke = sentinel 무효화 + state.design.approved_* 초기화.
- **Audit retro 일정**: audit.log 에 `path:fast|standard|full` 기록. 1개월 후 분포 retro (별도 schedule 등록).
- **Standard 페르소나 한정 정책 (eng+security only) 은 도입 후 재평가** (1개월 모니터링).

## Risk

- **오분류**: probe 가 fast 로 잘못 라우팅 → 위험 작업이 리뷰 없이 진행. → 자동 승격 + sub-skill 의 risk-rank 검증 (이미 존재) 이 2차 방어선.
- **사용자 혼란**: 같은 진입 명령이 케이스마다 다른 흐름. → 진입 직후 1줄로 명시 ("fast-path: sf-field 직접 진행").
- **승격 시 손실**: standard 진행 중 full 로 승격되면 이미 작성한 partial design.md 가 부족할 수 있음. → 승격 시 design.md 재작성 (현재 partial 을 보존하고 페르소나 리뷰 단계만 추가).
- **probe 자체의 비용**: 매 진입마다 3 질문 = 사용자 마찰. → 모델 추정 confidence 가 높으면 probe skip + 1줄 확인.

## Test plan

- 라우팅 정확성: 시나리오 20개 (단일 필드 / 트리거 추가 / sharing 변경 / 라이브러리 도입 / 마이그레이션 등) 에 대해 라우팅 결과 점검.
- 자동 승격: fast 시작 → 위험 발견 → full 로 전환 시나리오 1개.
- 사용자 강제 승격: `/sf-feature --full "Account 에 필드 추가"` → fast 라우팅 우회.
- 회귀: 기존 풀 사이클 시나리오 → full 라우팅으로 동일 결과.

## Rollout

1. PR 1 — probe + 라우팅 (Step 1 직전 분기). fast-path 는 sub-skill 직접 호출, 흐름은 별도 변경 없음.
2. PR 2 — standard path (2 페르소나) 도입.
3. PR 3 — 자동 승격 로직 + state.path_history 기록.

## Dependencies

- `state-consolidation` (state.fast_path, state.path_history 필드).
- `step-consolidation` 과 독립 — 어느 쪽이 먼저 들어가도 무관.

## Reviews

### Infra self-review (2026-04-29)

#### H

- **H1. 모델 confidence 자가 보정 부재.**
  Why: "모델이 자연어 input 만으로 confidence 가 높으면 probe 도 생략" — LLM 의 자가 신뢰도는 systematically over/under-confident. 보정 없이 분기 결정에 쓰면 fast-path 오라우팅이 누적.
  Suggest: confidence 추정 폐기. 대신 **결정적 키워드 매칭** ("필드 1개", "메서드 추가" 등) → 매칭 시 1줄 확인, 미매칭 시 probe Q1~Q3 강제. 결정성을 LLM 추론보다 우선.

- **H2. fast-path standalone 호출과의 일관성.**
  Why: 사용자가 직접 `/sf-apex` 호출하는 standalone 모드와 sf-feature → fast-path 가 위임하는 모드 구별 명세 없음. frontmatter 가 다르면 statusline / audit / 자동승격 시 혼란.
  Suggest: fast-path 위임도 sub-skill 의 standalone 모드와 **동일한 frontmatter** 생성. 차이는 `state.entered_via: "sf-feature-fast"` vs `"direct"` 한 필드만.

#### M

- **M1. 자동 승격 시 sentinel 폐기 절차 부재.**
  Why: fast 로 진행 중 design-approval sentinel 이 발급된 후 full 로 승격되면, 새 design.md 본문에 대해 재발급 필요. 기존 sentinel 무효화 안 하면 stale token 우회 가능.
  Suggest: 승격 시 `hsf design revoke <slug>` 의무화. 자동 승격 로직에 명시.

- **M2. probe 의 사용자 마찰 vs 정확도 트레이드오프.**
  Why: 3 질문은 단일 필드 추가에 과함. confidence skip 은 H1 에서 위험. 절충점 부재.
  Suggest: probe 질문을 2개로 축소 (Q1 규모 + Q2 위험신호 합침), Q3 는 Step 1 intent 에서 자연 도출.

- **M3. 빈도 가설 ("60~70%") 의 검증 계획 부재.**
  Why: rollout 후 실제 분포 측정 안 하면 PR 가치 평가 불가.
  Suggest: audit.log 에 path 라우팅 결과 기록, 1개월 후 실측 분포 retro.

#### L

- **L1. 페르소나 2명(eng+security) 한정 정책의 도메인 범위.**
  CEO/QA/Library 가 실제로 standard 케이스에서 빈약한지 정량 근거 부재. fast-path 도입 후 standard 출력 모니터링 필요.

#### Strengths

- 자동 승격(escape valve) 으로 잘못 라우팅된 작업의 최종 안전망 확보.
- design.md 보존 (감사 추적) — fast-path 도 빈 흐름은 아님.
- sub-skill 단독 호출과 통합되는 방향 — 진입점 단일화에 부합.

### External review (codex, 2026-04-29)

- **codex-H1. fast-path 의 "최소 기록" 포맷이 기존 feature design 계약 위반.** `## What` + 결과만 남기겠다 했지만 현 feature 는 `## Artifacts` 가 필수, validator fail (`templates/hooks/_lib/validate-design.js:18,267`). fast-path 산출물이 기존 파이프라인에 못 들어감.
- **codex-H2. sub-skill standalone 위임이 redirect loop 생성.** sub-skill 진입 전 `check-feature-context.js` 가 active feature 있으면 `/sf-feature` redirect 판단 (`templates/hooks/_lib/check-feature-context.js:2,107`). 내부 위임용 bypass/token 계약 누락 → 첫 dispatch 부터 무한 redirect.
- **codex-M1.** `state.entered_via` 소비처 없음. statusline.js 에 표시 로직 부재.
- **codex-M2.** `PROJECT.md routing.*_keywords` override 가 installer/doctor 에서 검증 안 됨 — 스키마는 안 봄.
- **codex-Seq.** PR1 라우팅 도입 전에 sub-skill 의 "feature 내부 fast-path 호출" 계약 (delegated mode 변종) 신설 선행 필요.

### Resolution

#### H

- **H1 → [1] accept.** confidence 추정 폐기. **결정적 키워드 매칭** 으로 대체:
  ```
  fast 키워드: "필드 1개", "메서드 추가", "단일 필드", "한 개"
  full 키워드: "마이그레이션", "OWD", "sharing 변경", "라이브러리", "외부 시스템"
  ```
  키워드 매칭 시 1줄 확인. 미매칭 시 probe Q1~Q3 강제. 키워드는 PROJECT.md `routing.fast_keywords` / `routing.full_keywords` 로 override 가능.

- **H2 → [1] accept.** fast-path 위임도 sub-skill standalone 과 동일한 frontmatter 생성. 차이는 `state.entered_via: "sf-feature-fast" | "sf-feature-standard" | "sf-feature-full" | "direct"` 한 필드. statusline / audit 가 이 필드만 보면 됨.

#### M

- **M1 → [1] accept.** 자동 승격 로직에 `hsf design revoke <slug>` 강제 호출 명세 추가. revoke 는 sentinel 무효화 + state 의 design.approved_* 초기화.
- **M2 → [2] modified accept.** probe 를 1 질문으로 축소: "이 작업의 위험 신호 (해당 모두): 없음 / 데이터 마이그레이션 / sharing 변경 / 외부 시스템 / 라이브러리 도입". 규모(Q1)는 모델이 input 에서 결정적 추정 가능, Q3 는 Step 1 intent 에 흡수.
- **M3 → [1] accept.** audit.log 에 `path:fast|standard|full` 필드 기록. 1개월 후 retro 일정 (별도 schedule).

#### L

- **L1 → [3] defer.** standard 페르소나 한정 정책은 fast-path PR 머지 후 1개월 standard 출력 모니터링 후 재평가. 현 시점 정량 근거 부족 인정, 그러나 도입 자체는 진행.

#### Updated design changes (revision: 2)

1. probe 를 1 질문으로 축소, 키워드 매칭 우선 분기 명시.
2. PROJECT.md `routing.{fast,full}_keywords` 스키마 추가.
3. `state.entered_via` 필드 명세 (state-consolidation 과 합의 필요 — 알림).
4. 자동 승격 시 `hsf design revoke` 호출 절차 추가.
5. audit.log 의 path 필드 + retro 일정 추가.
