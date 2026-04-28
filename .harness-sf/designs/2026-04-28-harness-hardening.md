---
type: feature
name: harness-hardening
date: 2026-04-28
author: mjkang2539
status: draft-v2
revision: 2
---

# harness-sf 측정·재현·안전·관측·제어 보강

## Why (배경 / 문제)

현재 `harness-sf` 는 "agent harness" 의 **제약(guardrails)** 측면은 탄탄하다 — templates/agents 와 templates/skills 의 분리, ensure-mode invariants, 5-persona 리뷰, 호출 그래프 강제 등. 그러나 harness 의 본질인 **측정 가능성(measurability)** 과 **재현성(reproducibility)** 이 비어 있다.

구체적 공백:

1. prompt 변경이 회귀를 일으켜도 자동 감지 불가 (`npm test` 는 `--help` 스모크일 뿐).
2. 모델 업그레이드 (Opus 4.7 → 4.8 등) 시 영향도 측정 수단 없음.
3. 생성된 Apex/LWC 의 보안/품질이 *프롬프트 약속* 에만 의존 — 정적 검증 layer 부재.
4. skill 실행 비용/실패 패턴이 보이지 않음.
5. 사용자가 force-app 수정 없이 출력 미리보기 불가.

목표: harness 가 시간이 갈수록 silently drift 하지 않도록 자가 검증 골격을 갖춘다.

### Incident 근거 (2026-04-28 작성 시점)

명시적으로 기록된 사례는 **없음** (CEO 리뷰 지적 반영). 이 plan 은 **예방적 인프라**임을 인정한다. 따라서 본 design 의 우선순위 결정은 다음 원칙을 따른다:

- **Phase 1, 2, 3 는 사례 없이도 정당화** — drift/credential 누출/생성 코드 결함은 incident 가 발생한 시점엔 이미 사용자 신뢰 손실. 보험 성격.
- **Phase 4, 5 는 "실사용 데이터 X 건 누적 후 재평가" 게이트 적용** — 주간 skill 실행 N 건 미만이면 backlog. N 의 구체값은 Decisions 에서 결정.
- **Phase 1 fixture 8개도 incident 없는 가설 작업** — 첫 사례 발생 시 fixture 1개 추가가 더 정확한 회귀 방지가 됨. 8개를 mandatory 가 아니라 starter set 으로 취급.

## Non-goals

- Salesforce 도메인 자체에 대한 새 skill 추가.
- installer (`bin/install.js`) 의 zero-dep 원칙 변경.
- templates/ 의 single-source-of-truth 원칙 변경.
- 실제 production org 에 대한 통합 테스트 (fixture 만 사용).

## 설계 원칙

- **installer zero-dep 유지** — 새 인프라는 `harness/` 또는 `tools/` 로 격리.
- **templates/ 는 단일 진실의 원천** — 새 검증 layer 는 templates 를 *읽지만* 수정하지 않음.
- **점진적 도입** — 각 phase 가 독립적으로 가치가 있어야 함 (중간에 멈춰도 손해 없음).
- **Fixture 기반 우선** — 실제 org 의존성 제거, CI 가능.

## Architecture

```
harness-sf/
├── templates/                  # 기존, 변경 없음
├── bin/install.js              # 기존, zero-dep 유지
├── harness/                    # NEW — 측정/검증 인프라 (dep 허용)
│   ├── package.json            #   별도 package — installer 와 격리
│   ├── fixtures/               # Phase 1
│   ├── runner/                 # Phase 1, 2
│   ├── eval/                   # Phase 1
│   ├── lint/                   # Phase 3
│   ├── observability/          # Phase 4
│   └── replay/                 # Phase 5
└── .harness-sf-runs/           # gitignored — 로컬 run log
```

---

## Phase 0: 인프라 토대 + 계약 정의 (5~7일, **확장**)

리뷰 반영: Phase 1/2/3/5 가 모두 의존하는 계약(인터페이스/스키마/enum)을 Phase 0 에서 동결한다. 그렇지 않으면 후행 phase 에서 역방향 재작업이 발생.

### 0.1 산출물 (인프라)

- `harness/package.json` (vitest, zod, 정적 분석 deps), `package-lock.json` 커밋, `npm ci` 강제.
- `harness/README.md` — Phase 별 사용 가이드.
- root `.gitignore` 업데이트 (`.harness-sf-runs/`, `harness/node_modules`).
- root `package.json` `workspaces: ["harness"]` — **확정 (선택 아님)** — CI 단일 entrypoint 위해.

