---
type: feature
name: non-git-fingerprint
date: 2026-04-29
author: mjkang2539
status: draft-v2
revision: 2
---

# non-git 환경 폴백 (`repo fingerprint`)

## Why (background / problem)

`templates/hooks/pre-deploy-gate.js` 와 `_lib/validate-loop-state.js` 는 sentinel TTL/일관성 검증을 위해 `git rev-parse HEAD` 를 호출한다. 의도:
- deploy validate 가 통과한 시점의 HEAD 와 실제 deploy 시점의 HEAD 가 같은지 비교 → 사이에 끼어든 변경 감지.
- design 승인 후 코드가 바뀌면 sentinel 무효화.

문제:
- **non-git SFDX 프로젝트**: `force-app/` 만 있고 `git init` 안 한 환경 흔함 (예: `C:\TEST_MODULE`). `git rev-parse HEAD` 가 실패 → 게이트가 (a) 거부 (b) 무시 (c) 정의되지 않은 상태 중 하나로 빠짐. 코드 경로에 따라 다름.
- **git 초기화는 했지만 commit 0개**: `HEAD` 부재 → 같은 문제.
- **shallow clone / detached HEAD / submodule** 같은 비표준 상태: 검증은 되지만 의도와 다른 sha 를 잡을 수 있음.

결과: 신규 사용자(특히 SFDX 단독 사용자)가 첫 deploy 단계에서 막히거나 sentinel 이 조용히 무력화된다.

## Non-goals

- `git` 사용을 강제. SFDX-only 프로젝트도 1급 시민으로 지원.
- HEAD 추적의 의미적 깊이 변경 (커밋 그래프 traversal 같은 것). 단순 fingerprint 비교로 충분.
- 변경 이력 자체를 저장. fingerprint 는 "현재 트리의 동일성" 만 본다.

## Design

### Fingerprint 추상화

`templates/hooks/_lib/state/fingerprint.js` (state-consolidation 의 일부) 에 단일 진입점:

```js
fingerprint() → { mode: "git" | "tree-hash" | "timestamp", value: string }
```

폴백 우선순위:
1. **git** — `git rev-parse HEAD` 성공 + commit 1개 이상. value = sha.
2. **tree-hash** — `force-app/` (없으면 `src/`) 의 파일 목록 + 각 파일 sha256 을 정렬 후 합쳐 단일 sha256. value = tree sha.
3. **timestamp** — 위 둘 다 실패 시 (예: 프로젝트 초기화 직후). value = `ts:<unix-ms>`. TTL 만 검증.

호출자(`pre-deploy-gate.js` 등)는 mode 를 의식하지 않음. value 동일성만 비교. mode 가 timestamp 인 경우 sentinel TTL 을 더 짧게(기본 30분 → 5분) 적용해 약한 검증을 보완.

### Tree-hash 산출 정책

```
입력: force-app/ (또는 src/) 하위 모든 파일
필터: .gitignore 무시, 다음 패턴 제외
  - **/node_modules/**
  - **/.sfdx/**
  - **/.sf/**
  - **/*.log
정렬: 파일 경로 (POSIX, lowercase 무관)
파일별: sha256(content)
최종: sha256(join("\n", path + ":" + file_sha))
```

성능: 일반 SFDX 프로젝트(`force-app` ~ 수백 파일)에서 < 200ms. 매 게이트마다 호출되므로 중요. `.harness-sf/.cache/fingerprint.lock` 에 mtime 기반 단순 캐시 (트리 mtime 변화 없으면 재계산 skip).

### `init` 시 mode 결정

`bin/install.js` 의 `doctor()` 단계에서:
1. `git rev-parse HEAD` 시도 → 성공이면 mode = git.
2. 실패하지만 `force-app/` 존재 → mode = tree-hash.
3. 둘 다 실패 → mode = timestamp + 사용자에게 안내 ("force-app 디렉토리가 없습니다. SFDX 프로젝트인지 확인하세요.").

결정된 mode 는 `.harness-sf/PROJECT.md` 에 기록(없으면 생성):

