---
type: feature
name: step-consolidation
date: 2026-04-29
author: mjkang2539
status: draft-v3
revision: 3
supersedes: 2026-04-29-step-consolidation.md
---

# step-consolidation v3 — sf-feature 단계 통폐합 (state.json 기반)

## Why revision 3

revision 2 외부 리뷰에서 2개 H + 2개 M + Sequencing finding. 핵심:

- **codex-H1**: hook 이 transition 을 강제한다 했지만 현 hook 은 `force-app/**` 수정만 봄 (`templates/hooks/pre-modify-approval-gate.js:6,55`). transition 검증 집행 지점이 없음.
- **codex-H2**: Step 7 의 design-fix 복귀 경로가 전이표에 없음. 현 `validate-loop-state.js:8,69` 는 code-fix/design-fix 별도 상태로 가정 — 불법 점프 또는 검증 무력화.
- **codex-Seq**: PR2 step 통폐합 전에 transition guard + Step 7 loop 재모델링 선행 필요.

state-consolidation v3 가 `state.current_step` 위치 자체를 frontmatter → state.json 으로 옮긴다. 그 위에서 transition 의미 자체도 재설계.

## 의존성

- **state-consolidation v3** (`state.json` schema 의 `current_step` 필드 + `hsf state` namespace).
- step transition guard 는 hook 이 아니라 `hsf state set current_step` 호출 시점의 CLI 검증으로 구현. 모든 step transition 은 CLI 경유 강제.

## Design

### transition table v3 (Step 7 sub-state 포함)

```
1 (intent)         → 2, 8(cancel)
2 (decompose)      → 3
3 (design)         → 4
4 (review)         → 5
5 (resolve)        → 6, 7, 3(rejected)
6 (library install) → 7
7 (dispatch+validate) — sub-state 포함:
  7.dispatch       → 7.deploy-validate
  7.deploy-validate → 7.code-fix, 7.design-fix, 8
  7.code-fix       → 7.deploy-validate (cap N)
  7.design-fix     → 3 (재설계 → 재리뷰)
8 (report)         → terminal
```

핵심: Step 7 안에 4개 sub-state. `validate-loop-state.js` 의 기존 의미를 transition table 로 흡수. design-fix → 3 재진입은 명시적 허용 (현 v2 의 `7→8` 만 허용 하던 오류 수정).

state.json 스키마:
```json
"current_step": "7.deploy-validate",   // dotted notation 으로 sub-state 표현
```

### transition guard 구현

```
hsf state set current_step <new_step> [--reason="..."]
  1. read state.json — get current_step
  2. lookup transition table: (current_step → new_step) 합법인가?
  3. 합법 → CAS write
  4. 비합법 → exit 2, 메시지 ("from <X> to <Y> not allowed; valid next: [...]")
```

모든 skill SKILL.md 본문은 step 진입 시 `hsf state set current_step <new>` 호출로 통일. 직접 frontmatter/JSON 편집 금지.

긴급 상황: `hsf state force-set current_step <new> --reason="..."` 가 audit.log 기록 후 transition table 우회. 평시 사용 거부 (override 와 같은 사유 검증).

### grep 범위 확장

PR 2 사전작업으로 step 번호 hardcode 검출 범위:
```
grep -rn 'Step [0-9]\+\(\.[0-9]\+\)*' \
  templates/ harness/ README.md examples/ .harness-sf/designs/
```

`examples/sfdx-demo/WALKTHROUGH.md:206` 도 포함. 검출 후 일괄 교체 + 이후 CI 에서 재발생 lint.

### statusline 노출 (PR D 에서)

PR D (state-consolidation v3 의 사람용 인터페이스 PR) 에 statusline.js 보강 묶음. `current_step` 을 표시하되 sub-state 까지 (`7.deploy-validate (iter 2/4)`).

## Rollout (state-consolidation v3 위에서)

- **선행**: state-consolidation v3 의 PR A (schema freeze) 가 끝나야 시작 가능.
- **PR step-1**: transition table 정의 + `hsf state set current_step` guard 구현 + force-set 명령. SKILL.md 미수정.
- **PR step-2**: grep 검출 + step 번호 hardcode 일괄 교체 (README/examples/templates/harness 모두).
- **PR step-3**: SKILL.md 14→8 단계 통폐합 + Outcome 산문 정리. `hsf state set` 호출 라인 통일.
- **PR step-4** (statusline): state-consolidation v3 의 PR D 와 묶어 진행.

## Risk

- **Sub-state 의 표현법**: `"7.deploy-validate"` dotted notation 이 schema validator 와 transition table 양쪽에서 일관 처리 필요. 단순한 string 비교라 위험 작음.
- **force-set 남용**: 평시 사용자가 막히면 force-set 으로 우회 → transition guard 무력화. → audit.log 에 force-set 빈도 기록, 1주 N회 초과 시 doctor 가 경고.
- **fast-path-routing 과의 충돌**: fast-path 는 step 1~6 을 건너뛰는 흐름. transition table 이 거부할 수 있음. → fast-path-routing v3 가 entered_via 별 transition table 분리 명시.

## Test plan

- 단위:
  - 합법 transition (`5 → 6`, `7.deploy-validate → 7.code-fix`) 통과.
  - 비합법 transition (`4 → 7`, `1 → 5`) 거부.
  - force-set 사용 시 audit.log 1줄 추가.
- 통합:
  - 전체 사이클: 1 → 2 → 3 → 4 → 5 → 7 → 7.deploy-validate → 7.code-fix → 7.deploy-validate → 8.
  - design-fix 복귀: 7.deploy-validate → 7.design-fix → 3 → 4 → 5 → 7 (재진입).
  - 잘못 작성된 SKILL.md (transition 무시) 가 CI 에서 fail.

## Reviews

### External review (codex 3차, 2026-04-29)

state-consolidation v3 에 한 codex 3차 리뷰 중 본 문서 관련:
- **(c1)** `current_step` 타입 충돌: state-consolidation-v3 예시는 `5` 정수, 본 문서는 `"7.deploy-validate"` dotted string. 합의 필요.

### Resolution

- **(c1)**: dotted string 으로 통일. 정수 step 도 string 표기 (`"5"` 또는 `"5.0"`). state-schema 문서에서 `type: string, pattern: ^\d+(\.[a-z-]+)?$`. state-consolidation v3 본문 예시 정정 필요.
