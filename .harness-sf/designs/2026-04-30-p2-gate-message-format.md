---
type: feature
name: p2-gate-message-format
date: 2026-04-30
author: mjkang2539
status: draft
revision: 1
---

# P2 — gate 실패 메시지 표준 포맷

## Why

7개 gate/validate 훅이 각자 다른 포맷으로 실패 메시지를 출력한다. 사용자가 막혔을 때 "왜 막혔는가 / 어떻게 풀까 / 어디를 봐야 하나 / override 가능한가" 를 매번 다른 자리에서 찾아야 한다.

훅은 빈도 높은 사용자-대면 인터페이스다. 포맷 통일만으로 cognitive load 가 크게 줄어든다. 기능 변경이 아니라 **출력 layer** 변경이라 위험도 가장 낮음 — P0/P1 과 병렬 진행 가능.

## What

모든 gate 훅이 차단 시 동일한 5줄 블록을 emit:

```
Blocked: <one-line reason>
Why:     <root cause / referenced rule>
Fix:     <concrete next command or edit>
File:    <path:line or sentinel path>
Override: <command or N/A>
```

규칙:
- 차단 (exit code != 0) 시 항상 이 블록 emit. 정보성 메시지 (warn) 는 자유 포맷.
- 5필드 모두 한 줄. multi-line 필요하면 `Fix:` 뒤에 들여쓰기 줄.
- 컬럼 정렬은 강제하지 않음 (값에 따라 길이 다름).

## How (변경 파일)

| 파일 | 변경 |
|---|---|
| `templates/hooks/_lib/gate-output.js` (신규) | `formatBlock({reason, why, fix, file, override})` export. stderr 로 emit, 트레일링 newline 보장. |
| `templates/hooks/pre-write-path-guard.js` | 5종 차단 메시지 (CLAUDE_AGENT 미설정, prefix 외 경로, reports/외 경로 등) 표준 포맷화. |
| `templates/hooks/pre-deploy-gate.js` | fingerprint 누락/만료 메시지 표준화. `File:` 에 `last-validation.json` 경로, `Override:` 에 `validate` 재실행 명령. |
| `templates/hooks/pre-modify-approval-gate.js` | approval sentinel 부재/만료 메시지 표준화. `Fix:` 에 sentinel 발급 경로, `File:` 에 sentinel 파일 경로. |
| `templates/hooks/pre-library-install-gate.js` | library approval 부재 메시지 표준화. |
| `templates/hooks/pre-create-design-link-gate.js` | design link 미존재 메시지 표준화. |
| `templates/hooks/stop-reviewer-validate.js` | body cap 초과 / `block` verdict 메시지 표준화. `Fix:` 에 어디를 줄여야 하는지 (≤ 80 lines). |
| `templates/hooks/stop-analyzer-validate.js` | 동일. |

### 메시지 예시

**before** (`pre-deploy-gate.js`):
```
Error: deploy fingerprint missing or expired. Run validate first.
```

**after**:
```
Blocked: deploy fingerprint missing or expired
Why:     pre-deploy-gate requires a fresh validate-only fingerprint within TTL
Fix:     run sf-deploy-validator (validate-only) then retry the deploy
File:    .harness-sf/last-validation.json
Override: HARNESS_OVERRIDE=deploy with audit reason
```

### override 표기 규칙

- override 가능: 정확한 환경변수/플래그 명시 (예: `HARNESS_OVERRIDE=modify`).
- override 불가: `Override: N/A — fix the underlying issue`.

## Tests

- `templates/hooks/_lib/__tests__/gate-output.test.js` 신규:
  - 5필드 모두 emit 검증.
  - newline 처리, 빈 필드 거부.
- `templates/hooks/_lib/__tests__/gates.snapshot.test.js` 신규:
  - 7개 gate 각각의 차단 시나리오를 트리거 → stderr snapshot 비교.
  - 모든 snapshot 이 `Blocked:` 로 시작 / `Override:` 로 끝나는 invariant 검증.

## Done when

- 7개 gate 훅이 모두 `gate-output.js` 의 `formatBlock` 을 통해서만 차단 메시지 emit.
- snapshot 테스트로 포맷 회귀 방지.
- 사용자가 어떤 gate 에서 막혀도 5줄 블록 안에서 답을 찾을 수 있다.

## Risks

- **메시지 톤 강제**: 일부 케이스 (예: path-guard 의 single-line denial) 는 5줄이 과해 보일 수 있음. → 그래도 통일성 우선. 짧은 케이스도 5줄 유지.
- **i18n**: 현재 영문 위주. 한국어 사용자라도 hook 출력은 영문 유지 (코드/경로 위주 정보라 번역 부담 낮음).

## Out of scope

- 메시지 다국어화.
- ANSI 컬러 (터미널 호환성 가변, 부담 대비 가치 낮음).
- audit log 포맷 통일 (별도 hash chain 신뢰 모델).