```yaml
fingerprint:
  mode: tree-hash    # git | tree-hash | timestamp
  determined_at: 2026-04-29T...
  scope: force-app/  # tree-hash 모드에서 해시 대상 루트
```

런타임에 mode 가 변경되면 (e.g. 사용자가 나중에 git init) fingerprint.js 가 자동 감지 후 PROJECT.md 갱신 + 진행 중 sentinel 무효화 (mode 전환은 fingerprint value 와 무관하게 다른 신뢰 모델이므로 새로 시작).

### sentinel payload 변경

sentinel 의 HMAC payload 에 `fingerprint.mode` 와 `value` 둘 다 포함. 검증 시 mode 가 다르면 즉시 거부 (e.g. git 모드로 발급된 sentinel 을 tree-hash 모드에서 사용 못 함).

## Revision 2 deltas

- **tree-hash 정규화 명세**:
  - 텍스트 (`.cls` `.trigger` `.js` `.ts` `.html` `.css` `.xml` `.json` `.yaml` `.yml` `.md` `.page` `.component`): CRLF/CR → LF, UTF-8 BOM 제거, trailing newline 보존.
  - 바이너리 (이미지, staticresource zip 내부): raw bytes.
  - 감지: 확장자 우선, magic byte 폴백.
  - 정규화 후 sha256.
- **timestamp 모드 의미 변경**: fingerprint 비교 **스킵**, weak-trust 경고만 출력. TTL 24시간 (기존 30분에서 확대) — sub-skill chain 길어도 만료 안 됨. git/tree-hash 모드는 30분 유지.
- **Cache 키**: `{mtime, size}` 조합. 둘 중 하나만 변경되어도 재계산.
- **mode 전환 명령**: `hsf doctor --migrate-fingerprint-mode` 신설. in-flight design.md 의 `state.deploy.last_validation` + `state.design.approved_*` reset + audit.log 기록.
- **exclude 정책 변경**: ".gitignore 무시" 폐기. 기본을 ".gitignore 사용 + git 없으면 default exclude" 로. PROJECT.md `fingerprint.exclude` 는 union 추가.
- **scope 우선순위**: `force-app/` → `src/` → timestamp 모드. 이행기 프로젝트는 PROJECT.md `fingerprint.scope` 명시.

## Risk

- **tree-hash 의 거짓 변경 감지**: 빌드 산출물(`.sfdx/typings/`) 같은 자동 생성 파일이 force-app 안에 있으면 매 build 마다 fingerprint 변경. → 필터 패턴에 자동 생성 디렉토리 포함. 필터 부족 시 사용자가 PROJECT.md 의 `fingerprint.exclude` 로 추가.
- **tree-hash 비용**: 대형 프로젝트 (force-app 수천 파일) 에서 200ms 초과 가능. → mtime 캐시 + 변경 감지 시에만 재계산.
- **timestamp 모드 보안 약화**: 사실상 단순 TTL. → init 시 사용자에게 명시 안내, PROJECT.md 에 상태 노출, statusline 에 표시 ("⚠ fingerprint: timestamp mode").
- **mode 전환 시 진행 중 작업 손실**: git init 한 순간 in-flight sentinel 모두 무효화. → mode 전환 시 1회 사용자 확인 ("fingerprint mode 전환 — 진행 중 sentinel N개 무효화. 계속?").

## Test plan

- 환경별:
  - 정상 git repo (커밋 있음) → mode = git, value = HEAD sha.
  - git init only (커밋 0개) → mode = tree-hash 로 폴백.
  - non-git + force-app 있음 → mode = tree-hash.
  - non-git + force-app 없음 → mode = timestamp + 경고.
- 동등성: 같은 force-app 트리에서 fingerprint() 호출 시 항상 같은 value.
- 변경 감지: 파일 1줄 수정 → fingerprint value 변경.
- 캐시: 트리 변경 없을 때 재계산 skip 확인.
- mode 전환: tree-hash → git 전환 시 in-flight sentinel 무효화 + 사용자 확인.

## Rollout

