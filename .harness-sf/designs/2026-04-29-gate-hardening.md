---
type: feature
name: gate-hardening
date: 2026-04-29
author: mjkang2539
status: draft-v2
revision: 2
---

# 게이트 강화 (`override 단일화 + logging 정적 검사`)

두 작은 개선을 한 문서로 묶음. 둘 다 게이트의 결정성/신뢰성 회복이라는 같은 축.

## Why (background / problem)

**A. override 플래그 난립**

현재 게이트 우회 환경변수가 4종 이상:
- `HARNESS_SF_SKIP_MODIFY_GATE`
- `HARNESS_SF_SKIP_DEPLOY_GATE`
- `HARNESS_SF_SKIP_FEATURE_GATE`
- `HARNESS_SF_SKIP_RESOLUTION_GATE`

스킬 본문은 "avoid using" 이라고 적지만:
- 게이트 실패 메시지에 자가 진단이 부족 → 사용자가 막히면 우회 플래그를 검색해 켠다.
- 한 번 켜면 누가/언제/왜 켰는지 기록 없음 → "왜 검증 없이 deploy 됐지?" 추적 불가.
- 플래그가 늘어날수록 기억하기 어려움 → 결국 `export HARNESS_SF_SKIP_*=1` 한 줄로 모두 끔.

게이트 시스템이 "마음먹으면 우회 가능" 으로 인식되면 검증 가치 자체가 흔들림.

**B. logging convention 검증의 비결정성**

`PROJECT.md` 의 logging convention 섹션은 진입점(`@AuraEnabled`/`@InvocableMethod`/`webservice`) 에서 logger 호출이 있는지 검증한다. 현재 검증은 `sf-apex-code-reviewer` 와 `sf-deploy-validator` 의 LLM 판정에 의존:
- 같은 코드를 두 번 리뷰하면 결과가 다를 수 있음.
- 프로젝트마다 logger 패턴이 다른데 (`Logger.log` / `LogService.info` / `Application.logger.log` …) LLM 이 매번 추론.
- false positive 가 많아지면 사용자가 "리뷰 무시하고 진행" 학습.

검증의 본질("진입점 첫 N줄에 특정 패턴이 있는가")은 정규식으로 충분히 결정 가능.

## Non-goals

- 게이트의 보안 모델 변경 (HMAC sentinel 그대로).
- LLM 리뷰 전체 제거. 정적 검사를 1차 필터로 두고, 2차로 LLM 이 의도/품질을 본다.
- 신규 게이트 추가.

## Design

### A. override 단일화

**현재 4종 SKIP 플래그 → `HARNESS_SF_OVERRIDE` 단일화**.

```bash
# 정상
hsf design approve <path>          # 게이트 통과해야 함

# 우회 (사유 필수)
HARNESS_SF_OVERRIDE='hotfix: prod down, design 작성 시간 없음' \
  hsf design approve <path>
```

규칙:
- 빈 값 또는 미설정 = override 없음 (게이트 정상 동작).
- 값 = 사유 문자열, **최소 10자** (의미 없는 "skip" 거부).
- 모든 게이트가 같은 변수를 인식. SKIP_MODIFY/DEPLOY/FEATURE/RESOLUTION 구분 제거 — override 는 "이 작업 전체에 대한 우회" 로 단일.

**감사 로그**:

`.harness-sf/audit.log` 에 append-only:
```
2026-04-29T11:00:00Z  deploy-gate     order-module    "hotfix: prod down, design 작성 시간 없음"
2026-04-29T11:15:00Z  modify-approval account-trigger "사용자 검토 후 직접 진행"
```

retro 시 사용자가 직접 검토 가능. 너무 잦으면 "게이트가 너무 빡빡한가?" 신호.

**자가 진단 메시지**:

게이트 실패 시 현재는 "check failed" 류 단문. 변경 후:

```
✗ deploy-gate: design body hash mismatch
   sentinel hash:  sha256:abc...
   current hash:   sha256:def...

원인 후보:
  1. design.md 본문이 sentinel 발급 후 수정됨
     → /sf-feature 의 Step 5 로 돌아가 재승인
  2. fingerprint mode 가 변경됨 (git → tree-hash)
     → hsf doctor 로 mode 확인
  3. sentinel TTL 만료 (기본 30분)
     → 재승인 필요

긴급 우회: HARNESS_SF_OVERRIDE='<사유>' 설정 후 재시도.
```

자가 진단이 충분하면 우회 빈도가 줄어듦.

**Deprecation**:
- v1: 신규 변수 추가, 기존 SKIP_* 도 인식 + deprecation warning ("HARNESS_SF_SKIP_DEPLOY_GATE 는 deprecated. HARNESS_SF_OVERRIDE 로 마이그레이션").
- v2 (1버전 후): SKIP_* 제거.