### 0.2 산출물 (계약 — 후행 phase 가 모두 의존)

#### 0.2.a `AgentRunner` 인터페이스 초안

```ts
interface AgentRunner {
  invoke(input: {
    skillOrAgent: string;          // e.g. "sf-trigger-auditor"
    fixturePath: string;
    modelId: string;               // pin 강제, alias 금지 — date-stamped
    decisions?: DecisionsFile;     // AskUserQuestion mock
    onTrace?: (e: TraceEvent) => void;  // schema-agnostic emit
  }): Promise<RunResult>;
}
```

- SDK 의존성을 이 인터페이스 뒤로 격리. `@anthropic-ai/claude-agent-sdk` 를 우선 선택하되, 직접 Messages API 백엔드도 1주 안에 swap 가능한 형태.
- SDK 버전 pin 정책: `=X.Y.Z` exact, 분기별 업그레이드 PR.

#### 0.2.b `decisions.json` schema (AskUserQuestion mock)

```ts
type DecisionsFile = {
  version: 1;
  responses: Array<{
    skill: string;
    questionId: string;       // skill 이 부여하는 안정적 ID — 텍스트 매칭 금지
    answer: string | string[];
    deviationFromRecommend?: string;  // recommend 외 선택 시 사유
  }>;
  onMissing: "fail" | "use_recommend";  // mock 누락 시 동작
};
```

- skill 측 작업: 각 AskUserQuestion 호출에 `questionId` 부여 의무화 — 질문 텍스트가 변해도 mock 이 살아남음.
- runner 측: tool_call 인터셉터로 `user_question` 도구 후킹 → `questionId` 로 lookup.

#### 0.2.c run-log schema (Phase 2 가 사용)

```
runs/{ISO}/
├── meta.json         # 화이트리스트 필드만 (보안)
├── input.md          # design.md 스냅샷 (redaction 적용)
├── trace.jsonl       # turn-level: {turn, tool, input_hash, output_hash, tokens}
├── decisions.md      # 사용자 답변 (redaction 적용)
└── output-diff.patch # force-app 변경
```

`meta.json` 화이트리스트 (그 외 필드 기록 금지):

```ts
type Meta = {
  schemaVersion: 1;
  skill: string;
  modelId: string;          // date-stamped
  sdkVersion: string;
  startedAt: string; finishedAt: string;
  tokens: { input: number; output: number; cache_read: number };
  costUsd: number;
  failureClass?: FailureClass;  // 0.2.e
  fixturePath?: string;          // optional, fixture 실행 시
};
// process.env, headers, args 전체 dump 금지.
```

`trace.jsonl` granularity: turn 단위. **HTTP 헤더, Authorization, raw API key 절대 미포함** — runner adapter 책임.

#### 0.2.d `expected.json` schema + 매칭 규칙

```ts
type Expected = {
  intentionallyVulnerable?: boolean;  // fixture 가 의도적 취약 코드 포함 표시
  findings: Array<{
    category: string;           // closed enum, e.g. "trigger.recursion"
    severity: "high" | "medium" | "low";
    locator?: { file: string; symbol?: string };  // optional, partial credit
  }>;
};
```

매칭 규칙 (Phase 1 score.ts 가 사용):
- **카테고리는 closed enum exact match**. 텍스트 변형 허용 안 함 — agent 출력에서 `category` 토큰을 명시적으로 emit 하도록 prompt 조정 필요.
- **severity 불일치는 partial credit 0.5** (정답 카테고리는 잡았으나 심각도 오판).
- **locator 일치는 partial credit 추가** (file 일치 +0.25, symbol 일치 +0.25).
- **expected 에 없는 finding 발견 → false positive** (`clean-baseline` 의 핵심).
- **expected 에 있으나 출력에 없음 → false negative** (recall 분모).

#### 0.2.e `failure_class` enum (Phase 2/3/4 가 사용)

```ts
type FailureClass =
  | "intent_insufficient"
  | "review_loop_exhausted"
  | "context_overflow"
  | "tool_denied"
  | "lint_failed"
  | "deploy_failed"
  | "user_abort"
  | "runner_error"
  | "mock_missing";       // decisions.json 에 응답 없음
```

#### 0.2.f Snapshot 정규화 정책 결정