1. PR 1 — `state/fingerprint.js` 신설, 기존 `git rev-parse` 호출처를 모두 fingerprint() 로 교체.
2. PR 2 — `bin/install.js` doctor() 에 mode 결정 추가, PROJECT.md 갱신.
3. PR 3 — sentinel payload 에 mode 포함, 검증 강화.
4. PR 4 — statusline 에 mode 노출 + tree-hash 캐시.

## Dependencies

- `state-consolidation` 의 `state/` 모듈 구조 안에 fingerprint.js 가 자리잡음. 독립적으로도 가능.

## Reviews

### Infra self-review (2026-04-29)

#### H

- **H1. line-ending / encoding 정규화 부재.**
  Why: tree-hash 가 파일 raw bytes 의 sha256. Windows 체크아웃은 CRLF, Unix 는 LF → 같은 논리적 코드가 다른 fingerprint. 팀이 OS 혼용 시 매 commit 마다 fingerprint 변경 → sentinel 무력화.
  Suggest: tree-hash 입력 정규화 — `.cls`/`.trigger`/`.js`/`.html`/`.xml` 은 LF 통일 + UTF-8 BOM 제거 후 해시. 바이너리(`.resource` staticresource 내부) 는 raw.

- **H2. timestamp 모드의 sub-skill chain TTL 위험.**
  Why: TTL 5분. `/sf-feature` 풀 사이클 (intent + 페르소나 리뷰 + 사용자 응답 대기) 은 5분 쉽게 초과. timestamp 모드에선 매번 sentinel 재발급 → infinite re-approval loop.
  Suggest: timestamp 모드에선 게이트가 fingerprint 비교 자체를 스킵하고 "신뢰도 약함" 경고만. 또는 TTL 을 sentinel 발급 ↔ 검증 간이 아닌 **세션 lifetime** 기반으로 변경.

#### M

- **M1. mtime 캐시의 cross-platform 정밀도.**
  Why: NTFS mtime 100ns, ext4 ns, FAT32 2s. 짧은 간격 수정 시 캐시가 stale 변경 놓칠 수 있음.
  Suggest: mtime + size 조합. size 변경 시 무조건 재계산. mtime 의존성 줄임.

- **M2. mode 전환 시 frontmatter state 처리 명세 부재.**
  Why: "사용자 동의 후 in-flight sentinel 무효화" 했지만 design.md 의 `state.deploy.last_validation` 은 어떻게 되는가? 그대로 두면 다음 게이트에서 다시 invalid.
  Suggest: mode 전환 시 모든 in-flight design.md 의 `state.deploy` 와 `state.design.approved_*` 를 reset. `hsf doctor --migrate-fingerprint-mode` 같은 명시 명령 제공.

- **M3. .gitignore 무시 정책의 의도 불일치.**
  Why: ".gitignore 무시" 후 자동 생성 디렉토리 별도 필터 — 사용자가 .gitignore 에 이미 적은 build artifact 를 또 PROJECT.md `fingerprint.exclude` 에 적어야 함. 이중 관리.
  Suggest: 기본을 ".gitignore 존재 시 그것 사용 + git 없으면 default exclude pattern" 으로 변경. PROJECT.md 는 추가 override 만.

#### L

- **L1. force-app vs src 자동 감지의 모호성.**
  둘 다 있는 전이기 프로젝트도 존재. 우선순위 명시 필요.

- **L2. tree-hash 비용 측정 부재.**
  "< 200ms" 추정. CI 환경/대형 프로젝트 실측 없음. 게이트마다 호출이라 누적 영향 큼.

#### Strengths

- mode 추상화로 호출자가 git 가정에서 해방 — TEST_MODULE 같은 케이스 명확히 해결.
- 폴백 우선순위 (git → tree-hash → timestamp) 가 직관적.
- sentinel payload 에 mode 포함 → mode 전환 시 자동 무효화. 보안적으로 정상.

### External review (codex, 2026-04-29)