### B. logging 정적 검사

**`templates/hooks/_lib/check-logging.js` 신설** (state-consolidation 적용 후 `_lib/commands/lint/logging.js`).

알고리즘:
```
1. 입력: Apex 파일 경로
2. AST 대신 정규식 (zero-dep 유지):
   - 진입점 메서드 매칭:
     /(?:@AuraEnabled|@InvocableMethod|webservice|global\s+static)[^{]*\{/g
   - 메서드 본문 첫 N(=10) 라인 추출
3. PROJECT.md 의 logger pattern 검색:
   logging.entry_pattern: ["Logger.log(", "LogService."]
   → 위 패턴 중 하나가 본문 첫 N줄에 있으면 PASS
4. 출력: { file, method, line, status: pass | miss }
```

호출 위치:
- `pre-deploy-gate.js` 에서 deploy validate 직전 호출. miss → finding 으로 등록.
- `sf-apex-code-reviewer` 에이전트는 정적 결과를 입력으로 받음 ("logging 정적 검사 통과/실패: ...") → 의도/품질에만 집중.

**PROJECT.md 스키마**:

```yaml
logging:
  entry_pattern:
    - "Logger.log("
    - "LogService.info("
    - "Application.logger."
  scan_lines: 10              # 진입점 본문 첫 N줄
  exclude:
    - "**/test/**/*.cls"      # 테스트 클래스는 제외
```

미정의 시 logging 검사 skip (opt-in).

**한계와 보완**:
- 정규식은 우회 가능 (주석으로 패턴 모방 / 동적 호출 / 매크로). → LLM 2차 검토가 보완. 단, 1차에서 이미 PASS 면 2차는 통과 처리해 비용 절감.
- 진입점 매칭이 트리 안의 inner class 까지 잡지 못할 수 있음. → 알려진 한계로 명시, 회귀 발견 시 보완.

## Revision 2 deltas

- **Scoped override prefix**:
  ```
  HARNESS_SF_OVERRIDE='deploy:사유 ...'
  HARNESS_SF_OVERRIDE='modify:사유 ...'
  HARNESS_SF_OVERRIDE='design:사유 ...'
  HARNESS_SF_OVERRIDE='all:사유 ...'    # 광역, 명시적
  ```
  prefix 누락 → 거부. `all:` 은 1회성 권고 + statusline ⚠. audit.log 에 scope 기록.
- **사유 검증 결정성**: heuristic 폐기. 최소 20자 + 공백 제거 후 8자 이상. 의미 판정은 retro 시 사람이.
- **Audit log hash chain**: 각 라인 `<ts> <gate> <slug> <scope> <reason>  prev=<sha8> sha=<sha8>`. 무결성 검사 명령 `hsf audit verify`. 위변조 시 exit 1.
- **Logging 2계층 검증**:
  - static (regex) PASS → 통과 (LLM 스킵).
  - static MISS / AMBIGUOUS → finding + LLM 2차 필수.
  - 정규식 한계는 PROJECT.md 또는 본문 주석에 명시, false positive 보고 채널은 GitHub issue 라벨.
- **PROJECT.md 스키마 보강**:
  - `logging.entry_pattern`: literal substring (default).
  - `logging.entry_pattern_regex`: 정규식 (보조). 둘 다 있으면 OR.
- **doctor 권장 default**: `force-app/main/default/classes/` 존재 + `logging.entry_pattern` 미설정 시 경고 + 권장 (`Logger.log(`, `System.debug(`).
- **자가 진단 메시지 분리**: `_lib/diagnostics/<gate>.js` 로 게이트별 분리, 단위 테스트.
- **SKIP_* deprecation**: state-consolidation 정책 채택 (다음 minor warning, 그 다음 minor 제거).

## Risk

- **A. 단일 변수의 폭이 커짐**: `HARNESS_SF_OVERRIDE` 가 모든 게이트를 우회 → 사용자가 한 번 켜면 의도와 다르게 광범위 우회. → 기본은 1회성(실행 후 자동 unset 권고), 영구 export 시 statusline 에 ⚠ 경고.
- **A. 사유 강제의 회피**: "skip skip skip" 같은 무의미 사유. → 최소 10자 + 자주 쓰는 단어("skip", "ignore", "bypass") 만으로 채워진 경우 거부. heuristic.
- **B. PROJECT.md 미설정 프로젝트**: logging 검사 skip → 의도와 다르게 무력화. → init 의 doctor 에서 logging.entry_pattern 누락 시 안내.
- **B. 패턴 매칭의 false negative**: PASS 처리되었지만 실제로는 logger 가 없는 케이스 (e.g. 패턴이 메서드 본문이 아닌 클래스 필드 초기화에 있음). → scan_lines 범위 명시 + LLM 2차에서 잡힘.

