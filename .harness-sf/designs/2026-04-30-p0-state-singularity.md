---
type: feature
name: p0-state-singularity
date: 2026-04-30
author: mjkang2539
status: draft
revision: 1
---

# P0 — control state 단일화 (design.md `[status]` 이중 쓰기 제거)

## Why

`dispatch-state` (`.harness-sf/state/<slug>__r<rev>.json`)는 이미 canonical 실행 상태 저장소다. 그런데 두 곳이 같은 값을 들고 있다:

1. **canonical**: `dispatch-state-cli.js` 가 관리하는 JSON — `pending/in_progress/done/failed/skipped`.
2. **거울**: `design.md` `## Artifacts` 섹션의 `### N. <id> [type: X] [status: pending]` 헤더 태그.

`SKILL.md:427-428` 가 dispatch 성공/실패 시 **두 곳 모두** 갱신하도록 명시한다. 거울이 깨지면 사용자에게 보이는 진실(`design.md`)과 실행기가 보는 진실(`state.json`)이 어긋난다 — 가장 헷갈리는 종류의 버그.

`check-feature-context.js:65-67`, `statusline.js:85-93` 둘 다 `[status: ...]` 를 직접 파싱하는 fallback 경로가 있어 거울이 우연히 살아 움직이는 것처럼 보일 수 있다 — drift 의 진짜 진입점.

`2026-04-29-state-consolidation-v3` 가 design.md frontmatter SoT 시도를 폐기한 흐름과 같은 방향: design.md 는 **사람용 합의 문서**, 실행 상태는 JSON 한 곳에서만.

## What

- `design.md ## Artifacts` 의 `[status: ...]` 태그는 **초기 plan marker** 로만 둔다 (또는 제거).
- runtime 갱신 지시 전부 제거. `## Dispatch Log` 만 append-only 이벤트 로그로 유지.
- `dispatch-state` 가 부재일 때만 design.md 를 bootstrap fallback 으로 읽되, 그 외 모든 경로는 canonical state 만 신뢰.

## How (변경 파일)

| 파일 | 변경 |
|---|---|
| `templates/skills/sf-feature/SKILL.md:427-428` | "design.md status `pending → done`" 갱신 지시 제거. `## Dispatch Log` 1줄 append-only 만 유지: `2026-04-30 14:23 order-handler done`. |
| `templates/skills/sf-feature/SKILL.md:138-156` (예시 템플릿) | `[status: pending]` 태그 제거. 또는 "initial plan marker — runtime 에 갱신되지 않음" 주석 추가. |
| `templates/skills/sf-feature/SKILL.md` Step 6 본문 | dispatch 성공/실패 후 design.md 갱신 단계 삭제. `dispatch-state-cli.js done/fail` 호출만 남김. |
| `templates/hooks/_lib/check-feature-context.js:56-68` | `parsePendingArtifacts` → 신호 우선순위: `(1) .harness-sf/state/<slug>*.json` 존재하면 그것만 source. `(2)` 부재 시에만 design.md scan 을 bootstrap 용으로 허용. |
| `templates/hooks/statusline.js:85-93` | design.md `[status]` regex fallback 제거. dispatch-state 부재 시 `phase:plan` 토큰으로만 표현. |
| 5개 artifact 스킬 (`sf-apex/sf-lwc/sf-aura/sf-sobject/sf-field`) `SKILL.md` | delegated mode 완료 시점에 design.md 갱신 지시 있으면 제거. `dispatch-state-cli.js done` 호출만 유지. |

### 비호환 처리

- 기존 in-flight feature (status 거울이 살아있는 design.md) 는 다음 revision bump 시 자연 정리 — 마이그레이션 스크립트 불필요.
- `[status: ...]` 태그가 남아있어도 무해 (단순 텍스트로 취급됨).

## Tests

- `templates/hooks/_lib/__tests__/check-feature-context.test.js` 신규/확장:
  - state.json 존재 + design.md `[status: pending]` stale → canonical 우선 검증.
  - state.json 부재 + design.md only → bootstrap fallback 동작 검증.
- `templates/hooks/_lib/__tests__/statusline.test.js` (없으면 신규):
  - dispatch-state 만으로 `dispatch:N/M`, `phase:build` 정상 출력.
  - design.md `[status]` 가 stale 해도 statusline 결과 불변.
- 회귀: 5개 artifact 를 dispatch 하면서 design.md 를 한 번도 수정하지 않아도 statusline / resume / deploy loop 모두 정상 동작.

## Done when

- `[status: ...]` 거울에 의존하는 코드 경로가 없다 (grep 으로 확인).
- 새 design.md 템플릿에 runtime status 가 등장하지 않는다.
- dispatch-state 만 보고도 phase / 진행률 / 실패 카운트가 모두 결정된다.

## Risks

- **call site 누락**: 5개 artifact 스킬 어딘가에 design.md 갱신 지시가 남아있으면 silent drift 재발. → grep `status.*pending.*done` 로 전체 스캔 + CI lint 추가.
- **bootstrap fallback 오용**: `parsePendingArtifacts` 의 fallback 이 운영 경로에서 호출되면 거울 의존이 다시 자란다. → fallback 진입 시 `console.warn("bootstrap fallback — state.json absent")` 남기고, 테스트로 운영 경로에서 호출 안 됨을 보장.

## Out of scope

- gate sentinel / approval cache 통합 (이미 별개 신뢰 모델, 각자 단일 writer — drift 아님).
- statusline 표시 강화 (P1 에서 처리).
- resume UX (P3 에서 처리).
