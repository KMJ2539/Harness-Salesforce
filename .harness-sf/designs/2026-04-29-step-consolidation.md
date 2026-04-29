---
type: feature
name: step-consolidation
date: 2026-04-29
author: mjkang2539
status: draft-v2
revision: 2
---

# sf-feature 단계 통폐합 (`14단계 → 8단계`)

## Why (background / problem)

`templates/skills/sf-feature/SKILL.md` 는 635줄, 14개 명시 단계 (Step 0.5 / 1 / 2 / 3 / 3.5 / 3.9 / 4 / 5 / 5.2 / 5.5 / 6 / 7.5 / 8). 7.5는 내부적으로 다시 7.5.0~7.5.6 으로 쪼개져 실질 20단계.

문제:
- **모델 인지 부하**: 매 호출마다 SKILL.md 전체를 재독. 단일 task에 비해 컨텍스트가 과하게 큼.
- **단계 경계 모호**: 3.5(confirmation)와 3.9(schema validation)는 둘 다 "design 작성 후 검증" — 분리 이유가 약함. 5와 5.2도 같은 분류 (승인+sentinel 발급).
- **분기 누락 위험**: 단계가 많을수록 모델이 한두 단계를 누락할 확률 증가 → sentinel hook이 거부 → 재시도 루프 → 사용자 체감 lag.
- **유지보수 비용**: 신규 검증 추가 시 "어느 Step에 넣지?" 가 비결정적. 결과적으로 Step 3.7, 3.8 처럼 소수점 단계가 늘어남.

## Non-goals

- 단계의 **의미** 제거. design 작성, 페르소나 리뷰, 사용자 승인, dispatch, deploy validate 는 모두 유지.
- 검증의 강도 약화. validate-design / sentinel / approval gate 는 유지.
- sub-skill 의 단계 변경 (`sf-apex`, `sf-lwc` 등). 이 문서는 `sf-feature` 한정.

## Design

### 통폐합 매핑

| 통합 후 (8단계)             | 통합 전 (현재)              | 합치는 근거                                   |
| --------------------------- | --------------------------- | --------------------------------------------- |
| Step 1. Intent              | 0.5 + 1                     | 0.5 는 1줄 컨벤션 확인 — Step 1 도입부에 흡수 |
| Step 2. Decomposition       | 2                           | 그대로                                        |
| Step 3. Design              | 3 + 3.5 + 3.9               | 작성 → confirm → schema validate 직선 흐름    |
| Step 4. Review              | 4                           | 그대로                                        |
| Step 5. Resolve & Approve   | 5 + 5.2                     | 사용자 결정 + sentinel 발급은 한 게이트       |
| Step 6. Library install     | 5.5                         | 위치 이동(승인 후 → dispatch 전), 단계 유지   |
| Step 7. Dispatch & Validate | 6 + 7.5                     | dispatch 와 deploy validate 는 같은 루프      |
| Step 8. Report              | 8                           | 그대로                                        |

총 14 → 8 (약 43% 감소). 7.5 의 내부 7.5.0~7.5.6 은 Step 7 안의 sub-flow 로 들여쓰기 유지(외부 노출 줄임).

### 본문 길이 목표

- 현재: 635 줄.
- 목표: 350 줄 이하 (45% 감소).

감소 원천:
1. 단계 간 중복 안내 ("이전 단계 결과 확인", "다음 단계 진입 전") 제거 — Step 헤더가 순서를 보장.
2. CLI 호출 라인 단축 — `state-consolidation` 문서의 `harness-sf-cli` 적용 후 `node templates/hooks/_lib/<file>.js arg arg` → `hsf <subcmd>`.
3. 예시 블록 외부화 — 페르소나별 review 출력 예시 등 긴 코드블록은 `templates/skills/sf-feature/examples/*.md` 로 분리, 본문은 링크.

### 분기/예외 처리 명시성 보존

단계가 줄면서 "어느 분기에서 어디로 점프하는가" 가 흐려질 위험 → 각 단계 끝에 `Outcome:` 블록 신설:

```
### Step 5. Resolve & Approve

(본문)

Outcome:
- approved → Step 6
- rejected (review에서 차단) → Step 3 으로 돌아가 design 수정
- conditional → 조건 명시 후 Step 6
```

현재는 산문 안에 점프 조건이 섞여 있어 모델이 놓치기 쉬움.

### 마이그레이션

`sf-feature` 만 변경. 다른 skill 은 그대로. dispatch 계약(`delegated-mode` 토큰)은 변경 없음 — sub-skill 영향 없음.