## Test plan

A. override:
- SKIP_* 만 설정 → deprecation warning + 동작은 유지.
- HARNESS_SF_OVERRIDE 사유 < 10자 → 거부.
- 정상 사유로 게이트 우회 → audit.log 1줄 추가 확인.
- 자가 진단 메시지: 각 게이트 실패 케이스에 대해 원인 후보 표시 확인.

B. logging:
- 진입점 + logger 호출 → PASS.
- 진입점만 + logger 없음 → MISS, finding 등록.
- 진입점 + 주석 안의 패턴 → MISS (정규식이 주석 무시 못 하므로 PASS 일 수 있음, 한계 케이스로 문서화).
- PROJECT.md 미설정 → skip.

## Rollout

A:
1. PR 1 — HARNESS_SF_OVERRIDE 추가, SKIP_* 도 병행 인식 + warning.
2. PR 2 — 자가 진단 메시지 강화 (각 게이트별).
3. PR 3 (1버전 후) — SKIP_* 제거.

B:
1. PR 1 — `check-logging.js` + PROJECT.md 스키마 + doctor 안내.
2. PR 2 — pre-deploy-gate 통합, sf-apex-code-reviewer 입력 형식 변경.

A 와 B 는 서로 독립. 어느 쪽이 먼저 가도 무관.

## Dependencies

- `state-consolidation` (cli/audit 위치). 독립 진행도 가능.

## Reviews

### Infra self-review (2026-04-29)

#### H

- **H1. OVERRIDE 단일화의 scope 폭 위험.**
  Why: 한 환경변수가 모든 게이트를 우회. 사용자가 "이번 deploy 만 우회" 의도로 export 했다가 후속 modify-approval / design-approval 까지 연쇄 우회. 의도하지 않은 광역 무력화.
  Suggest: scoped override — `HARNESS_SF_OVERRIDE='deploy:hotfix prod down'` 형식. prefix `deploy:` / `modify:` / `design:` 으로 게이트 한정. prefix 없으면 1회성으로 강제 (실행 직후 unset 안내).

- **H2. 정규식 logging 검사의 정확성 한계.**
  Why: Apex 진입점 메서드 매칭 정규식 `(?:@AuraEnabled|...)[^{]*\{` — multi-line annotation, 메서드 사이 nested class, generic 인자, comment-out, 매크로 같은 케이스에서 오탐/미탐 다수. AST 가 정답이지만 zero-dep 위반.
  Suggest: 정규식은 1차 필터만, MISS 시 LLM 2차 필수 (PASS 시만 LLM 스킵). 알려진 한계를 PROJECT.md 에 명시 + false positive 보고 채널.

#### M

- **M1. audit.log 무결성 부재.**
  Why: append-only 라 했지만 사용자 수동 편집 막을 방법 없음. 감사 추적의 핵심이 위변조 가능하면 의미 약함.
  Suggest: 각 줄에 이전 줄 hash 포함 (hash chain). 또는 sentinel 키로 라인별 HMAC. zero-dep 으로 가능.

- **M2. 사유 heuristic 의 i18n 누락.**
  Why: "skip", "ignore", "bypass" 거부 — 한국어 ("넘김", "건너뜀") / 일어 사용자에게 무력화.
  Suggest: heuristic 폐기. 대신 **최소 20자 + 알파벳/한글 비율 검증** 같은 결정적 규칙. 또는 사유 검증 자체를 제거하고 audit.log 신뢰만으로 충분 (retro 시 무의미 사유 발견 가능).

- **M3. logging.entry_pattern 매칭 의미 모호.**
  Why: `"Logger.log("` 같은 패턴이 substring 매칭인지 word-boundary 인지 명세 없음. `MyLogger.log(` 도 매치되는지?
  Suggest: 명시 — "literal substring 매칭, parenthesis 까지 포함하면 호출 한정". 또는 패턴 자체를 정규식으로 받음 (`logging.entry_pattern_regex`).

- **M4. PROJECT.md 미설정 시 silent skip.**
  Why: opt-in 이라 자유롭지만, 신규 프로젝트가 logging 검사 받지 못하는 상태로 운영될 위험.
  Suggest: doctor() 에서 logging.entry_pattern 미설정 시 경고 + 권장 default 제시 ("Logger.log(", "System.debug(" 등).

#### L

- **L1. 자가 진단 메시지의 유지보수.**
  게이트별 원인 후보가 코드와 분리되면 코드 변경 시 메시지가 stale. → hooks 안에 같이 두고 단위 테스트.

- **L2. SKIP_* deprecation 1버전의 정의.**
  state-consolidation 의 동일 이슈와 같이 정책 통일 필요.

