---
type: feature
name: state-consolidation
date: 2026-04-29
author: mjkang2539
status: draft-v3
revision: 3
supersedes: 2026-04-29-state-consolidation.md
---

# 상태 응집 v3 — design.md 와 machine state 분리

## Why revision 3

revision 2 는 두 외부 리뷰 라운드에서 **방향 자체** 가 흔들림.

- 자가리뷰: surface deltas 7개 수용, reject 0.
- codex 1차 (state-consolidation 단독): H1~H8, 모두 architecture-level.
- codex 2차 (다른 4문서): 각 문서당 H 2개 + M 2개 + Seq 1개. 실제 코드와 문서 가정의 광범위한 불일치.

핵심 발견 두 가지:

1. **frontmatter as SoT 는 git 운영과 양립 불가.** `.harness-sf/designs/` 는 `CLAUDE.md:18` 에서 "설계 자산" 으로 명시 — 커밋 대상. volatile state 를 그 frontmatter 최상단에 두면 (a) 커밋 → PR diff 가 state 쓰레기로 오염 (b) 미커밋 → 항상 dirty worktree → branch 전환/merge 깨짐. 어느 쪽도 청산되지 않음.
2. **"single source of truth" 자체가 잘못된 framing.** sentinel HMAC, fingerprint metadata, audit log, override scope 가 모두 별도 신뢰 모델. 합쳐도 SoT 가 아니라 **consensus protocol** 인데 v2 는 SoT 라는 거짓 약속을 함.

revision 3 는 SoT 를 **포기**하고, design.md 의 역할을 좁힌다.

## 새 분할

| 자산 | 역할 | mutability | 위치 |
|------|------|------------|------|
| `design.md` | **사람용 컨센서스 문서** — intent, decomposition, reviews, resolution | 승인 후 immutable (revision bump 시에만 변경) | `.harness-sf/designs/<slug>.md` (커밋) |
| `state.json` | **machine state** — current_step, artifacts progress, deploy validation, lock, override usage | 매 단계 mutate | `.harness-sf/state/<slug>.json` (gitignore) |
| sentinel | **무결성 토큰** — HMAC over (design body hash + state version + fingerprint mode) | 게이트 발급/검증 시점 | `.harness-sf/.cache/sentinels/<kind>/<key>.json` (gitignore) |
| audit log | **불가역 이벤트 로그** — override 사용, mode 전환, sentinel revoke | append-only with hash chain | `.harness-sf/audit.log` (gitignore) |
| fingerprint config | **프로젝트 동일성 모드** — git/tree-hash/timestamp | install 시 결정, doctor 로 마이그레이션 | `.harness-sf/state/global.json` (gitignore) |

규칙:
- design.md 는 **machine state 를 담지 않는다.** frontmatter 는 type/name/date/author/status/revision 만 (현재와 동일).
- design.md 는 **승인 후 immutable.** 변경하려면 revision bump → 재리뷰. body hash 가 sentinel payload 의 일부라 자동 강제.
- state.json 은 `.harness-sf/state/<slug>.json` 단일 파일. atomic write (temp+fsync+rename) + advisory file lock + version field (CAS).
- 6개 분산 cache (`design-approvals/`, `dispatch-state/`, `validate-loop/`, `deploy-findings/`, `deploy-classify/`, `modify-approvals/`, `delegated-mode/`) 는 모두 state.json 안의 sub-object 로 통합. sentinel 만 별도 (HMAC 키 분리 필요).

이렇게 하면:
- **codex-H1 (partial write)**: state.json atomic write 로 design 본문은 절대 안 건드림.
- **codex-H2 (race condition)**: state.json 단일 파일 advisory lock + version CAS.
- **codex-H3 (YAML round-trip)**: machine state 가 JSON 이라 round-trip 자명.
- **codex-H4 (git pollution)**: state.json 은 gitignore — design.md 는 안 변함.
- **codex-H7 (SoT misnomer)**: "consensus protocol — design.md (committed) + state.json (local) + sentinel (HMAC) + audit (append-only)" 로 정직하게 명명.

