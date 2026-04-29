---
type: feature
name: gate-hardening
date: 2026-04-29
author: mjkang2539
status: draft-v3
revision: 3
supersedes: 2026-04-29-gate-hardening.md
---

# gate-hardening v3 — override 6축 + 1회성 강제 + 단일 diagnostics

## Why revision 3

revision 2 외부 리뷰:

- **codex-H1**: scoped override 가 `deploy|modify|design|all` 4축. 현 공개 gate 는 create, modify, deploy, library 까지 — design 도 create/resolution 모호. 미커버.
- **codex-H2**: "1회성 권고" 강제 불가. hook 은 단순히 `process.env` 만 읽음 — export 시 세션 전체 우회.
- **codex-M1**: `_lib/diagnostics/<gate>.js` 중첩 디렉토리는 installer 가 배포 못 함 (`bin/install.js:172,185` — 1단계만 복사).
- **codex-M2**: doctor 권장 default 에 `System.debug(` 포함은 정책 희석. 운영 로깅 강제와 디버그 허용 혼합.
- **codex-Seq**: SKIP_* deprecation 은 모든 hook + README + 테스트 + 설치 설정이 한 릴리스에서 같이 바뀐 뒤여야.

## 의존성

- **state-consolidation v3** (override 사용 1회성 enforcement 위해 state.json 의 `override_used` 플래그 + sentinel 의 reset 시점).

## Design

### Override 6축 (codex-H1 해결)

```
HARNESS_SF_OVERRIDE='create:사유 ...'    # pre-create-design-link-gate
HARNESS_SF_OVERRIDE='modify:사유 ...'    # pre-modify-approval-gate
HARNESS_SF_OVERRIDE='design:사유 ...'    # pre-create-design-link-gate (resolution 단계)
HARNESS_SF_OVERRIDE='deploy:사유 ...'    # pre-deploy-gate
HARNESS_SF_OVERRIDE='library:사유 ...'   # pre-library-install-gate
HARNESS_SF_OVERRIDE='all:사유 ...'       # 전 게이트 (1회성 권고 + statusline ⚠)
```

`design:` 의미를 명확히:
- `design:` = design.md 작성/리뷰 단계의 sentinel 검증 우회 (resolution 누락, body hash 불일치 등).
- `create:` = 새 force-app 파일 생성 게이트 우회.

각 gate 는 `parseOverride(process.env.HARNESS_SF_OVERRIDE)` 호출 → scope 매칭 시 우회 + 사유 검증 (20자 이상, 공백 제거 후 8자 이상).

### 1회성 강제 (codex-H2 해결)

state-consolidation v3 의 state.json `override_history` 활용:

```json
{
  "override_history": [
    {
      "at": "2026-04-29T11:00:00Z",
      "scope": "deploy",
      "reason": "hotfix prod down ...",
      "session_id": "<from process env>"
    }
  ],
  "override_active_session": null    // 또는 session_id
}
```

검증 로직 (각 hook):
```
1. HARNESS_SF_OVERRIDE 미설정 → 정상 검증
2. 설정됨 → scope/reason 파싱
3. state.override_active_session 이 현재 session_id 와 동일 → 거부
   (메시지: "이 세션에서 이미 override 사용함. 세션 재시작 필요.")
4. 통과 시 state.override_active_session = session_id, override_history append, audit.log 기록
5. session 종료 시 (statusline 또는 session-start hook 이) override_active_session 자동 reset
```

session_id 는 Claude Code 가 제공하는 SESSION_ID env 또는 PID + 시작 시각 조합. 정확하지 않아도 됨 — 허용 정책이지 차단 정책이 아님 (사용자가 의도적 우회 시 막을 수 없으나 audit 기록은 남음).

### diagnostics 단일 파일 (codex-M1 해결)

중첩 디렉토리 폐기, `templates/hooks/_lib/diagnostics.js` 단일 파일:

```js
// hooks/_lib/diagnostics.js
'use strict';

function deployGateDiagnostic(failure) {
  // failure: { reason, sentinel, current_state, fingerprint }
  return [
    `✗ deploy-gate: ${failure.reason}`,
    '',
    '원인 후보:',
    failure.reason === 'body_hash_mismatch' ? '  1. design.md 본문이 sentinel 발급 후 수정됨' : null,
    failure.reason === 'state_version_skew' ? '  2. 다른 프로세스가 state 갱신' : null,
    failure.reason === 'fingerprint_mismatch' ? '  3. 코드 변경 또는 mode 전환' : null,
    '',
    "긴급 우회: HARNESS_SF_OVERRIDE='deploy:<사유 20자 이상>'",
  ].filter(Boolean).join('\n');
}

function modifyGateDiagnostic(failure) { /* ... */ }
function createGateDiagnostic(failure) { /* ... */ }
function libraryGateDiagnostic(failure) { /* ... */ }
function designGateDiagnostic(failure) { /* ... */ }

module.exports = {
  deployGateDiagnostic,
  modifyGateDiagnostic,
  createGateDiagnostic,
  libraryGateDiagnostic,
  designGateDiagnostic,
};
```

