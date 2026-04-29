---
type: feature
name: state-consolidation
date: 2026-04-29
author: mjkang2539
status: draft-v2
revision: 2
---

# 상태 단일화 + CLI 응집 (`design.md frontmatter as SoT` + `harness-sf-cli`)

## Why (background / problem)

현재 하나의 feature 작업이 진행되는 동안 상태가 6곳에 분산된다:

1. `.harness-sf/designs/<slug>.md` — frontmatter `revision`, `## Reviews`, `## Review Resolution`, `## Dispatch Log`, `## Artifacts status`
2. `.harness-sf/.cache/design-approvals/<slug>.json` — design 승인 sentinel
3. `.harness-sf/.cache/dispatch-state/<slug>.json` — artifact 진행률
4. `.harness-sf/.cache/validate-loop/<slug>.json` — deploy validate 재시도 상태
5. `.harness-sf/.cache/deploy-findings/<slug>.json` + `deploy-classify/` — finding 분류
6. `.harness-sf/.cache/modify-approvals/`, `delegated-mode/` — per-artifact 토큰

문제:
- **갈라짐**: 사용자가 design.md를 수동 편집하면(스킬이 빈번히 권함) 캐시와 어긋나 흐름 정지. 복구는 캐시 수동 삭제뿐.
- **불투명**: 사용자가 "지금 어디까지 됐지?"를 알려면 6개 파일을 봐야 함. statusline.js가 일부 보여주지만 dispatch-state만 본다.
- **테스트 불가**: 통합 상태 스냅샷이 없어 회귀 테스트가 어려움.

동시에 `templates/hooks/_lib/` 아래에 단발 CLI 스크립트가 15개 (`validate-design.js`, `issue-design-approval.js`, `score-cli.js`, `dispatch-state-cli.js`, `validate-loop-state.js`, `verify-fix-against-design.js`, `classify-deploy-error.js`, `check-feature-context.js`, `check-delegated-token.js`, `issue-delegated-token.js`, `issue-modify-approval.js`, `issue-library-approval.js`, …). 스킬 본문은 이걸 매번 `node templates/hooks/_lib/<name>.js arg arg` 식으로 호출 — 스킬이 길어지는 주된 원인이고, 신규 스크립트 추가 시 진입점이 더 분산된다.

두 문제는 같은 뿌리: **상태 모델이 게이트 단위로 쪼개져 있고, 그 게이트마다 별도 CLI가 붙어 있다**. 한 번에 묶어 해결.

## Non-goals

- 게이트 자체의 의미 변경 (modify-approval, design-approval, deploy-gate의 보안 모델은 그대로).
- sentinel HMAC 제거. 위변조 방지는 유지.
- `.harness-sf/.cache/` 완전 제거. 락/임시 파일 용도는 남긴다.
- 기존 design.md 마이그레이션 자동화. v1 도입 후 신규 feature부터 적용, 기존 in-flight는 legacy 모드로 흐름 종료.

## Design

### 두 축으로 분리

**Axis A — `design.md frontmatter` 를 single source of truth 로 승격**
**Axis B — `harness-sf-cli` 단일 진입점으로 _lib 스크립트 통합**

두 축은 독립적으로 의미 있지만, 같은 PR로 묶는 편이 자연스럽다 (CLI 단일화 시 state I/O가 한 모듈로 모이기 때문).

---

### Axis A — frontmatter as SoT

design.md frontmatter에 `state:` 블록을 추가:

```yaml
---
type: feature
name: order-module
date: 2026-04-29
author: mjkang2539
status: in-flight
revision: 3
state:
  body_hash: sha256:abc123...      # design body 해시 (Reviews/Resolution/State 제외)
  design:
    approved_at: 2026-04-29T10:00:00Z
    approved_body_hash: sha256:abc123...
  artifacts:
    A1:
      kind: sobject
      status: done
      completed_at: 2026-04-29T10:30:00Z
      modify_approved_at: 2026-04-29T10:25:00Z
    A2:
      kind: apex
      status: pending
      depends_on: [A1]
  review_resolution:
    H1: { decision: 1, rationale: "scope 외 — v2로 이월" }
    M1: { decision: 2, rationale: "design.md §3에 반영" }
  deploy:
    last_validation:
      sha: sha256:def456...        # repo fingerprint at validation
      result: pass
      at: 2026-04-29T11:00:00Z
    findings: []
  loop:
    iteration: 0
    last_error_class: null
---
```