## 구조

### `.harness-sf/state/<slug>.json` 스키마 (JSON, 진짜 zero-dep)

```json
{
  "schema_version": 1,
  "version": 7,                          // CAS, 매 write 시 +1
  "slug": "order-module",
  "design_path": ".harness-sf/designs/2026-04-29-order-module.md",
  "design_body_hash": "sha256:...",      // 발급 당시 design.md 본문 해시
  "design_revision": 1,
  "lock": {                              // null 또는 객체
    "pid": 12345,
    "host": "MZC01-MATTHEW",
    "started_at": "2026-04-29T10:00:00Z",
    "operation": "dispatch:start"
  },
  "current_step": 5,                     // step-consolidation 의 transition 검증 키
  "entered_via": "sf-feature-full",      // fast-path-routing 의 분기 키
  "artifacts": [
    { "id": "A1", "kind": "sobject", "status": "done", "completed_at": "..." },
    { "id": "A2", "kind": "apex",    "status": "pending", "depends_on": ["A1"] }
  ],
  "review_resolution": {
    "H1": { "decision": 1, "rationale": "scope 외 — v2 이월" }
  },
  "deploy": {
    "last_validation": {
      "fingerprint": { "mode": "tree-hash", "value": "sha256:..." },
      "result": "pass",
      "at": "..."
    },
    "findings": []
  },
  "loop": { "iteration": 0, "last_error_class": null },
  "override_history": [
    { "at": "...", "scope": "deploy", "reason": "...", "session_id": "..." }
  ]
}
```

design.md frontmatter 는 v1/v2 와 같음:

```yaml
---
type: feature
name: order-module
date: 2026-04-29
author: mjkang2539
status: in-flight
revision: 1
---
```

(state 블록 없음 — 이게 핵심.)

### atomic write + lock 절차

```
write(state):
  1. lockfile = .harness-sf/state/<slug>.lock
  2. open(lockfile, O_CREAT|O_EXCL) — 실패 시 stale check (PID 죽었으면 강제 reclaim)
  3. read current state.json — version_old 확인
  4. if state.version !== version_old → CAS 충돌, retry from step 3
  5. write tmp = <slug>.json.tmp.<pid>
  6. fsync(tmp)
  7. rename(tmp → <slug>.json) — POSIX atomic
  8. release lockfile
```

Windows 호환:
- O_EXCL 은 NTFS 에서도 작동.
- rename 은 Windows 에서 destination 존재 시 fail — `fs.renameSync` 대신 `fs.copyFileSync(tmp, dest); fs.unlinkSync(tmp)` 또는 `fs.renameSync` 후 재시도. POSIX atomic 보장 못 하지만 단일 머신 단일 프로세스 dispatch 환경에서는 충분 (advisory lock 이 1차 가드).

### sentinel payload 변경

```
{
  "kind": "design-approval",
  "issued_at": "...",
  "design_path": ".harness-sf/designs/<slug>.md",
  "design_body_hash": "sha256:...",      // design.md 전체 본문 (state 블록 없음)
  "state_version": 7,                     // state.json 의 version 필드
  "fingerprint": { "mode": "tree-hash", "value": "sha256:..." },
  "hmac": "..."
}
```

게이트 검증:
1. design.md 의 현재 body hash 계산 → sentinel.design_body_hash 와 일치 확인.
2. state.json 의 version → sentinel.state_version 보다 크지 않음 확인 (state 가 sentinel 발급 후 mutate 됐는지).
3. fingerprint 일치 확인.
4. HMAC 검증.

이 4단계가 모두 통과해야 게이트 허용. 4개의 검증축이 합쳐져서 "consensus protocol" 의 실체.

### CLI 진입점 (`hsf` 또는 `node templates/hooks/_lib/cli.js`)

