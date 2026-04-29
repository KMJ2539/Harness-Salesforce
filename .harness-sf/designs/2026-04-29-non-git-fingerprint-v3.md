---
type: feature
name: non-git-fingerprint
date: 2026-04-29
author: mjkang2539
status: draft-v3
revision: 3
supersedes: 2026-04-29-non-git-fingerprint.md
---

# non-git-fingerprint v3 — fingerprint 추상화 (state.json 기반, PROJECT.md 미수정)

## Why revision 3

revision 2 외부 리뷰:

- **codex-H1**: PROJECT.md 에 fingerprint mode 기록·갱신은 installer 계약 위반. installer 는 PROJECT.md 를 팀 공유 설정으로 간주, 기존 내용 수정 안 함 (`bin/install.js:205,215`).
- **codex-H2**: tree-hash scope 이 force-app/src 만 → deploy gate 가 읽는 `.harness-sf/PROJECT.md` 의 coverage target 변경 시 fingerprint 그대로 → 검증 우회.
- **codex-M1**: 문서 자기모순 — 한쪽 caller mode 모름, 다른 쪽 sentinel payload 에 mode 포함 즉시 reject.
- **codex-M2**: `git rev-parse` callsite 만 교체. 실제 state/approval 데이터는 여전히 head_sha 직렬화 — 신뢰모델 분열.
- **codex-Seq**: `hsf doctor --migrate-fingerprint-mode` 는 명령 자체가 신설된 뒤에야 의미. 현 CLI 는 init/update/list/help 만.

state-consolidation v3 가 fingerprint config 위치를 PROJECT.md → `.harness-sf/state/global.json` 으로 이동시킨다. doctor 명령은 PR A 에서 신설.

## 의존성

- **state-consolidation v3** (`.harness-sf/state/global.json` + `hsf doctor` 명령).

## Design

### Fingerprint 추상화

`templates/hooks/_lib/fingerprint.js`:

```js
// fingerprint() → { mode: "git" | "tree-hash" | "timestamp", value: string, scope: [...] }
//
// 호출자는 mode 와 value 를 함께 받는다 (M1 자기모순 해결).
// 동등성 비교는 항상 (mode === mode) AND (value === value) 두 축 모두.
```

폴백 우선순위:
1. **git** — `git rev-parse HEAD` + commit ≥ 1.
2. **tree-hash** — `force-app/` (없으면 `src/`) + `.harness-sf/PROJECT.md` (codex-H2 해결) 의 정규화된 sha256.
3. **timestamp** — 위 둘 다 실패. 비교 스킵, weak-trust 경고만 (revision 2 deltas 그대로).

scope 확장 (codex-H2 해결): tree-hash 에 deploy gate 가 의미적으로 의존하는 파일 포함.

```js
const TREE_HASH_SCOPE = [
  'force-app/',          // 또는 src/
  '.harness-sf/PROJECT.md',
];
```

PROJECT.md 가 변경되면 fingerprint 가 변경 → sentinel 무효화 → 재승인. coverage target 변경이 검증 우회로 빠지지 않음.

### 정규화 (revision 2 그대로 유지)

텍스트 파일 (`.cls` `.trigger` `.js` `.ts` `.html` `.css` `.xml` `.json` `.yaml` `.yml` `.md` `.page` `.component`):
- CRLF/CR → LF
- UTF-8 BOM 제거
- trailing newline 보존

바이너리: raw bytes.

### Mode 메타데이터 위치 (codex-H1 해결)

PROJECT.md 가 아닌 `.harness-sf/state/global.json` (state-consolidation v3 의 새 위치):

```json
{
  "schema_version": 1,
  "fingerprint": {
    "mode": "tree-hash",
    "determined_at": "2026-04-29T...",
    "scope": ["force-app/", ".harness-sf/PROJECT.md"],
    "exclude": [
      "**/node_modules/**",
      "**/.sfdx/**",
      "**/.sf/**",
      "**/*.log"
    ]
  }
}
```

`bin/install.js` 의 `doctor()` 가 이 파일을 신규 생성하거나 갱신. PROJECT.md 미접촉.

### sentinel payload (codex-M2 해결)

state-consolidation v3 의 sentinel 스키마에 fingerprint 가 이미 포함:

```json
{
  "kind": "design-approval",
  "design_body_hash": "...",
  "state_version": 7,
  "fingerprint": { "mode": "tree-hash", "value": "..." },
  "hmac": "..."
}
```

기존 `head_sha` 필드는 PR C (동시 cutover) 에서 일괄 폐기. dispatch-state.js / sentinel.js 의 head_sha 직렬화도 같은 PR 에서 fingerprint 로 전환. 부분 마이그레이션 금지.

### `hsf doctor` 명령 (codex-Seq 해결)

state-consolidation v3 의 PR A 에서 `hsf doctor` 신설. fingerprint 관련 서브명령:

```
hsf doctor                       → 종합 점검 (mode + state 무결성)
hsf doctor --fingerprint         → fingerprint 만 점검
hsf doctor --migrate-fingerprint-mode
  → 1. git → tree-hash 또는 그 반대로 변경 가능 여부 확인
  → 2. global.json 의 fingerprint 갱신
  → 3. in-flight design.md 의 state.json 에서 deploy.last_validation 과
        design.approved_* 를 reset (sentinel 무효화)
  → 4. audit.log 에 mode 전환 1줄 기록
```

먼저 PR A 에서 명령 신설 → PR C 에서 sentinel 전환 → PR doctor-1 에서 마이그레이션 명령 활성화.

### tree-hash 비용 캐시

`.harness-sf/state/global.json`:
```json
"fingerprint_cache": {
  "value": "sha256:...",
  "computed_at": "...",
  "input_summary": [
    { "path": "force-app/main/default/classes/Foo.cls", "mtime": "...", "size": 1234 }
  ]
}
```

매 호출 시 input_summary 의 (mtime, size) 합과 현재 트리의 (mtime, size) 합 비교. 동일하면 캐시 value 반환. 다르면 재계산.

## Rollout

- **선행**: state-consolidation v3 PR A (state.json + doctor 명령).
- **PR fp-1**: `templates/hooks/_lib/fingerprint.js` + 정규화 + 폴백 우선순위. 호출자 미전환.
- **PR fp-2**: `hsf doctor --fingerprint` + global.json 자동 생성. installer doctor() 통합.
- **PR fp-3** (state-consolidation v3 PR C 와 묶음): 모든 게이트가 fingerprint() 호출, sentinel payload 에 fingerprint 포함, head_sha 일괄 폐기.
- **PR fp-4**: `hsf doctor --migrate-fingerprint-mode` 활성화 + 사용자 안내.
- **PR fp-5**: tree-hash 캐시 도입 (성능 개선, 별도 PR).

## Risk

- **PROJECT.md 변경이 잦은 팀**: PR comment 주기로 PROJECT.md 가 자주 변경되면 매번 fingerprint 변경 → sentinel 무효화. → exclude 패턴에 `.harness-sf/PROJECT.md` 추가 옵션 (단, 이 경우 codex-H2 가 부분 회귀 — 트레이드오프 명시). 기본은 포함.
- **Windows mtime 정밀도 (NTFS 100ns) vs Unix (ns)**: 캐시 키에 mtime 사용 시 cross-OS 일관성 약함. → mtime 외 size 도 함께 본다 (revision 2 deltas 그대로).
- **mode 전환 시 in-flight 작업 손실**: state.json 의 `deploy.last_validation` reset → 작업 중인 사용자에게 영향. → 마이그레이션 명령이 1회 사용자 확인 + audit 기록.

## Test plan

- 환경별:
  - git repo (commit 있음) → mode = git, value = HEAD sha.
  - git init only → mode = tree-hash 폴백.
  - non-git + force-app → mode = tree-hash.
  - non-git + force-app 없음 → timestamp + 경고.
- scope 확장:
  - PROJECT.md 1줄 변경 → fingerprint 변경.
  - force-app 외 파일 (예: README.md) 변경 → fingerprint 불변.
- 정규화:
  - CRLF vs LF 동일 fingerprint.
  - BOM 유무 동일 fingerprint.
- 마이그레이션:
  - git → tree-hash 전환: in-flight sentinel 무효화 + 사용자 확인.
  - 캐시: 트리 미변경 시 재계산 skip.
- API 일관성:
  - sentinel.fingerprint.mode 가 다르면 reject (현 mode 와 비교).
  - sentinel.fingerprint.value 가 다르면 reject.

## Reviews

### External review (codex 3차, 2026-04-29)

- **(b3) machine-local drift**: fingerprint mode 를 PROJECT.md → global.json 으로 옮기면 같은 commit/design 이라도 작업자별 gate 판정 다름. 본 문서 v3 의 핵심 결정이 정책 일관성 깨뜨림.
- **(c5) 마이그레이션 필드 부재**: `design.approved_*` reset 명시했지만 state schema 에 그런 필드 없음 (`state-consolidation-v3.md:53-90`).

### Resolution

- **(b3)**: fingerprint mode 위치를 PROJECT.md 로 **복귀**. installer 가 최초 1회 자동 작성 (init 또는 doctor), 그 후 사용자/팀 편집 허용. PROJECT.md 보존 원칙은 "기존 사용자 정의 보존" 의미지 "절대 미수정" 아님 — installer.js 의 safe-merge 로직이 신규 키만 추가 가능. tree-hash 캐시 (`fingerprint_cache.value/computed_at/input_summary`) 는 성능 데이터로 global.json (gitignore) 에 유지.
- **(c5)**: 마이그레이션 시 reset 대상은 `state.deploy.last_validation` (실재 필드) 하나로 정정. 본 문서 v3 의 `design.approved_*` 표기 → `deploy.last_validation` 로 본문 수정 필요.