규칙:
- **단일 권위**: 게이트는 frontmatter만 읽고 쓴다. `.harness-sf/.cache/`는 lock 파일(`<slug>.lock`)과 진행 중 PID만 남긴다.
- **검증**: `validate-design.js` 가 `state:` 스키마(JSON Schema)도 검증. 사람이 frontmatter를 잘못 손대면 게이트가 명시적 에러로 거부 — silent corruption 없음.
- **HMAC**: sentinel은 `state.design.approved_body_hash` 한 필드를 HMAC payload로 사용. 사용자가 design body를 수정하면 hash 불일치 → 자동으로 재승인 요구.
- **동시성**: dispatch는 현재도 직렬이므로 frontmatter write 경합은 발생하지 않음. lock 파일로 한 번 더 가드.

마이그레이션:
- v1 도입 시 신규 feature부터 적용.
- 기존 in-flight feature는 `legacy_state: true` 마커로 표시, 종료까지 구 캐시 경로 유지.
- 1버전 후 legacy 코드 제거.

---

### Axis B — `harness-sf-cli` 단일 진입점

현재 15개 스크립트를 subcommand로 통합:

```bash
node templates/hooks/_lib/cli.js design validate <path>
node templates/hooks/_lib/cli.js design approve <path>
node templates/hooks/_lib/cli.js dispatch state <slug>
node templates/hooks/_lib/cli.js dispatch advance <slug> <artifact-id>
node templates/hooks/_lib/cli.js modify issue <path>
node templates/hooks/_lib/cli.js modify check <path>
node templates/hooks/_lib/cli.js delegated issue <slug> <artifact-id>
node templates/hooks/_lib/cli.js delegated check <slug> <artifact-id>
node templates/hooks/_lib/cli.js deploy classify <error>
node templates/hooks/_lib/cli.js deploy verify-fix <slug>
node templates/hooks/_lib/cli.js loop state <slug>
node templates/hooks/_lib/cli.js score <design-path>
node templates/hooks/_lib/cli.js context <slug>
```

내부 구조:
```
templates/hooks/_lib/
  cli.js                    # 진입점, subcommand 라우팅
  commands/
    design.js
    dispatch.js
    modify.js
    delegated.js
    deploy.js
    loop.js
    score.js
    context.js
  state/
    frontmatter.js          # design.md frontmatter read/write/validate
    fingerprint.js          # repo fingerprint (git → tree-hash 폴백)
    sentinel.js             # HMAC (기존 sentinel.js 이동)
  schema/
    state.schema.json       # frontmatter state: 블록 JSON Schema
```

스킬 본문은 짧아진다:
```
# Before
node templates/hooks/_lib/issue-design-approval.js .harness-sf/designs/foo.md
node templates/hooks/_lib/dispatch-state-cli.js init foo A1,A2,A3
node templates/hooks/_lib/check-delegated-token.js foo A1

# After
hsf design approve <path>
hsf dispatch init <slug> A1,A2,A3
hsf delegated check <slug> A1
```

`hsf` 는 `templates/_stubs/` 의 thin shim (Windows .cmd + bash) 이거나, `node _lib/cli.js` 를 그대로 두고 SKILL.md 에 alias 변수만 도입.

기존 단발 스크립트 파일은 v1에서 **얇은 forward shim** 으로 남긴다 (`issue-design-approval.js` → `cli.js design approve`). 1버전 후 제거.

---

### 영향 범위

수정 대상:
- `templates/hooks/_lib/*` — 통합 (가장 큼).
- `templates/hooks/*.js` — 게이트들이 frontmatter 읽도록 수정. 캐시 경로 의존 코드 제거.
- `templates/skills/*/SKILL.md` — _lib 호출 라인 교체. 절차는 변경 없음.
- `templates/hooks/statusline.js` — frontmatter `state.artifacts`/`state.deploy` 를 진행도 소스로 변경.
- `templates/hooks/README.md` — sentinel/state 매핑 갱신.

영향 없음:
- `bin/install.js` (zero-dep 유지).
- `harness/` 패키지.
- 사용자 설정 (`PROJECT.md`, `local.md`).