**선택: exact match 노선** (의미 단위 비교는 별도 design 으로 backlog).

정규화 대상 (exhaustive — Phase 1 구현 시 추가 발견 시 design 업데이트):

1. ISO 타임스탬프 → `<TS>`.
2. UUID v4 → `<UUID>`.
3. 절대 경로 → `<ABS>` (workspace root 기준 relative 만 유지).
4. 토큰/비용 수치 → `<N>` (run log 외 출력에서).
5. SF 15/18-char ID → `<SFID>`.
6. e-mail → `<EMAIL>`.
7. `sk-ant-*`, `Bearer *`, Authorization 패턴 → `<REDACTED>`.
8. 줄 끝 공백 trim, 연속 빈 줄 1개로 압축.
9. 마크다운 표 정렬 공백 → 단일 공백.

**미적용**: 한국어 조사 변형, 동의어, 번호 매기기 — drift 신호로 간주.

`harness/runner/normalize.ts` 단일 모듈로 구현, 단위 테스트 mandatory.

### 0.3 Phase 0 Definition of Done

- 위 6개 계약 문서 (`harness/contracts/*.md`) 작성 + `zod` schema 코드.
- `AgentRunner` mock 구현체 (실제 LLM 호출 없이 fixed 출력 반환) — Phase 1 fixture 작성자가 contract test 가능.
- 정규화 모듈 + 단위 테스트 통과.
- CI workflow skeleton (job 정의만, 실제 실행 없음).

---

## Phase 1+3a: Eval/Fixture + 즉시 가능한 Static Lint **병행** (2~3주)

리뷰 반영 (CEO HIGH): Phase 3 의 lint rule 중 **LLM 호출 없이 즉시 적용 가능한 부분 (Phase 3a)** 을 Phase 1 과 병행. fixture 가 lint rule 을 trigger 하는지 cross-phase 검증을 동일 PR 사이클에서 처리 (QA [필수] 반영).

- **Phase 3a (병행)**: PMD/eslint 정적 lint — LLM 무관, 비용 0. `with sharing` 누락, 하드코딩 ID, dynamic SOQL escape 누락 rule. 첫 2주 warn-only, 그 후 error.
- **Phase 3b (Phase 2 의존, 후행)**: `@AuraEnabled` 시그니처 호환성 — run log 와의 비교가 필요하므로 Phase 2 후로 이동.

### Phase 1 본문 (eval)

### 1.1 Fixture 큐레이션

**Starter set 8개** (incident 발생 시 추가 — mandatory 아님).

`harness/fixtures/sfdx-projects/` 아래 시나리오별 박제. 각 fixture 디렉터리:

```
{name}/
├── force-app/                  # 최소 sfdx 레이아웃
├── sfdx-project.json
├── expected.json               # 기대 finding 카테고리 + 심각도
└── README.md                   # 의도 1~2문단
```

초기 fixture 목록:

| Fixture | 의도 | Expected findings |
|---|---|---|
| `trigger-recursion` | Account 트리거 2개 recursion | sf-trigger-auditor recursion flag |
| `flow-trigger-conflict` | Before-Save Flow + Apex Trigger | OOE 충돌 경고 |
| `fls-missing-apex` | with sharing 누락 + FLS 미체크 SOQL | security reviewer high risk |
| `governor-limit-lwc` | @wire N+1 패턴 | sf-lwc-auditor anti-pattern |
| `mixed-dml` | Setup/non-setup DML 섞임 | trigger auditor |
| `hardcoded-id` | Profile/RecordType ID 하드코딩 | lint + security reviewer |
| `library-already-installed` | npm/04t 기 설치됨 | library reviewer 재추천 안 함 |
| `clean-baseline` | 문제 없는 정상 프로젝트 | findings 0 (false-positive 측정) |
| `negative-malformed` | `sfdx-project.json` 누락, 빈 Apex | runner graceful failure (`runner_error` emit, crash 금지) |
| `bulk-200-classes` | 200+ Apex class | `context_overflow` 임계 측정용 — Phase 4 budget gate 검증 |
| `composite-multi-finding` | recursion + FLS 누락 동시 | score.ts multi-finding 계산 검증 (QA 권장 반영) |

**Fixture 박제 규칙 (Security HIGH 반영)**:

- 모든 취약 코드 fixture Apex 파일 상단에 표준 헤더:
  ```
  // INTENTIONALLY VULNERABLE — harness-sf test fixture only.
  // NOT for deployment. See expected.json `intentionallyVulnerable: true`.
  ```
- 가짜 SF ID 형식: `001FIXTURE000000001` (실제 ID 형식과 구분).
- repo 루트 `.gitleaks.toml` / `.trufflehog.yml` 에 `harness/fixtures/**` 제외 규칙 추가.

### 1.2 Skill/Agent runner

`harness/runner/run-skill.ts` — fixture 위에서 skill 또는 agent 1개 실행, 출력 캡처.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) 사용.
- 모델 ID 명시 강제 (env 또는 CLI arg).
- 출력 정규화: 타임스탬프, UUID, 절대 경로 마스킹.

### 1.3 Snapshot 회귀

`harness/eval/snapshots/{skill}/{fixture}.snap.md` 저장. vitest `toMatchFileSnapshot`. prompt 수정 시 diff 검토 후 의도된 변경만 update.

### 1.4 점수화 (precision/recall)

`harness/eval/score.ts` — fixture `expected.json` 과 실제 output finding 카테고리 매칭. 각 agent 별 P/R 누적 → `harness/eval/reports/{date}.json`.

### 1.5 CI

GitHub Actions:
- PR 마다: 빠른 snapshot diff (모델 호출 없이 기존 snapshot 비교).
- Nightly: 전체 fixture × skill 행렬 + 점수화.
- 비용 캡: 1회 실행 < 합의된 $X.

**완료 조건**: snapshot 회귀로 prompt drift 자동 감지 + 점수 trend 그래프 1개.

---

## Phase 2: 결정론성 / Run log (3~5일)

### 2.0 Redaction layer (Security HIGH ×3 → 단일 모듈)

**모든 run log 쓰기는 redaction pass 통과 필수**. 위치: `harness/runner/redact.ts`.

대상 패턴 (정규식 + 단위 테스트):
- SF 15/18-char ID (`[a-zA-Z0-9]{15,18}` + 첫 3자 prefix 검증) → `<SFID>`
- `sk-ant-[A-Za-z0-9_-]+` (Anthropic API key) → `<ANTHROPIC_KEY>`
- `Bearer\s+[A-Za-z0-9._-]+` → `<BEARER>`
- e-mail (`[^\s@]+@[^\s@]+\.[^\s@]+`) → `<EMAIL>`
- AWS access key (`AKIA[0-9A-Z]{16}`) → `<AWS_KEY>`
- 절대 경로 → workspace-relative.

적용 지점:
- `input.md`, `decisions.md` 디스크 쓰기 직전.
- `trace.jsonl` 의 모든 line.
- `meta.json` 은 화이트리스트만 쓰므로 redaction 불필요 (이중 안전망으로 zod validation 강제).

`AgentRunner` adapter 책임:
- HTTP request/response 헤더는 trace 에 절대 포함 금지 (Authorization, x-api-key 등).
- SDK 가 헤더를 노출하는 경우 adapter 가 strip.

`.gitignore` guard: `harness/runner/run-log.ts` 가 `.harness-sf/runs/` 첫 생성 시 소비 프로젝트 `.gitignore` 에 항목 존재 확인, 없으면 추가. `git add` 가 이미 실행되었을 가능성에 대비해 대시보드 첫 페이지에 경고 배너.

### 2.1 Run log 표준 schema

Phase 0.2.c 에서 정의된 schema 를 사용. `templates/skills/_shared/run-log-schema.md` — 모든 skill 의 종료 단계에 run log 작성 의무. 위치: 소비 프로젝트의 `.harness-sf/runs/{ISO}/`.

```
runs/2026-04-28T14-22-01/
├── meta.json         # skill 이름, 모델 ID/버전, 토큰, 비용, 소요시간
├── input.md          # design.md 스냅샷
├── trace.jsonl       # agent 호출 시퀀스
├── decisions.md      # AskUserQuestion 답변
└── output-diff.patch # 실제 force-app 변경 diff
```

### 2.2 모델 pin 강제

각 agent frontmatter `model:` 필드 통일. 검증 스크립트 `harness/lint/check-model-pins.ts` → CI gate.

### 2.3 Eval 통합

Phase 1 runner 가 run log 도 생성. 모델 변경 시 run log 비교로 영향도 측정.

**완료 조건**: 모든 skill 실행이 run log 남김 + 모델 pin CI gate 통과.