PR 1 에서 만든 라우터 (`templates/hooks/_lib/cli.js`) 그대로 활용. namespace 추가:

```
hsf state read <slug>            → JSON dump
hsf state set <slug> <key.path> <value>   → CAS write 1회
hsf state lock <slug> [op]       → lock 획득 (CLI 도구가 사람 호출 시)
hsf state unlock <slug>          → lock 해제
hsf state init <slug> <design-path> <artifacts-json>
hsf state migrate-from-v1 <slug> → v1 cache 모음 → state.json 마이그레이션 (1회성)

hsf doctor                       → fingerprint mode + state 무결성 점검
hsf doctor --repair <slug>       → 깨진 state.json 복구 (lock 강제 reclaim, schema 정상화)
hsf doctor --migrate-fingerprint-mode

hsf audit verify                 → hash chain 검증
hsf audit tail [n]               → 최근 n줄
```

### 다른 4문서의 영향 (revision 3 후속)

| 문서 | 변경 | 이유 |
|------|------|------|
| step-consolidation v3 | `state.current_step` 을 frontmatter → state.json 으로 이동. transition guard hook 신설 (`pre-step-transition.js`) — 신규 파일 작성 시점이 아닌, hsf state set 호출 시점에 검증 | codex H1 (집행 지점) + 본 문서의 분리 |
| fast-path-routing v3 | `state.entered_via` 도 state.json 으로. fast-path 도 design.md 작성하되 standard 와 동일한 `## Artifacts` 섹션 (artifact 1개) 작성 — codex H1 해결. fast-path delegation token 신설 (sub-skill 호출 시 `--delegated-mode=fast` 인자) → check-feature-context redirect loop 회피 (codex H2) | codex H1, H2 |
| non-git-fingerprint v3 | fingerprint config 를 PROJECT.md → `.harness-sf/state/global.json` 으로 이동 (codex H1 해결, installer 계약 안 깸). tree-hash scope 에 `.harness-sf/PROJECT.md` 포함 (codex H2). API 자기모순 해결 — caller 는 fingerprint() 호출, 비교는 sentinel 발급 시점 mode+value 매칭으로 (codex M1) | codex H1, H2, M1 |
| gate-hardening v3 | scoped override 에 `create:` 와 `library:` 추가 — 4축 → 6축 (codex H1). 1회성 강제는 state.json 의 `override_used: true` 플래그 + sentinel 발급 시 reset, 2번째 호출은 거부 (codex H2). diagnostics 는 단일 파일 `_lib/diagnostics.js` 에 객체 export 로 통합 (codex M1 — installer 1단계 제약 우회) | codex H1, H2, M1 |

이 4건은 후속 turn 에서 별도 revision 3 문서로 갱신.

## Rollout (재정렬, codex 권고 반영)

기존 5-PR 순서를 폐기. 새 순서:

1. **PR A — schema freeze + repair tooling (foundation)**
   - cross-doc 합의로 state.json schema 확정 (5문서가 추가하는 모든 필드 사전 인입).
   - `hsf state` namespace + `hsf doctor --repair` 구현.
   - schema_version 도입, future migration 여지 확보.
   - 기존 cache 미접촉 — 신규 코드만 추가.

2. **PR B — dual-read/dual-write (마이그레이션 안전망)**
   - 모든 게이트가 state.json 을 1순위로 읽되, 없으면 기존 cache fallback.
   - 모든 write 가 양쪽 동시 갱신.
   - `hsf state migrate-from-v1` 으로 in-flight feature 일괄 변환 가능.
   - 1버전 동안 dual mode 유지.

3. **PR C — 동시 cutover (gates + statusline + sentinel + fingerprint)**
   - codex H5 반영: gate / statusline / fingerprint API 를 같은 PR 에서 전환.
   - sentinel payload 새 스키마 (state_version + fingerprint) 강제.
   - 기존 cache fallback 코드는 deprecated 표시 (제거는 PR E).