## Revision 2 deltas

리뷰 Resolution 결과 본문에 반영된 변경:

- **body_hash 정의**: "frontmatter 의 `state:` 블록 + `## Reviews` + `## Resolution` 섹션을 제외한 본문" 의 sha256. validate-design / sentinel 검증이 동일 함수 (`state/body-hash.js`) 사용.
- **frontmatter 제약**: zero-dep 유지 위해 JSON-compatible subset 만 허용 — multi-line string 금지, anchor/alias 금지, 복잡 구조는 single-line JSON 표기. 50줄 mini-validator 로 검증.
- **동시성 가드**: 파일 락 폐기, frontmatter `state.lock: { pid, started_at, host }` 협력적 처리. stale 감지: `started_at` + 30분 TTL + `process.kill(pid, 0)`.
- **deprecation 정책**: 다음 minor 에서 warning, 그 다음 minor 에서 제거. CHANGELOG `### Deprecated` / `### Removed` 의무. doctor 가 deprecated 사용 감지.
- **CLI 진입점**: `hsf` shim 폐기. SKILL.md 본문에 `${HSF_CLI}` 변수 정의 ("node templates/hooks/_lib/cli.js") + 한 곳에서 일괄 사용.
- **PR 1 후 frontmatter 비대 실측**: in-flight feature 1개 측정. 임계 80줄 초과 시 `state.deploy.findings` 만 외부 파일 reference 옵션.

## Risk

- **Frontmatter 비대화**: state 블록이 ~30~50줄 추가. design body 가독성에 영향. → `state:` 를 frontmatter 마지막 블록으로 두고, 스킬이 보여줄 때 접어서 표시.
- **사용자 수동 편집 회귀**: state를 수동 수정 → HMAC 불일치 → 게이트 거부. 사용자 입장에선 "왜 막혔지?" 혼란. → 게이트 거부 메시지에 "frontmatter state.design.approved_body_hash 가 본문 해시와 불일치. 재승인 필요" 같은 자가 진단 명시.
- **CLI 전환 비용**: 단발 스크립트 → subcommand 마이그레이션 중 SKILL.md 호출 라인 다수 수정. 회귀 위험. → forward shim 1버전 유지 + 통합 테스트(시나리오: feature 1개 풀 사이클) 추가.
- **JSON Schema 의존**: zero-dep 원칙 — `templates/`는 의존성 없어야 함. ajv 같은 라이브러리 못 씀. → 손으로 쓴 50줄짜리 mini validator 로 충분 (state 스키마는 단순).

## Test plan

- 단위:
  - `state/frontmatter.js` — read/write/validate, hash 일치/불일치, 손상된 YAML.
  - `state/fingerprint.js` — git 환경 / non-git 환경.
  - 각 subcommand — 정상/오류 경로.
- 통합:
  - 신규 feature 풀 사이클 (intent → design → review → approve → dispatch 3 artifacts → deploy validate → done) — frontmatter 의 state 가 단계마다 정확히 갱신되는지.
  - design.md 본문 수정 후 게이트 거부 → 재승인 → 진행.
  - dispatch 도중 세션 종료 → 새 세션에서 statusline 이 정확한 상태 복원.
- 마이그레이션:
  - legacy_state: true 인 in-flight feature 가 구 캐시로 정상 종료.
  - 신규 feature 와 legacy feature 동시 존재 시 충돌 없음.

## Rollout

1. PR 1 — `cli.js` + `commands/*` 골격, 단발 스크립트는 forward shim.
2. PR 2 — `state/frontmatter.js` + JSON Schema, `validate-design.js` 확장.
3. PR 3 — 게이트들이 frontmatter 읽도록 전환, 캐시 경로 deprecated.
4. PR 4 — SKILL.md 호출 라인 일괄 교체 + statusline.js 전환.
5. PR 5 — forward shim 제거 (다음 minor).

## Reviews

### Infra self-review (2026-04-29)

Reviewer: claude-opus-4-7 (self-review)
Scope: zero-dep / installer / hook compat / migration / schema

#### H (block until resolved)

- **H1. body_hash 자기참조 모순.**
  Why: `state.body_hash` 는 design body 해시지만 frontmatter 자체에 들어감 → hash 계산 시 어느 영역 제외인지 모호.
  Suggest: "body = frontmatter `state:` 블록 제외 + `## Reviews` 제외 본문" 으로 명시. validate-design 가 같은 알고리즘 사용.