---

## Phase 3: 정적 안전 검증 layer (1주)

### 3.1 Apex linter

`harness/lint/apex-rules.ts` — PMD ruleset + 커스텀 rule:
- `with sharing|without sharing|inherited sharing` 명시 누락 → error
- 하드코딩 15/18-char ID 정규식 → error
- `Database.query(...)` String 인자에 `String.escapeSingleQuotes` 미적용 → error
- `Schema.sObjectType.X.fields.Y.isAccessible/isUpdateable` 누락한 SOQL/DML → warn
- `@AuraEnabled` 메서드 시그니처 호환성 (run log 비교) → error

PMD 6.55+ 를 `harness/lint/vendor/` 에 vendoring (offline CI).

### 3.2 LWC linter

`@salesforce/eslint-plugin-lwc` + `@lwc/eslint-plugin-lwc` 통합.

### 3.3 Skill 통합

`/sf-apex`, `/sf-lwc` 의 코드 생성 후 → `sf-deploy-validator` 직전에 lint gate. 실패 시 자동 재생성 루프 (max 2회).

### 3.4 Mandatory deploy-validator gate

기존 *권장* → *생략 시 skill 종료 거부* 로 격상.

**완료 조건**: Phase 1 fixture `fls-missing-apex`, `hardcoded-id` 가 lint 만으로도 잡힘.

---

## Phase 4: Observability (3~5일)

### 4.1 Token/cost 추적

`meta.json` 집계 → `harness/observability/aggregate.ts` → `.harness-sf/metrics.json` (skill 별 P50/P95 토큰, 비용, 소요시간).

### 4.2 Composite skill budget

`/sf-feature` 가 dispatch 한 sub-skill 누적 토큰 watch. 임계값 (예: 500K) 초과 시 사용자 확인 게이트.

### 4.3 Failure taxonomy

run log 실패 종료 시 `failure_class` 필수: `intent_insufficient | review_loop_exhausted | context_overflow | tool_denied | lint_failed | deploy_failed | user_abort`.

### 4.4 Dashboard

정적 HTML 대시보드 (`harness/observability/dashboard/`). `harness/metrics.json` fetch 하는 단일 페이지.

**완료 조건**: skill 별 비용/실패 분포 가시화.

---

## Phase 5: Control surface (3~5일)

### 5.1 Skill dry-run

skill invocation `--dry-run` arg. ensure-mode approval gate 를 diff 출력 후 종료로 단축. 5 artifact skill + sf-feature 모두 적용.

### 5.2 Replay

`harness/replay/replay.ts` — run log `input.md` + `decisions.md` 동일 모델 재실행. 출력 hash 비교 → 안정성 측정 (같은 입력 → 같은 출력 비율). nightly 점수에 "stability %" 추가.

### 5.3 Bisect 도구

prompt 회귀 발생 시 git bisect + harness eval 결합 스크립트.

**완료 조건**: dry-run 출력 미리보기 + 회귀 commit 자동 식별.

---

## 실행 순서 / 의존성

```
Phase 0 (인프라)
  └─> Phase 1 (eval) ──┬──> Phase 2 (run log)
                       │       └──> Phase 4 (observability)
                       │       └──> Phase 5 (replay/bisect)
                       └──> Phase 3 (lint)
```

**총 예상 기간**: 4~6주 (full-time 1명).

## Decisions

revision 2 에서 확정된 항목 (사용자 confirm 대상):

