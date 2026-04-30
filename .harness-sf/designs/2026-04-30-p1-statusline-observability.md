---
type: feature
name: p1-statusline-observability
date: 2026-04-30
author: mjkang2539
status: draft
revision: 1
depends_on: 2026-04-30-p0-state-singularity.md
---

# P1 — statusline 관측성 강화 (phase / current / approval TTL)

## Why

현재 statusline 은 `🔧 sf-harness · org:X · design:Y · dispatch:3/5 · step:Z · val:43m` 정도로, "지금 무엇을 하는 중이고, 무엇이 막혀있고, 다음에 무엇을 할 차례인지" 를 한 줄로 알기 어렵다.

codex 리뷰의 정확한 지적: 단계 수 자체가 문제가 아니라 **상태 관측성** 이 부족하다. 사용자는 매번 `dispatch-state-cli.js status <slug>` 를 따로 호출해서 짜맞춰야 한다.

P0 가 끝나면 dispatch-state 가 단일 control source 가 되므로, statusline 이 그 위에서 phase 를 정직하게 표시할 수 있다.

## What

statusline 한 줄로 이 다섯 질문의 답을 본다:

1. 어떤 design 을 작업 중인가? — 기존 `design:<slug>`
2. 어느 phase 인가? — **신규** `phase:plan|build|validate`
3. 지금 어떤 artifact 가 진행 중인가? — **신규** `current:<artifact-id>`
4. 몇 개 실패했나? — **신규** `failed:N` (failed > 0 일 때만)
5. 승인 sentinel 이 곧 만료되나? — **신규** `approval:<TTL>` (TTL < 60m 일 때만)

목표 출력 (예):
```
🔧 sf-harness · org:dev · design:order · phase:build · current:order-handler · dispatch:2/5 · failed:1 · approval:23m · val:1h
```

## How (변경 파일)

| 파일 | 변경 |
|---|---|
| `templates/hooks/statusline.js` | phase 판단 로직 추가: design.md 존재 + dispatch-state 부재 → `plan` / dispatch-state 존재 + 미완 artifact 있음 → `build` / 모든 artifact done → `validate`. |
| `templates/hooks/statusline.js` | `current` 토큰 추가: dispatch-state 의 `artifacts[]` 중 `status === 'in_progress'` 인 첫 항목의 `id`. 없으면 생략. |
| `templates/hooks/statusline.js` | `failed` 토큰 분리: 현재 `dispatch:3/5 ✗` 의 `✗` 를 `failed:N` 으로 명시화. `dispatch:` 토큰은 succeeded/total 만 표현. |
| `templates/hooks/statusline.js` | `approval` 토큰 추가: `.harness-sf/.cache/design-approvals/<slug>.json`, `modify-approvals/`, `library-approvals/` 의 만료 시각 중 가장 가까운 것. 60분 이상이면 표시 생략. |
| `templates/hooks/_lib/dispatch-state-cli.js` `status` 명령 | 단순 카운트 출력에서 phase / TTL / failed / current 흡수한 통합 view 로 확장. statusline 과 같은 계산 로직 공유. |
| `templates/hooks/_lib/state-summary.js` (신규) | statusline 과 dispatch-state-cli `status` 가 공유할 phase / current / approval-TTL 계산 helper 모듈. |

### phase 판정 규칙 (state-summary.js)

```
no design.md          → phase 표시 안 함 (idle)
design.md only        → plan
state.json + 미완 ≥1  → build
state.json + 모두 done + last-validation 없음 → validate
state.json + 모두 done + last-validation 있음 → done (또는 표시 생략)
```

### approval TTL 계산

각 sentinel 파일의 `expires_at` (ISO) 읽고 `Date.now()` 와 차이 계산. 음수면 만료 — `approval:expired` 로 표시 (게이트가 차단할 것이므로 사용자 인지 필요).

## Tests

- `templates/hooks/_lib/__tests__/state-summary.test.js` 신규:
  - 5가지 phase 분기 모두 검증 (no design / plan / build / validate / done).
  - approval TTL: 만료, < 60m, ≥ 60m 케이스.
- `statusline.test.js` 확장:
  - 통합 출력에서 토큰 순서 / 누락 조건 검증.

## Done when

- 한 줄 statusline 으로 phase, current artifact, failed count, approval TTL 을 모두 확인 가능.
- `dispatch-state-cli.js status <slug>` 가 statusline 과 동일한 정보를 멀티라인으로 풀어서 표시 (`hsf status` 신규 CLI 만들지 않음).
- statusline 계산 비용은 여전히 < 50ms (현재 수준 유지) — 캐시 파일 stat 만 추가, 무거운 IO 없음.

## Risks

- **표시 과밀**: 토큰 5개 추가로 한 줄이 너무 길어질 수 있음. → 60m 이상 approval 은 표시 생략, failed=0 일 때 토큰 자체 생략, current 는 build phase 일 때만 표시 — 조건부 토큰으로 평소엔 짧게 유지.
- **계산 분산**: statusline 과 cli 가 같은 로직을 두 번 구현하면 drift. → `state-summary.js` helper 강제 공유.

## Out of scope

- approval sentinel 자동 갱신 (사용자 명시 액션이 필요한 게 의도).
- last-validation 의 deploy 결과 status (별도 색상/아이콘) — 현재 `val:1h` 로 충분.