기존 in-flight feature(state.dispatch 진행 중)는 새 단계 번호로 매핑되지만 의미는 동일하므로 호환 가능.

## Revision 2 deltas

- **Step transition state machine**: frontmatter `state.current_step` 필드 추가. hook 이 transition 적법성 검증.
  ```
  1 → 2, 1 → 8 (cancel)
  2 → 3
  3 → 4
  4 → 5
  5 → 6 (library), 5 → 7 (no library), 5 → 3 (rejected)
  6 → 7
  7 → 8
  ```
  비합법 점프 (e.g. 4 → 7) 거부.
- **본문 길이 측정 기준**: 라인 → 토큰 (cl100k_base 기준). 50% 감소 목표. PR 별 측정값 PR 설명에 첨부.
- **examples 외부화 폐기**: skill loader 호환성 우려로 본문 내 코드블록 길이 축소 (5줄 미만 mock) 로 대체.
- **부록 신설**: `## Appendix: 7.5 sub-step mapping` — 7.5.0~7.5.6 각각이 새 Step 7 의 어느 줄에 대응하는지 1:1.
- **PR 2 사전작업**: `grep -rn "Step [0-9]\.[0-9]" templates/ harness/` 로 hardcode 검출 후 일괄 교체.

## Risk

- **흐름 추적 약화**: 14 → 8 통합 시 모델이 "현재 어느 단계?" 를 잘못 판단할 수 있음. → `state-consolidation` 의 `state.current_step` 필드와 `statusline.js` 로 외부에서 표시.
- **사용자 학습 비용**: 기존 사용자는 Step 5.2 같은 번호를 디버깅 메시지에서 자주 봄. 번호 변경은 짧은 혼란. → CHANGELOG 에 매핑 표 명시 + 1버전 동안 deprecation 주석.
- **세부 단계 정보 손실**: 3.5(recommend+business reasoning)는 디테일이 풍부. 단순히 흡수하면 가이드가 묽어짐. → Step 3 본문에 "Confirmation rules" 소제목으로 보존.

## Test plan

- 회귀: 기존 in-flight feature 1개를 신규 sf-feature 로 이어 처리 → 정상 종료.
- 신규: zero-state 에서 풀 사이클 (intent → done) → 단계 transition 이 의도대로.
- 단계 누락: Step 4 우회 시도 → sentinel hook 이 거부 (현재와 동일 보안 수준).
- 토큰: 본문 라인 수 < 350, 모델 첫 read 시 컨텍스트 토큰 측정 후 비교.

## Rollout

1. PR 1 — Outcome 블록 + 예시 외부화 (본문 변경 최소).
2. PR 2 — 단계 번호 통폐합 (3+3.5+3.9 → 3, 5+5.2 → 5, 6+7.5 → 7).
3. PR 3 — `state-consolidation` 의 `hsf` CLI 적용 후 호출 라인 단축.

## Dependencies

- `state-consolidation` (state.current_step, hsf CLI). PR 2/3 는 그 위에서 진행.

## Reviews

### Infra self-review (2026-04-29)

#### H

- **H1. Outcome 블록이 산문으로 약화될 위험.**
  Why: 현재 분기는 sentinel hook 으로 강제 (e.g. design 미승인 → modify-approval 발급 거부). Outcome 블록을 산문으로 적으면 모델이 다시 "맥락 추론" 해야 함 → step-consolidation 의 인지 부하 감소가 분기 신뢰성 감소와 상쇄.
  Suggest: Outcome 은 단계 끝의 **상태 머신 명시** 로 다룬다. 각 단계가 진입 시 `state.current_step` 갱신, hook 이 step transition 적법성 검증 (e.g. Step 5 → Step 7 점프 거부).

#### M

- **M1. SKILL.md 라인 350 목표의 측정 기준 부재.**
  Why: raw line count 와 모델이 컨텍스트로 읽는 토큰 수는 다름. 코드블록 비중에 따라 토큰/라인 비율이 변함.
  Suggest: 측정 기준을 "토큰 수 (cl100k_base 기준)" 로 변경. 현재 본문 토큰 측정 → 50% 감소 목표 (45% 라인 ≠ 45% 토큰).

- **M2. examples 외부화의 skill loader 호환성.**
  Why: Claude Code 의 user-level skill loader 는 SKILL.md 만 자동 로드. `examples/*.md` 는 모델이 명시적으로 Read 해야 함 → 단계 본문에 "예시는 examples/foo.md Read" 안내 필요. 이걸 누락하면 가이드 사라짐.
  Suggest: 외부화 대신 본문 내 코드블록의 길이만 줄이고, 1줄 요약 + 링크는 본문에 유지.