| # | 항목 | 결정 | 사유 |
|---|---|---|---|
| D1 | Phase 1 vs Phase 3 순서 | **병행 (Phase 3a 분리)** | LLM 무관 lint 는 비용 0/즉시 가치. 3b 만 후행. |
| D2 | Phase 4/5 게이트 | **주간 skill 실행 N=20 누적 시 가동** (confirm 완료) | 1인 사용 + 가벼운 실험에서도 의미 있는 분포. 1~2개월 후 재검토. |
| D3 | Phase 0 확장 | **5~7일로 확장, 6개 계약 산출물 mandatory** | 후행 phase 의 역방향 의존 차단. |
| D4 | Snapshot 정규화 노선 | **exact match + exhaustive 정규화 목록** | 의미 단위는 별도 design. |
| D5 | 모델 pin | **alias 유지 (`claude-opus-4-7`)** *(deviation from recommend)* | 사용자 선택: 편의성 우선 + Anthropic point release 자동 수용. **부수 효과 — drift 감지 layer 추가 필요**: alias 가 silently 바뀌면 snapshot/stability 가 모델 변경을 prompt 변경으로 오판할 수 있음. 완화책: run log `meta.json` 에 SDK 가 반환하는 actual model id 기록 (alias 가 아닌 실제 resolve 된 ID), 변경 발생 시 metrics dashboard 에 alert. |
| D6 | PMD 전략 | **크기와 무관하게 vendoring 유지 + SHA-256 체크섬** *(deviation from recommend)* | 사용자 선택: offline CI/재현성 절대 우선. clone/storage 비용 감수. **완화책**: vendor 디렉터리 별도 git-lfs 미사용 + Dependabot/Renovate 로 PMD 업데이트 가시화. repo `.gitattributes` 에 binary 표기. |
| D7 | Lint 강제력 | **첫 2주 warn-only → error** | 도입 마찰 최소화. |
| D8 | PR 분할 | **Phase 0 → Phase 1+3a → Phase 2 → Phase 3b → Phase 4 → Phase 5** | 5개 PR, 각자 독립 가치. |
| D9 | workspaces | **확정 사용** | CI 단일 entrypoint. |
| D10 | Test 한계 명시 | **"correctness 아닌 consistency" design 본문 박제** | 의미 검증은 backlog (`harness-semantic-eval`). |
| D11 | run log 위치 | **소비 프로젝트 `.harness-sf/runs/` + `.gitignore` guard + redaction 의무** | 격리성 + 보안. |
| D12 | LWC eslint plugin | **`@salesforce/eslint-plugin-lwc` 단독** | 관리/문서화 우위. |

confirm 완료 (2026-04-28):
- D2: N=20 확정.
- D5: alias 유지 (deviation, 위 사유 박제).
- D6: vendoring 유지 (deviation, 위 사유 박제).
- D8: 5-PR 분할 확정.

## 트레이드오프 / 결정 필요 지점 (이력)

1. **CI 비용 전략**: (a) self-hosted runner + 캐시 / (b) **[recommend]** PR 마다 affected fixture 만 / (c) 주 1회 nightly 만. — 추천 사유: PR 빠른 피드백 + 비용 통제.
2. **PMD vendoring vs Docker**: **[recommend]** vendoring (offline CI 가능, repo 크기 ~30MB 증가) / Docker (setup 부담).
3. **Run log 위치**: **[recommend]** 소비 프로젝트 `.harness-sf/runs/` + `.gitignore` 자동 추가 / 사용자 홈.
4. **모델 pin 엄격도**: **[recommend]** alias (`claude-opus-4-7`) 유지 + run log 로 drift 감지 / date-stamped (매번 업그레이드 PR 필요).
5. **Phase 3 lint 강제력**: **[recommend]** 첫 2주 warn-only → error 승격 / 처음부터 error.
6. **PR 분할**: **[recommend]** Phase 0+1 먼저 PR 1개 → 나머지 단계별 PR / 5개 한 번에.

## 알려진 리스크 (revision 2 잔여)

revision 2 에서도 완전히 해소되지 않은 이슈 — 구현 중 monitoring:

- **Agent SDK 의 tool_call 인터셉트 가능성**: Phase 0 의 `decisions.json` mock 주입은 SDK 가 user_question 도구 후킹을 허용한다는 가정. SDK 확인 후 불가 시 직접 Messages API 백엔드로 swap (D5 의 인터페이스 격리 덕분에 1주 내 가능).
- **Phase 3a 자동 재생성 루프 max 2회 후 동작**: `lint_failed` 종료 시 force-app 부분 출력 정책 — 구현 시 `templates/skills/_shared/lint-gate.md` 에 명시.
- **Stability 임계값 80%**: 임의 설정. Phase 5 가동 후 분포 데이터 수집 후 재조정.
- **Fixture 8개 starter set 의 충분성**: incident 기반 추가 정책 — repo 에 `harness/fixtures/CONTRIBUTING.md` 로 fixture 추가 절차 박제.
- **D5 alias drift**: Anthropic 이 alias 뒤에서 모델을 교체하면 snapshot 전체가 한 번에 깨질 수 있음. 완화책으로 `meta.json` 에 SDK resolved model id 기록 + dashboard alert 를 박았으나, 실제 교체 발생 시 의미 있는 회귀와 모델 변경을 사람이 수동 분리해야 함. 첫 alias 교체 사례 후 재평가 필요.