4. **PR D — 사람용 인터페이스 (statusline 보강 + repair UX + audit verify)**
   - statusline 에 current_step, entered_via, override 사용 표시.
   - `hsf doctor --repair` 사용자 안내 메시지 정비.
   - audit hash chain verify 명령.

5. **PR E — legacy 제거**
   - dual-read/dual-write 제거.
   - 단발 _lib 스크립트 forward shim 제거.
   - SKIP_* 환경변수 제거 (gate-hardening 과 통합).

PR A 는 PR B 의 schema 가 있어야 하므로 사전에 5문서가 모두 revision 3 으로 진행되어야 함 — 현재 다른 4문서 revision 3 작성이 PR A 의 사전 작업.

## Risk

- **schema freeze 의 어려움**: 5문서가 각자 필드를 추가하는 와중에 한 번에 합의해야 함. 한 문서라도 미루면 state.json 이 두 번 마이그레이션 필요. → 5문서 revision 3 일괄 진행 후 PR A 착수.
- **dual-mode 의 복잡도**: 모든 게이트가 두 경로 처리 → 코드량 일시 증가. → 1버전 한정, PR E 에서 청산.
- **Windows atomic rename 한계**: 이미 위에서 명시. 단일 dispatch 가 직렬이라 영향 작음.
- **사용자가 design.md 를 잘못 수정**: body hash 불일치 → sentinel 무효 → 재승인. 이것은 의도된 동작 (codex H1 의 "수정 후 reject 만 있고 repair 없음" 은 `hsf doctor --repair` 로 수용). repair 명령이 실제로 무엇을 할지 본 문서에 명시:
  - state.json 손상 → 백업본 (`<slug>.json.bak.<ts>`) 으로 자동 복구 시도.
  - lock 좀비 → PID 죽음 확인 후 강제 reclaim.
  - sentinel/state version skew → 재발급 안내.

## Test plan

- 단위:
  - state.json atomic write — temp file 잔존 검증, lock 충돌 시뮬레이션.
  - body hash — design.md 본문 1줄 변경 시 hash 변경, frontmatter 만 변경 시도 hash 변경 (frontmatter 도 본문 일부).
  - CAS — version skew 발생 시 retry → 성공 1회.
  - sentinel 4축 검증 — 각 축이 단독으로 fail 처리됨을 확인.
- 통합:
  - 전체 사이클: `hsf state init` → `hsf state set current_step 5` → `hsf state set artifacts.A1.status done` → 검증.
  - 마이그레이션: v1 in-flight feature → `hsf state migrate-from-v1` → state.json 정확성.
  - Windows / Linux 동일성 (NTFS rename + Linux rename atomic).
- 회귀:
  - 기존 5문서가 정의한 워크플로 (intent → 승인 → dispatch → deploy validate) 가 PR C 후 동일 결과.

## Reviews

### External review (codex 3차, v3 일괄, 2026-04-29)