각 hook 은 `require('./_lib/diagnostics')` 후 적절한 함수 호출. installer 는 `_lib/*.js` 1단계만 복사 — 그대로 작동.

단위 테스트는 `templates/hooks/_lib/__tests__/diagnostics.test.js` (별도 PR 에서 정비, 테스트 인프라 자체가 현재 부재).

### Logging 정적 검사

PROJECT.md 스키마:
```yaml
logging:
  entry_pattern:           # literal substring
    - "Logger.log("
    - "LogService.info("
  entry_pattern_regex:     # 보조, 정규식
    - "App\\.log\\("
  scan_lines: 10
  exclude:
    - "**/test/**/*.cls"
```

doctor 권장 default (codex-M2 해결):
- `Logger.log(` 만 권장. `System.debug(` **제외**.
- `System.debug(` 는 디버그 출력이지 운영 로깅 아님. 권장 패턴에 포함 시 정책 희석.
- 사용자가 별도로 정의한 logger 가 있으면 직접 PROJECT.md 에 추가하도록 안내.

검증 로직 (revision 2 그대로): 정적 PASS → LLM 스킵. MISS/AMBIGUOUS → LLM 2차 필수.

### audit log hash chain

각 라인:
```
<ts>  <gate>  <slug>  <scope>  <reason>  prev=<sha8>  sha=<sha8>
```

`hsf audit verify` — 모든 라인을 처음부터 재계산, prev 와 직전 라인 sha 일치 검증. 위변조 시 첫 불일치 지점 보고 + exit 1.

`hsf audit tail [n]` — 최근 n줄 (기본 20).

### SKIP_* deprecation (codex-Seq 해결)

한 릴리스에서 모두 전환:
- `templates/hooks/*.js` — SKIP_* 환경변수 제거, OVERRIDE 만 인식.
- `templates/_stubs/settings.json` — 관련 환경변수 안내 제거.
- `README.md` 의 hook 표 (`README.md:178,181`) — 새 OVERRIDE 형식으로 갱신.
- `templates/hooks/README.md` — sentinel + OVERRIDE 매핑 갱신.
- `examples/sfdx-demo/WALKTHROUGH.md` — 우회 예시 갱신.
- 테스트 (현재 부재 — 신설 시 OVERRIDE 기준).

deprecation 정책:
- v0.x.y 에서 SKIP_* 도 인식 + warning ("deprecated, use HARNESS_SF_OVERRIDE='<scope>:<reason>'").
- v0.x.(y+2) 에서 SKIP_* 제거.

## Rollout

- **선행**: state-consolidation v3 PR A (state.json `override_history`).
- **PR gate-1**: `_lib/diagnostics.js` 단일 파일 + 5개 진단 함수.
- **PR gate-2**: `parseOverride()` 헬퍼 + 6축 인식. SKIP_* 도 병행 인식 + warning.
- **PR gate-3**: 1회성 enforcement (state.override_active_session). 모든 hook 통합.
- **PR gate-4**: audit hash chain + `hsf audit verify/tail`.
- **PR gate-5**: logging 정적 검사 + PROJECT.md 스키마 + doctor 권장 default.
- **PR gate-6** (state-consolidation v3 PR E 와 묶음): SKIP_* 일괄 제거.

## Risk

- **session_id 신뢰성**: Claude Code SESSION_ID 가 일관 제공 안 되면 1회성 enforcement 약화. → fallback 으로 PID + 시작 시각 사용. 완벽하지 않음을 명시.
- **diagnostics 단일 파일 비대화**: 게이트가 늘면 파일이 커짐. → 게이트당 함수 분리, 한 파일에 모이는 패턴 유지. 1000줄 넘으면 그때 분할.
- **logging 정적 검사 false positive**: 정규식 한계는 revision 2 에서 명시 완료. PASS 시만 LLM 스킵, 의문 케이스는 LLM 으로 보냄.

## Test plan

- override:
  - 6축 각각이 해당 게이트만 우회.
  - prefix 누락 → 거부.
  - 사유 < 20자 / 공백 제거 후 < 8자 → 거부.
  - 1회성: 같은 세션에서 2번째 호출 → 거부.
  - 세션 재시작 후 다시 사용 가능.
- diagnostics:
  - 각 게이트 실패 케이스에서 진단 메시지 출력.
- audit:
  - hash chain verify: 정상 / 위변조 (1줄 수정) / 위변조 (1줄 삽입).
  - tail: 최근 N줄.
- SKIP_* deprecation:
  - 신/구 변수 동시 사용 시 warning.

## Reviews

### External review (codex 3차, 2026-04-29)

- **(c3) override 필드 이름 충돌**: state-consolidation-v3 는 `override_history` 만, 같은 문서 rollout 은 `override_used`, 본 문서는 `override_active_session` 추가. 3개 이름.

### Resolution

- **(c3)**: 두 필드로 정리.
  - `override_active_session: string | null` — 현재 우회 사용 중인 세션 ID. 1회성 강제용 (singleton).
  - `override_history: [{at, scope, reason, session_id}]` — append-only 기록.
  - `override_used` 는 폐기 (state-consolidation-v3 본문에서 제거).
  - 본 문서 + state-consolidation v3 본문에서 표기 통일.
