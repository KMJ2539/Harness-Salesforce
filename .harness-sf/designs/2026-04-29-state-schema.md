---
type: feature
name: state-schema
date: 2026-04-29
author: mjkang2539
status: draft-v1
revision: 1
---

# state.json 정규 스키마 (v1 freeze)

## Why

5개 v3 설계 문서가 각자 `state.json` 에 필드를 추가하는 동안 codex 3차 리뷰가 schema 불일치 6건 발견:

- `current_step` 타입 (정수 vs dotted string)
- artifact discriminator (`kind` vs `type`)
- override 필드 이름 3개 (`override_history` / `override_used` / `override_active_session`)
- `review_resolution` 중복 (design.md + state.json)
- fingerprint migration 이 존재하지 않는 `design.approved_*` 참조
- `entered_via` enum 표기 (`"sf-feature-fast"` vs `"[fast]"`)

본 문서는 이 6건을 1회 freeze + 5개 v3 문서가 참조할 정규 스키마 정의. 모든 후속 PR 은 이 스키마에 따라야 함.

## Scope

- **In**: `.harness-sf/state/<slug>__r<revision>.json` 의 모든 필드, JSON Schema 형식, 마이그레이션 규칙.
- **In**: `.harness-sf/state/global.json` (성능/캐시 한정).
- **Out**: design.md frontmatter 스키마 (현 v1/v2 그대로).
- **Out**: sentinel payload 스키마 (state-consolidation v3 가 정의, 본 문서는 참조만).
- **Out**: audit.log 라인 형식 (gate-hardening v3 가 정의).

## Canonical schema (per-feature state)

파일 경로: `.harness-sf/state/<slug>__r<design_revision>.json`

design revision bump 시 새 파일 생성 (codex (b2) 해결). 이전 revision 파일은 retro 용으로 1주 보존 후 doctor 가 청소.

```json
{
  "schema_version": 1,

  "version": 7,
  "slug": "order-module",
  "design_path": ".harness-sf/designs/2026-04-29-order-module.md",
  "design_revision": 1,
  "design_body_hash": "sha256:abc...",

  "lock": {
    "pid": 12345,
    "host": "MZC01-MATTHEW",
    "started_at": "2026-04-29T10:00:00Z",
    "operation": "dispatch:start"
  },

  "current_step": "7.deploy-validate",
  "entered_via": "full",

  "artifacts": [
    {
      "id": "A1",
      "type": "sobject",
      "status": "done",
      "completed_at": "2026-04-29T10:30:00Z",
      "depends_on": []
    },
    {
      "id": "A2",
      "type": "apex",
      "status": "pending",
      "depends_on": ["A1"]
    }
  ],

  "deploy": {
    "last_validation": {
      "fingerprint": { "mode": "tree-hash", "value": "sha256:def..." },
      "result": "pass",
      "at": "2026-04-29T11:00:00Z"
    },
    "findings": []
  },

  "loop": {
    "iteration": 0,
    "last_error_class": null
  },

  "override_active_session": null,
  "override_history": [
    {
      "at": "2026-04-29T11:30:00Z",
      "scope": "deploy",
      "reason": "hotfix prod down ...",
      "session_id": "abc123"
    }
  ]
}
```

### Field freeze table

| field | type | constraint | 결정 근거 |
|-------|------|------------|-----------|
| `schema_version` | integer | 1 (현재) | 향후 마이그레이션 키 |
| `version` | integer | ≥ 1, monotonic +1 | CAS 키 |
| `slug` | string | `^[a-z0-9-]+$` | filename 일관성 |
| `design_path` | string | repo-relative POSIX path | platform 중립 |
| `design_revision` | integer | ≥ 1 | branch/revision bleed 방지 (codex b2) |
| `design_body_hash` | string | `sha256:[0-9a-f]{64}` | sentinel HMAC payload |
| `lock` | object \| null | 필드: pid/host/started_at/operation | 진행 중 표시 |
| `current_step` | string | `^\d+(\.[a-z-]+)?$` | dotted notation 통일 (codex c1). 정수 step 도 string (`"5"`) |
| `entered_via` | string | enum: `fast`/`standard`/`full`/`direct` | prefix 제거 (codex c6) |
| `artifacts[].id` | string | `^[A-Za-z0-9_-]+$` | 자유롭되 ASCII |
| `artifacts[].type` | string | enum: `sobject`/`field`/`apex`/`lwc`/`aura`/`permission-set`/`flow` | discriminator 통일 (codex c2). `kind` 표기 모두 폐기 |
| `artifacts[].status` | string | enum: `pending`/`in_progress`/`done`/`skipped`/`failed` | dispatch lifecycle |
| `artifacts[].completed_at` | string \| null | ISO-8601 | done 시 필수 |
| `artifacts[].depends_on` | string[] | 다른 artifact id 참조 | DAG |
| `deploy.last_validation` | object \| null | fingerprint/result/at | fingerprint 마이그레이션 단일 reset 대상 (codex c5) |
| `deploy.findings` | object[] | classify 결과 | gate-hardening 의존 |
| `loop.iteration` | integer | ≥ 0, ≤ 4 (cap) | validate-loop |
| `loop.last_error_class` | string \| null | enum: mechanical/logical/null | classify-deploy-error |
| `override_active_session` | string \| null | session_id | 1회성 강제 singleton (codex c3) |
| `override_history` | object[] | append-only | retro |

**제거된 필드** (codex 발견 반영):
- `review_resolution` — design.md 의 `## Review Resolution` 섹션이 single source (codex b1).
- `override_used` — `override_active_session !== null` 로 표현 (codex c3).
- `design.approved_at` / `design.approved_*` — 사용처 부재. design 승인 정보는 sentinel 에 있음 (codex c5).