## Edge cases / 미확정 영역

- **Fixture 의 SFDX 의존성**: `sfdx-project.json` 만 있고 실제 `sf` CLI 없이 정적 분석만 한다고 가정. deploy-validator 통합 fixture 는 별도 marker 필요.
- **Agent SDK API 변경**: `@anthropic-ai/claude-agent-sdk` 가 아직 활발히 진화 중 — runner 추상화 layer 한 겹 두기.
- **Skill 의 사용자 입력 의존성**: AskUserQuestion 결과를 fixture 에 어떻게 박제할지 — `decisions.json` 사전 정의 + runner 가 mock 응답 주입.
- **Snapshot 의 모델 비결정성**: temperature 0 도 완벽 결정론 아님 — Phase 5 의 stability % 가 그 측정 수단.

## Test Strategy

### 핵심 한계 (QA 리뷰 반영 — design 차원에서 명시)

**본 harness 의 측정은 "정확성(correctness)" 이 아니라 "일관성(consistency)" 을 검증한다.**

- Snapshot regression: 출력이 *같은가* 만 본다. 모델이 동일하게 잘못된 결론을 내려도 통과.
- Stability %: 동일 입력에 동일 출력이 나오는가만 본다. "동일하게 나쁜 출력" 도 stable.
- Precision/Recall: `expected.json` 이 ground truth 라는 가정. fixture 작성자의 판단이 곧 정답 — fixture 자체의 오류는 잡지 못함.

이 한계는 의도적 trade-off 다. 의미 단위 정확성 검증(LLM judge, embedding distance, 사람 검수)은 별도 design 으로 backlog (`harness-semantic-eval`). 본 plan 은 **drift detection 골격** 까지가 scope.

### 검증 layer

- **Unit**: `score.ts` 매칭 로직, `normalize.ts` 정규화, `redact.ts` 정규식, lint rule 각각.
- **Contract**: zod schema (`expected.json`, `decisions.json`, `meta.json`) 위반 시 fail-fast.
- **Integration**: `clean-baseline` fixture 에 모든 skill 실행 → false positive 0. `negative-malformed` → `runner_error` graceful emit.
- **Cross-phase**: Phase 1 fixture × Phase 3a lint rule 매트릭스 — 각 fixture 의 `expected.json` 에 lint finding 도 enumerate. `fls-missing-apex` 의 Apex 코드가 실제로 lint rule 을 trigger 하는지 PR 머지 전 확인.
- **Regression**: snapshot diff (Phase 1.3) + snapshot update governance (아래).
- **Stability**: 동일 fixture 5회 replay → 정규화된 output 의 hash 분포. **5회 표본은 starter** — 분산 ≥ 임계 시 표본 확대. 임계: stability < 80% 면 prompt/모델 재검토 신호 (의사결정용 trigger 정의).

### Snapshot Update Governance (QA [필수] 반영)

PR 에서 snapshot diff 발생 시 reviewer 체크리스트:
1. prompt/agent 파일 변경이 동반되었는가? — Yes 면 의도된 변경 후보.
2. diff 가 정규화 누락 패턴을 노출하는가? — Yes 면 정규화 보강 PR 분리.
3. 의미 변화 vs 표현 변화 — 평가 카테고리/severity 변경은 의미, 문장 순서/조사는 표현. 표현 변경이 다수면 정규화 부족 신호.
4. 동일 PR 에 unrelated snapshot drift 가 같이 있는가? — Yes 면 split.

체크리스트는 `harness/CONTRIBUTING.md` 에 박제.

## Reviews

리뷰 일자: 2026-04-28. CEO / Eng / Security / QA 4-persona. Library reviewer 는 본 design 이 SF 라이브러리 채택이 아니라 Node 인프라 plan 이므로 제외.

### CEO (approve-with-tradeoffs)