- **M3. 14→8 단계 매핑 표의 sub-step 흡수 명세 부재.**
  Why: 7.5.0~7.5.6 (7개 sub-step) 을 Step 7 안에 흡수한다고 했으나, 외부 노출 안 한다는 것 외에 의미 손실 없는지 불명확. 특히 7.5.5 (deploy 결과 분류) 와 7.5.6 (auto-fix loop cap) 는 hook 의존이라 단계 번호로 참조됨.
  Suggest: 매핑 부록에 7.5.0~7.5.6 각각이 Step 7 의 어느 줄에 해당하는지 1:1 명시.

#### L

- **L1. Step 번호 hardcode 검색 누락.**
  CHANGELOG 에 매핑 표만 있고, statusline.js / hooks 안에 "Step 5.2" 같은 문자열 hardcode 가 있는지 사전 grep 필요.

#### Strengths

- 통폐합 매핑이 의미 보존을 명시 (validate-design 같은 핵심 검증은 그대로).
- 의존성을 state-consolidation 에 후행시켜 PR 순서 명확.
- 단계 통폐합 + 예시 외부화가 다른 차원이라 점진 적용 가능.

### External review (codex, 2026-04-29)

- **codex-H1. 전이 검증 hook 의 집행 지점 부재.** 문서는 hook 이 `state.current_step` 전이를 강제한다 했지만, 현 hook 은 `force-app/**` 수정만 봄 (`templates/hooks/pre-modify-approval-gate.js:6,55`). 설계 문서의 step 이동을 차단하는 곳이 없음.
- **codex-H2. Step 7 의 design-fix 복귀 경로 누락.** 전이표는 `7→8` 만 허용하지만 deploy-validate 루프는 code-fix 와 design-fix 를 별도 상태로 가정 (`templates/hooks/_lib/validate-loop-state.js:8,69`). validate 중 설계 수정 발생 시 불법 점프로 막히거나 검증 무력화.
- **codex-M1.** step 번호 grep 범위 좁음. README.md, examples/sfdx-demo/WALKTHROUGH.md 도 stale 됨.
- **codex-M2.** `current_step` statusline 노출 안 됨 — 현재 statusline.js 는 design slug/dispatch/score/validation age 만 표시.
- **codex-Seq.** PR2 step 통폐합 전에 transition guard + Step 7 loop 재모델링 선행 필요.

### Resolution

#### H

- **H1 → [1] accept.** Outcome 산문은 가이드 용도, 분기 강제는 별도. `state.current_step` 필드 (state-consolidation 의 frontmatter state 에 추가) 와 hook 검증 도입. transition table:
  ```
  1 → 2, 1 → 8 (cancel)
  2 → 3
  3 → 4
  4 → 5
  5 → 6 (library 필요), 5 → 7 (library 없음), 5 → 3 (rejected)
  6 → 7
  7 → 8
  ```
  `pre-modify-approval-gate.js` 가 transition 검증, 비합법적 점프 거부.

#### M

- **M1 → [1] accept.** 측정 기준을 토큰 수 (cl100k_base 또는 Claude tokenizer) 로 변경. 현재 본문 측정 → 50% 감소 목표. PR 별로 측정값 PR 설명에 포함.
- **M2 → [1] accept.** examples 외부화 폐기. 본문 내 코드블록만 길이 축소 (예: 페르소나 출력 예시는 5줄 미만 mock 으로). 외부화 비용 > 이득.
- **M3 → [1] accept.** 매핑 부록 신설 (`step-consolidation` 본문 끝 `## Appendix: 7.5 sub-step mapping`). 7.5.0~7.5.6 각각이 새 Step 7 의 어느 줄/소제목에 대응하는지 1:1 표기.

#### L

- **L1 → [1] accept.** PR 2 직전 `grep -rn "Step 5\.2\|Step 7\.5\." templates/ harness/` 실행, hardcode 발견 시 일괄 교체.

#### Updated design changes (revision: 2)

1. Step transition table 본문 추가 (Outcome 블록 절 직후).
2. 측정 기준을 토큰 수로 변경 (`Test plan` 항목).
3. examples 외부화 항목 제거 (`Design` § 본문 길이 목표).
4. `## Appendix: 7.5 sub-step mapping` 신설.
5. PR 2 사전 작업으로 "step-number hardcode grep" 추가 (`Rollout`).