- **H2. zero-dep 원칙 위반 우려.**
  Why: state schema 검증 위해 JSON Schema 도입. `templates/`는 dep-free 유지가 invariant. 손으로 쓴 50줄 mini-validator 라 했지만, frontmatter 에 이미 YAML 파서 필요 → js-yaml 의존 발생.
  Suggest: PROJECT.md 가 YAML 인데 현재 어떻게 파싱 중인지 먼저 조사. 이미 의존성이 있다면 명시하고 재사용. 없다면 frontmatter 도 정규식 + `JSON.parse` 가능한 sub-set 으로 제한 (multi-line string 금지).

#### M (address before merge)

- **M1. 동시성 가드의 OS 호환성.**
  Why: `<slug>.lock` 파일 락 — Windows 는 advisory lock 없음, mandatory lock 은 다름. cross-platform 동작 보장 부재.
  Suggest: `proper-lockfile` 같은 검증된 패턴을 zero-dep 으로 재구현 (PID + mtime check + stale detection). 또는 lock 대신 frontmatter 의 `state.in_flight_pid` 필드로 협력적 처리.

- **M2. forward shim 1버전 정책 미정의.**
  Why: "1버전 후 제거" — semver minor? major? `bin/install.js` 의 버전 정책 명시 없음.
  Suggest: deprecation 주기를 "다음 minor 에서 warning, 그 다음 minor 에서 제거" 로 고정. CHANGELOG 에 deprecation 항목 의무화.

- **M3. frontmatter 비대화의 실측 부재.**
  Why: "30~50줄 추가" 추정. 5 artifact + reviews + deploy findings 누적 시 100줄 넘을 수 있음. body 보다 길어지면 design.md 가독성 역전.
  Suggest: PR 1 직후 in-flight feature 1개 골라 실측. 임계 (e.g. 80줄) 초과 시 deploy.findings 만 외부 파일로 이동 옵션.

#### L (note)

- **L1. CHANGELOG 자동 갱신 누락.**
  installer 가 manifest 갱신은 하지만 CHANGELOG 는 사람 손. state schema 변경 시 사용자 마이그레이션 안내 누락 위험.

- **L2. `harness-sf-cli` shim 이름 충돌.**
  `hsf` 가 다른 도구 이름과 겹칠 수 있음 (확인 필요). `npx harness-sf <cmd>` 로 통일하면 충돌 제거 + 일관성.

#### Strengths

- 단일 진실원으로 감사 추적이 단순해짐 — design.md 1개로 retro 가능.
- sentinel HMAC payload 를 body_hash 한 필드로 단순화 — 검증 코드 축소.
- forward shim 으로 점진 마이그레이션 — 1번에 다 깨지 않음.

### External review (codex, 2026-04-29)

8 H-class 추가 발견. 자가리뷰 reject 0개를 정당화하지 못하는 강도.

- **codex-H1. partial write/손상 시 복구 경로 없음.** state.lock 만 있고 atomic write 부재. 현 구현 `fs.writeFileSync()` (`templates/hooks/_lib/dispatch-state.js:61-64`, `templates/hooks/_lib/sentinel.js:58-66`). SoT 가 design.md 면 truncate 한 번에 사람이 쓴 본문도 같이 사라짐.
- **codex-H2. state.lock 은 락이 아니라 race condition.** 같은 파일 안의 lock 은 read-then-write 사이에 두 writer 가 동시에 "lock 없음" 보고 둘 다 쓸 수 있음. OOB atomic lock 또는 versioned CAS 가 필요.
- **codex-H3. JSON-compatible subset + 50줄 validator 자기모순.** 예시가 YAML flow syntax (`depends_on: [A1]`, `H1: {decision: 1, rationale: "..."}`) — JSON 아님. 필요한 것은 parser + stable serializer + round-trip 보존.
- **codex-H4. git 운영 충돌 미고려.** volatile state 가 frontmatter 최상단 → 커밋: PR diff 가 state 쓰레기로 오염. 미커밋: 상시 dirty worktree 로 branch 전환/merge 깨짐. `.harness-sf/designs/` 는 `CLAUDE.md:18` 에서 "설계 자산" 명시.
- **codex-H5. rollout 순서 오류.** PR3 gates 전환 / PR4 statusline — 그 사이 한 릴리스는 거짓 진행상태 표시 (`templates/hooks/statusline.js:62-88`).
- **codex-H6. schema 너무 일찍 frozen.** step-consolidation 의 `state.current_step`, fast-path 의 `state.entered_via`, fingerprint 의 deploy 의미 변경, gate-hardening 의 audit verify — 모두 schema 추가 요구. PR2 schema fix 순서 반대.
- **codex-H7. SoT 명명이 부정확.** sentinel HMAC + PROJECT.md (fingerprint mode) + audit.log (override) 는 별도. 실제로는 "frontmatter + sentinel + project config + audit consensus protocol".
- **codex-H8. design approval scope 약점 미해결.** `templates/hooks/pre-create-design-link-gate.js:40-52` 는 "아무 fresh sentinel 하나" 면 새 파일 허용. design A 승인이 design B 생성도 열어줌.