#### Strengths

- audit.log 자체는 게이트 신뢰 회복의 핵심 도구 — 우회가 가능하되 추적 가능.
- 자가 진단 메시지 강화는 우회 빈도 자체를 줄이는 정공법.
- 정적 검사 1차 + LLM 2차 의 계층 분리는 비용/결정성 양립.

### External review (codex, 2026-04-29)

- **codex-H1. scoped override 축이 실제 gate 집합 미커버.** `deploy|modify|design|all` 만 정의. 현 공개 gate 는 create, modify, deploy, library 까지 4종이며 bypass 변수도 각각 다름 (`README.md:178,181`). `design:` 이 create 인지 resolution 인지 모호.
- **codex-H2. "1회성 권고" 강제 불가.** 현 hook 은 단순히 `process.env` 만 읽음 (`templates/hooks/pre-modify-approval-gate.js:41`, `templates/hooks/pre-deploy-gate.js:55`). 사용자가 export 하면 세션 전체 우회.
- **codex-M1.** `_lib/diagnostics/<gate>.js` 구조는 installer 가 nested 디렉토리 배포 못 함 (`bin/install.js:172,185` — `hooks/_lib` 1단계만 복사).
- **codex-M2. doctor 권장 default 에 `System.debug(` 포함은 정책 희석.** 운영 로깅 강제와 디버그 허용이 섞임.
- **codex-Seq.** SKIP_* deprecation 은 모든 hook + README + 테스트 + 설치 설정이 한 릴리스에서 같이 바뀐 뒤여야.

### Resolution

#### H

- **H1 → [1] accept.** scoped override 도입:
  ```
  HARNESS_SF_OVERRIDE='deploy:사유 ...'      # deploy-gate 만 우회
  HARNESS_SF_OVERRIDE='modify:사유 ...'      # modify-approval 만
  HARNESS_SF_OVERRIDE='design:사유 ...'      # design-approval 만
  HARNESS_SF_OVERRIDE='all:사유 ...'         # 모든 게이트 (광역, 명시적)
  ```
  prefix 누락 → 거부 ("scope 명시 필요"). `all:` 은 1회성 권고 + statusline ⚠ 표시. audit.log 에 scope 기록.

- **H2 → [1] accept.** 2계층 검증 명세:
  ```
  static check (regex):
    PASS → 통과 (LLM 스킵)
    MISS → finding 등록 + LLM 2차 필수
    AMBIGUOUS (multi-line annotation 등) → MISS 로 취급
  LLM 2차 (sf-apex-code-reviewer):
    - static MISS 케이스만 입력
    - PASS 또는 reject 결정
  ```
  알려진 정규식 한계는 PROJECT.md `logging.known_limitations.md` 또는 본문 주석에 명시. false positive 보고 채널은 GitHub issue 라벨.

#### M

- **M1 → [1] accept.** hash chain 도입. 각 라인 형식:
  ```
  <ts> <gate> <slug> <scope> <reason>  prev=<sha8> sha=<sha8>
  ```
  마지막 라인의 sha 가 다음 라인 prev 와 일치. 무결성 검사 명령: `hsf audit verify`. 위변조 발견 시 반환 코드 1.
- **M2 → [2] modified accept.** heuristic 폐기, 대신 **최소 20자** + **공백 제거 후 8자 이상** 만 검증. 의미는 사람이 retro 시 판정. 결정성 우선.
- **M3 → [1] accept.** PROJECT.md 스키마에 `logging.entry_pattern` 형식 명시: literal substring 매칭, 정규식 필요 시 `logging.entry_pattern_regex` 별도 필드. 둘 다 있으면 OR 결합.
- **M4 → [1] accept.** doctor() 가 `force-app/main/default/classes/` 존재 + `logging.entry_pattern` 미설정 시 경고 + 권장 default 제시 (`Logger.log(`, `System.debug(`).

#### L

- **L1 → [1] accept.** 자가 진단 메시지를 hooks 파일과 같은 디렉토리의 `_lib/diagnostics/<gate>.js` 로 분리. 단위 테스트 추가.
- **L2 → [1] accept.** state-consolidation Resolution 의 deprecation 정책 (다음 minor warning, 그 다음 minor 제거) 을 채택. SKIP_* 도 동일 정책.

#### Updated design changes (revision: 2)

1. scoped override prefix 명세 (Design § A 첫 단락).
2. 사유 검증 규칙을 결정적 (20자/8자) 으로 변경.
3. audit.log hash chain + `hsf audit verify` 명령 추가.
4. `logging.entry_pattern_regex` 보조 필드 추가.
5. doctor() 의 logging 권장 default 안내 추가.
6. `_lib/diagnostics/` 구조 명시.