- **[high]** Phase 1 (eval) 최우선이 맞는가 — Phase 3 (lint) 가 비용 0/즉시 가치라 선행 또는 병행 권유.
- **[high]** `@anthropic-ai/claude-agent-sdk` 의존 위험 — adapter 경계 설계가 SDK 선택보다 중요.
- **[medium]** Why 의 비즈니스 결과 불분명 — 실제 incident 사례 한 단락 추가 권유 (없으면 scope 절반 축소 근거).
- **[medium]** Phase 4/5 ROI 의심 — 실사용 규모 데이터 없이 대시보드/replay 의 가치 측정 어려움. backlog 이동 검토.
- **[medium]** 롤백 계획 부재 — Phase 3.3 의 "skill 에 lint gate 삽입" 이 templates/ 수정인지, 그렇다면 "templates 는 읽지만 수정하지 않음" 원칙과의 충돌 해소 필요.
- **[low]** PMD vendoring 30MB — 커스텀 rule 이 핵심 가치면 OK, 아니면 관리형 Action.

### Eng (approve-with-risks)

- **[high]** Agent SDK runner 추상화가 과소 명세 — `AgentRunner` 인터페이스(메서드 시그니처) 를 Phase 0 산출물에 넣어야 함. SDK 버전 pin 정책 필요.
- **[high]** Snapshot 정규화 전략 불완전 — exact match vs 의미 단위 비교 결정 필요. 미결정 시 noise/blind 양극단.
- **[high]** AskUserQuestion mock 프로토콜 미정 → Phase 1 CI 차단 가능 — Phase 0 으로 이동 필요.
- **[medium]** Phase 2 → Phase 1 역방향 의존 (run-log schema) — schema 를 Phase 0 산출물에 포함하거나 runner 를 schema-agnostic 으로.
- **[medium]** PMD 실제 크기 60–80MB 가능 — 측정 후 Decisions 에 명시.
- **[medium]** lint gate 자동 재생성 max 2회 후 실패 동작 미정.
- **[medium]** Dashboard 의 metrics.json fetch 경로 — file:// CORS 이슈, generate-time inline HTML 권유.
- **[low]** workspaces 여부 미결정, stability 표본/비용 미정, `expected.json` schema 부재.

### Security (approve-with-risks)

- **[high]** Run log credential/PII 누출 — `decisions.md`/`trace.jsonl` 평문 저장. SDK trace 가 Authorization 헤더 포함 시 API key 누출. **redaction pass + meta.json 화이트리스트 + .gitignore guard 필수**.
- **[high]** Fixture 의 취약 코드 박제 — GitHub Code Search 노출 + secret scanner 오탐. 표준 주석/`intentionally_vulnerable` 플래그/가짜 ID 형식 (`001FIXTURE000000001`).
- **[high]** Replay PII 재실행 — replay 전 redaction. nightly 는 PII-free fixture 만.
- **[medium]** Agent SDK API key 관리 — `process.env` 전체 dump 금지, 필드 화이트리스트.
- **[medium]** PMD vendoring supply chain — SHA-256 체크섬 검증 + `CHECKSUMS.txt`.
- **[medium]** npm supply chain — `package-lock.json` 커밋 + `npm ci`. `@salesforce/eslint-plugin-lwc` vs `@lwc/eslint-plugin-lwc` 둘 중 선택 명시.
- **[low]** Dashboard 외부 lib SRI hash. design.md frontmatter `author` e-mail 평문 노출.

### QA (approve-with-missing-cases)

- **[필수]** Negative fixture 부재 (구조 비정상 케이스). Bulk fixture 부재 (200+ 클래스). 복합 anti-pattern fixture 부재.
- **[필수]** 정규화 범위 미명시 — flake 위험. Snapshot update 거버넌스 (의도된 변경 vs drift 판단 체크리스트) 없으면 회귀 잡기 → 변경 저항 으로 변질.
- **[필수]** P/R 매칭 기준 미정의 (exact / substring / 카테고리 계층). false negative 판정 로직 없음.
- **[필수]** `decisions.json` schema 미정의 → skill 질문 변경 시 전부 깨짐 (coupling 미완화).
- **[필수]** Stability 5회 표본 근거 없음, hash 비교가 정규화 전/후 어디인지 불명, 임계값 없음.
- **[필수]** Phase 1 fixture 가 Phase 3 lint rule 을 실제 trigger 하는지 cross-phase 검증 절차 없음. `expected.json` migration 계획 부재.
- **[권장]** Permission fixture, deviation path 커버리지 부재.
- **핵심 한계**: 현 Test Strategy 는 "정확성" 이 아닌 "일관성" 측정 — snapshot/stability 모두 "동일하게 잘못된 출력" 도 통과시킴. design 이 이 한계를 명시적으로 인식해야 함.