**판단**: 자가 리뷰 결정사항(D1~D7) 은 모두 surface-level. revision 3 에서 **SoT 컨셉 포기 + 방향 전환** 필요.

### Resolution

Decision codes: [1] accept / [2] modified accept / [3] defer / [4] reject.

**revision 3 으로 방향 전환 결정** — 자가리뷰 D1~D7 은 surface 수정으로 유효하나, codex H1~H8 은 architecture-level. revision 3 에서 통합 흡수.

#### H

- **H1 → [1] accept.** body_hash 정의를 명시: "frontmatter 의 `state:` 블록 + `## Reviews` 섹션 + `## Resolution` 섹션을 제외한 모든 내용의 sha256". `validate-design.js` 와 sentinel 검증이 같은 함수 사용 (`state/body-hash.js`).
- **H2 → [2] modified accept.** zero-dep 유지가 최우선. 조사 결과 현재 frontmatter 파싱은 정규식 + 라인 split 으로 처리 중 (별도 파서 없음). 신규 의존성 도입 대신 frontmatter 를 **JSON-compatible subset 으로 제한** — multi-line string 금지, anchor/alias 금지, 복잡한 구조는 single-line JSON 표기 (`artifacts: {A1: {status: done}}`). mini-validator 50줄로 충분.

#### M

- **M1 → [2] modified accept.** OS 호환성 우려 수용. 파일 락 대신 **frontmatter 의 `state.lock`** 필드로 협력적 처리: `{pid, started_at, host}`. stale 감지는 `started_at` + 30분 TTL. PID 살아있는지 확인은 cross-platform 가능 (`process.kill(pid, 0)`).
- **M2 → [1] accept.** deprecation 정책: "다음 minor 에서 deprecation warning, 그 다음 minor 에서 제거". CHANGELOG `### Deprecated` / `### Removed` 섹션 의무. `bin/install.js` 의 doctor 가 deprecated 사용 감지 시 경고.
- **M3 → [1] accept.** PR 1 머지 후 in-flight feature 1개 측정. 임계 80줄 초과 시 `state.deploy.findings` 만 `.harness-sf/.cache/findings/<slug>.json` 로 외부화 옵션 추가 (frontmatter 에는 reference 만).

#### L

- **L1 → [1] accept.** state schema 변경 시 `bin/install.js` update flow 가 사용자에게 마이그레이션 안내 (이미 update flow 디자인됨, 통합).
- **L2 → [2] modified accept.** `hsf` shim 폐기. 모든 호출은 `node templates/hooks/_lib/cli.js <cmd>` 또는 SKILL.md 본문에 `${HSF_CLI}` 변수 도입 후 한 곳에서 정의. shim 충돌 회피 + zero-dep.

#### Updated design changes (revision: 2 에 반영)

1. body_hash 정의 본문 추가 (Axis A 첫 단락 직후).
2. frontmatter 를 JSON-compatible subset 으로 제한, mini-validator 명세 추가.
3. `state.lock` 필드 스키마 추가, `.harness-sf/.cache/<slug>.lock` 폐기.
4. deprecation 정책 한 단락 신설 (Rollout 섹션 끝).
5. `hsf` shim 언급 제거, `${HSF_CLI}` 변수 명세로 대체.