- **codex-v3-(a)**. v2 의 8 H 중 2개만 실질 해결 (git 오염 H4, YAML H3). 나머지는 relocation: race/lock 은 state.json 계층으로 옮겼지만 atomic write 코드 부재. "SoT → consensus protocol" 은 이름만 바꾼 재포장 — 같은 `.harness-sf/` trust domain. 현 sentinel 은 서명 없는 JSON (`templates/hooks/_lib/sentinel.js:58-66,72-94`).
- **codex-v3-(b1) split-brain**. design.md 에 `## Review Resolution` 유지하면서 state.json 에도 `review_resolution` (`state-consolidation-v3.md:75-77` + `fast-path-routing-v3.md:74-78`). 승인/해결 상태 두 곳 갈라짐.
- **codex-v3-(b2) branch/revision bleed**. state.json 키가 slug 단일 (`state-consolidation-v3.md:41,59-62`). branch 전환 / revision bump 후 stale state 계속 사용. 현 dispatch-state 도 동일 패턴 (`templates/hooks/_lib/dispatch-state.js:49-64`).
- **codex-v3-(b3) machine-local drift**. fingerprint mode 를 shared PROJECT.md → gitignored global.json 으로 옮기면 같은 commit/design 이라도 작업자마다 gate 판정 다름 (`non-git-fingerprint-v3.md:69-88`).
- **codex-v3-(b4) "consensus" 과장**. state/sentinel/audit/global 모두 같은 로컬 계층. 독립 신뢰원 아님 — 단순 4-축 local linked files.
- **codex-v3-(c1~6) schema NOT frozen**. current_step 타입 (숫자 vs dotted string), artifact discriminator (kind vs type), override 필드 3개 이름 (override_history/_used/_active_session), review_resolution 중복, fingerprint migration 이 존재하지 않는 `design.approved_*` 참조, entered_via enum 표기 불일치.
- **codex-v3-(d) PR C 위험**. gates + statusline + sentinel payload + fingerprint 동시 전환. head_sha 가 다곳 하드결합 (`templates/hooks/_lib/sentinel.js:15-16,61-66,85-93`, `templates/hooks/pre-deploy-gate.js:57-75`, `templates/hooks/_lib/dispatch-state.js:69-85`). 새 state/doctor/audit 진입점은 cli.js 에 부재. 한 곳 누락 = false deny/allow.

### Resolution

architecture-level 재작업 불필요. 모두 step ii (canonical state schema 문서) + Rollout 분할로 흡수.

- **(a)**: 정상 — v3 는 architecture pivot, 코드 미구현은 PR A~E 에서. 표현 정정: "v3 는 git 오염 / YAML 두 H 만 직접 해결, 나머지 6 H 는 PR A~E 에서 코드로 해결" 로 본문 명확화.
- **(b1) split-brain**: design.md 가 single source for resolution. state.json 의 `review_resolution` **삭제**. design.md 는 승인 후 immutable — body hash 가 sentinel 에 묶임 → 재합의 시 revision bump.
- **(b2) branch bleed**: state.json 키를 `<slug>__r<revision>.json` 로 변경. revision bump 시 새 파일. branch 별 분리는 git 에 맡김 (.harness-sf/state/ 는 gitignore — branch 전환 시 worktree 안에서 자동 분리).
- **(b3) drift**: fingerprint mode 위치를 PROJECT.md 로 **복귀**. installer 가 최초 1회 자동 작성, 그 후 사용자 편집 허용. tree-hash 캐시만 global.json (성능 데이터, 정책 아님).
- **(b4) "consensus"**: 본문에서 "consensus protocol" → "4-축 local linked files (design.md committed; state.json/sentinel/audit local)" 로 표현 정정. HMAC 도입은 PR A 에서 sentinel.js 에 추가 — 이로써 sentinel 만 진짜 신뢰원, 나머지는 sentinel 가 endorse 하는 데이터.
- **(c) schema 합의**: step ii 산출물 `2026-04-29-state-schema.md` 에서 모든 필드/타입/이름 1회 freeze. `current_step: string` (dotted notation), artifact discriminator: `type`, override: `override_active_session` (singleton) + audit.log (history), no `review_resolution` in state.json, entered_via: `"fast"|"standard"|"full"|"direct"` (prefix 제거).
- **(d) PR C 분할**:
  - **PR C1**: sentinel.js 에 새 payload 필드 추가, 양 shape 동시 발급. validate() 가 새 → 옛 순서로 검증. 기존 head_sha 코드 미접촉.
  - **PR C2**: 모든 게이트가 새 payload 만 검증. statusline + fingerprint API 도 같이 전환.
  - **PR C3**: head_sha 일괄 제거. dispatch-state.js / issue-* / sentinel.js 의 head_sha 직렬화 폐기.
  - 사이에 1 minor release 간격 — 사용자 in-flight 작업 보호.