- **codex-H1. PROJECT.md 에 fingerprint mode 기록·갱신은 installer 계약 위반.** installer 는 PROJECT.md 를 팀 공유 설정으로 간주, 기존 내용 수정 안 함 (`bin/install.js:205,215`). mode 메타데이터는 별도 위치 필요.
- **codex-H2. tree-hash scope 이 force-app/src 만 → gate 의미 변경 파일 누락.** deploy gate 는 `.harness-sf/PROJECT.md` 의 coverage target 을 읽음 (`templates/hooks/pre-deploy-gate.js:17`). 승인 후 PROJECT.md 만 변경하면 fingerprint 그대로 → 검증 우회.
- **codex-M1. 문서 내부 자기모순.** 한쪽: caller 가 mode 모르고 value 만 비교. 다른 쪽: sentinel payload 에 mode 포함 → 즉시 reject. 양립 불가.
- **codex-M2. 마이그레이션 범위 불완전.** `git rev-parse` callsite 교체만 명시. 실제 state/approval 데이터는 여전히 `head_sha` 직렬화 (`templates/hooks/_lib/sentinel.js:61`, `templates/hooks/_lib/dispatch-state.js:70`). 일부 gate 만 fingerprint 로 전환 시 신뢰모델 분열.
- **codex-Seq.** `hsf doctor --migrate-fingerprint-mode` 는 그 명령 자체가 신설된 뒤에야 의미. 현 CLI 는 init/update/list/help 만.

### Resolution

#### H

- **H1 → [1] accept.** tree-hash 입력 정규화 명세:
  ```
  텍스트 파일 (.cls / .trigger / .js / .ts / .html / .css / .xml /
                .json / .yaml / .yml / .md / .page / .component):
    - line ending: CRLF/CR → LF 변환
    - encoding: UTF-8, BOM 제거
    - trailing newline: 보존 (의미 있는 차이)
  바이너리 (.resource staticresource zip 내부, 이미지 등):
    - raw bytes
  파일 종류 감지: 확장자 우선, magic byte 폴백.
  ```
  정규화 후 sha256.

- **H2 → [2] modified accept.** TTL 자체 변경. timestamp 모드에선 fingerprint 비교 **스킵**하고 weak-trust 경고만:
  ```
  ⚠ fingerprint mode: timestamp (weak)
    → 동일성 검증 없이 TTL 만 적용. git 또는 force-app 추가 권장.
  ```
  TTL 은 sentinel 발급 시점 기준 24시간 (세션 단위 추정). git/tree-hash 모드에선 기존 30분 유지.

#### M

- **M1 → [1] accept.** 캐시 키를 `{mtime, size}` 조합. 둘 중 하나만 변경되어도 재계산. 충돌 가능성 무시 가능 수준.
- **M2 → [1] accept.** mode 전환 절차 명령 신설: `hsf doctor --migrate-fingerprint-mode`. 이 명령이 in-flight design.md 의 `state.deploy.last_validation` 과 `state.design.approved_*` 를 reset + audit.log 에 기록.
- **M3 → [1] accept.** 기본 동작을 ".gitignore 존재 시 그것 사용 + git 없으면 default exclude" 로 변경. PROJECT.md `fingerprint.exclude` 는 추가 패턴만 (override 가 아닌 union).

#### L

- **L1 → [1] accept.** 우선순위: `force-app/` 존재 시 그것 우선, 없으면 `src/`, 둘 다 없으면 timestamp 모드. 이행기 프로젝트는 PROJECT.md `fingerprint.scope` 로 명시.
- **L2 → [3] defer.** 비용 측정은 PR 1 머지 후 실측 + 임계 초과 시 캐시 강화. 사전 측정은 PR 차단하지 않음.

#### Updated design changes (revision: 2)

1. tree-hash 정규화 알고리즘 본문 추가 (Tree-hash 산출 정책 절).
2. timestamp 모드 의미 변경 — 비교 스킵 + weak-trust 경고. TTL 24시간.
3. `hsf doctor --migrate-fingerprint-mode` 명령 신설 명세.
4. `.gitignore` + default exclude + PROJECT.md union 정책 명시.
5. force-app/src 우선순위 표 추가.