## Canonical schema (global)

파일 경로: `.harness-sf/state/global.json` (gitignore)

성능/캐시 한정. 정책은 PROJECT.md.

```json
{
  "schema_version": 1,

  "fingerprint_cache": {
    "value": "sha256:...",
    "computed_at": "...",
    "mode": "tree-hash",
    "input_summary": [
      { "path": "force-app/main/default/classes/Foo.cls", "mtime": "...", "size": 1234 }
    ]
  }
}
```

PROJECT.md 의 `fingerprint.mode` 와 global.json 의 `fingerprint_cache.mode` 가 다르면 캐시 무효 + 재계산.

## PROJECT.md 보강 필드 (참조용)

PROJECT.md 는 본 문서 scope 밖이지만 fingerprint v3 가 의존하므로 참조:

```yaml
fingerprint:
  mode: tree-hash       # git | tree-hash | timestamp
  scope:
    - force-app/
    - .harness-sf/PROJECT.md
  exclude:
    - "**/node_modules/**"
    - "**/.sfdx/**"

logging:
  entry_pattern:
    - "Logger.log("
  scan_lines: 10

routing:
  fast_keywords: ["필드 1개", "메서드 추가"]
  full_keywords: ["마이그레이션", "OWD"]
```

## 마이그레이션 정책

- **schema_version 1 → 2** (미래): `migrations/state-v1-to-v2.js` 신설, doctor 가 자동 실행 옵션 제공.
- **legacy `.harness-sf/.cache/*`** → state.json: `hsf state migrate-from-v1 <slug>` 명령. v3 의 PR B (dual-mode) 에서 사용.
- **revision bump**: 새 파일 생성. 이전 파일은 1주 후 doctor 정리.
- **branch 전환**: state/ 가 gitignore 라 worktree 내에서 자동 분리. 명시 처리 불필요.

## State 변경 책임 매트릭스

| 필드 | 변경 트리거 | 명령 |
|------|-------------|------|
| `current_step` | 모든 step transition | `hsf state set current_step <new>` (transition guard) |
| `artifacts[].status` | dispatch 진행 | `hsf state set artifacts.<id>.status <new>` |
| `deploy.last_validation` | deploy validate 완료 | `hsf state set deploy.last_validation <obj>` |
| `loop.iteration` | validate-loop 진행 | `hsf state set loop.iteration <n>` |
| `lock` | CLI 명령 진입/종료 | 자동 (모든 hsf state 명령) |
| `override_active_session` | 우회 시작 | hook 자동 (gate-hardening) |
| `override_history` | 우회 발동 | hook append (gate-hardening) |
| `version` | 매 write | 자동 +1 (CAS) |
| `design_body_hash` | sentinel 발급 시점 캡처 | `hsf design approve` |

직접 JSON 편집 금지 (lock/CAS 우회). 비상시 `hsf doctor --repair`.

## v3 5문서가 반영해야 할 정정

| 문서 | 정정 항목 |
|------|----------|
| state-consolidation v3 | `state.json` 예시에서 `kind` → `type`, `review_resolution` 블록 제거, `override_used` 제거, current_step `"7.deploy-validate"` 통일, file path 에 `__r<revision>` suffix 추가 |
| step-consolidation v3 | current_step 예시 string 표기 확인 (이미 dotted) |
| fast-path-routing v3 | `entered_via: "sf-feature-fast"` → `"fast"`, statusline 표기와 통일 |
| non-git-fingerprint v3 | `design.approved_*` reset 표현 → `deploy.last_validation` reset 으로 정정. fingerprint config 위치는 PROJECT.md (codex b3 Resolution) |
| gate-hardening v3 | override 필드 명세를 `override_active_session` + `override_history` 2개로 통일 (Resolution 에 이미 반영, 본문 점검 필요) |

각 정정은 별도 patch PR 1개로 묶어 일괄 적용 (PR schema-1).

## Rollout

- **PR schema-1**: 본 문서 머지 + 5개 v3 문서의 정정 항목을 일괄 patch.
- 후속 모든 PR (state-consolidation v3 의 PR A 부터) 은 본 문서 frozen schema 위에서 진행.

## Risk

- **Schema 변경 압력**: 향후 새 기능이 state field 추가 요구 시 schema_version bump 필요. 가벼운 추가는 schema_version 유지 + 필수 여부만 옵셔널로. Breaking change 만 bump.
- **5문서 정정 누락**: PR schema-1 에서 한 곳이라도 빠지면 코드 작성 시 충돌 재발. → checklist 형식으로 PR 설명에 포함.
- **JSON Schema validator 의존성**: zero-dep 유지 위해 손으로 쓴 mini-validator 1개 (`templates/hooks/_lib/state/validator.js`). state-consolidation v3 의 PR A 산출물.

## Test plan

- 단위:
  - 모든 enum 값 통과 / 잘못된 값 거부.
  - `current_step` regex 통과 (`"5"`, `"7.deploy-validate"`) / 거부 (`"foo"`, `5` 정수).
  - `artifacts[].depends_on` 미존재 id 거부.
  - `version` monotonic 증가 검증.
- 통합:
  - 5문서가 정의하는 모든 필드가 schema 와 1:1 매칭.
  - 마이그레이션: legacy `.cache/dispatch-state/<slug>.json` → 새 `state/<slug>__r1.json`.

## Reviews

(미작성 — schema freeze 자체에 대한 codex 추가 리뷰는 사용자 판단.)

## Resolution

(미작성.)
