---
type: feature
name: design-rigor-gates
date: 2026-04-28
author: mjkang2539
status: implemented
revision: 1
---

# 설계 깊이 강제: artifact 단독 호출 차단 + review iteration 루프

## Why (배경 / 문제)

사용자 운영 원칙: **"설계에 대부분의 시간을 쏟고 확실한 결과를 만든다."**

현재 `harness-sf` 는 design-first 게이트를 `/sf-feature` 경로에만 두고 있어 두 가지 회피 경로가 열려 있다:

1. **단독 artifact 호출 우회** — `/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-field`, `/sf-aura` 를 standalone 으로 부르면 5-persona 리뷰가 생략되고 자체 단일 review 만 실행. "빠르게 한 개만" 의 유혹에 design 시간이 깎인다.
2. **Review iteration 루프 부재** — 5-persona 리뷰가 우려를 산문으로 출력하면 hook 은 `block` verdict 만 본다. 우려의 심각도 구분이 없고, 해결 의무가 design.md 에 기록되지 않으며, block 해소 후 재검토가 강제되지 않는다. 첫 라운드 품질에 결과가 좌우된다.

목표: 두 우회로를 기계적으로 막아 design 단계에 의도적으로 시간이 쏟이도록 한다.

### Incident 근거

명시적 incident 없음 — 예방적 강화. 정당화 근거:

- 단독 artifact 스킬은 5개, 각각이 5-persona 리뷰를 우회하는 첩경. 사용자가 "이건 작은 변경이니까" 로 회피하는 순간 원칙은 무너진다.
- review 산문에 묻힌 `block` 이 design.md 본문에 명시 해결 없이 dispatch 로 흘러간 경험은 prompt-trust 의존성이 있는 모든 LLM workflow 의 공통 risk.

## Non-goals

- 새 reviewer persona 추가.
- 단일 artifact 작업 자체를 금지 (수정만 허용 형태).
- review 출력 산문화 폐지 — 현재의 자유 형식 위에 구조화 layer 만 얹는다.
- 무한 루프 방지를 위한 자동 override (사용자 명시 결정 요구).

## 설계 원칙

- **Hook/sentinel 강제, prompt-trust 금지** — 모든 게이트는 `_lib/sentinel.js` 패턴 따른다.
- **기계 파싱 가능한 review 출력** — severity 라벨은 reviewer 출력 스키마에 명시.
- **Resolution log 는 design.md 본문** — 별도 파일 아님, 단일 진실 원천 유지.
- **Targeted re-review** — block 한 persona 만 재실행, 5명 전체 재돌리지 않음.

## Architecture

### A. 단독 artifact 호출 게이트

```
사용자: /sf-apex AccountTriggerHandler
  ↓
Step 0: 호출 모드 판별 (기존)
  ├─ delegated token 존재 → 위임 모드 (그대로)
  └─ token 없음 → 신규: design-mode 게이트
       ├─ recent feature design.md 존재 검사
       ├─ 없으면 → "/sf-feature 로 진입 권장. 그래도 진행?" AskUserQuestion
       │    ├─ 진행 거부 → /sf-feature 로 redirect
       │    └─ 명시 override → 사유 design.md 짧은 stub 작성 후 진행
       └─ 있으면 → 기존 standalone flow (단일 review)
```

구현: `templates/hooks/_lib/check-feature-context.js` 신규. 각 artifact 스킬 Step 0.7 (모드 판별 직후) 에 호출.

### B. Review severity 태깅

reviewer 출력 스키마 변경 — 자유 산문 *위에* 구조 블록 의무화:

```markdown
## Review (sf-design-eng-reviewer)

(자유 산문 분석…)

### Verdict
- block: [B1] async @future 가 trigger 컨텍스트에서 mixed-DML 위험
- block: [B2] sharing modifier 미명시
- concern: [C1] batch size 200 가정의 governor 여유 부족
- concern: [C2] retry 정책 누락
- nit: [N1] naming: handler vs controller 혼용
```

규칙:
- `block` = dispatch 차단. design.md 에 해결 명시 의무.
- `concern` = dispatch 허용. design.md 에 1줄 응답 의무 (수용/기각/연기 + 사유).
- `nit` = 의무 없음.

ID (`B1`, `C2`, `N1`) 은 reviewer 가 부여. resolution log 에서 참조.

`stop-reviewer-validate.js` 확장: verdict 블록 부재 → block. 라벨 외 텍스트 → block.

### C. Resolution log + dispatch sentinel

design.md 의무 섹션:

```markdown
## Review Resolution

### sf-design-eng-reviewer
- B1: handler 를 sync 로 전환, future call 은 별도 queueable 로 분리. (해결)
- B2: `with sharing` 명시. (해결)
- C1: 200 유지. AccountTrigger 평균 50 records, 4x 여유 충분. (수용 안 함)
- C2: phase 2 로 연기, 본 feature 범위 외. (연기)

### sf-design-security-reviewer
- (block 없음, concern C1: …)
```

`templates/hooks/_lib/validate-design.js` 확장:
1. 모든 reviewer verdict 의 `block` ID 가 Resolution 섹션에 등장하는지 검사.
2. 모든 `concern` ID 도 응답 1줄 존재 검사.
3. 누락 시 dispatch sentinel 발급 거부 → `pre-create-design-link-gate.js` 가 차단.

### D. Targeted re-review

design.md `revision: N` 증가 시 (사용자가 block 해결 후 재검토 요청):
- `/sf-feature` Step 5 (review) 가 이전 revision 의 `block` 발급 persona 만 재실행.
- 새 revision 에서 같은 persona 가 다시 `block` 을 내면 `revision: N+1` 까지만 — 동일 persona 가 연속 2회 block 시 사용자 명시 override 요구 (AskUserQuestion).

이전 review 는 design.md 에 보존 (`## Review (sf-design-eng-reviewer) [rev 1, superseded]`). 감사 추적.

## Decisions

| # | Decision | 결정 |
|---|----------|------|
| D1 | severity 라벨 강도 | `block` hard gate, `concern` 응답 의무, `nit` 무시 가능 |
| D2 | 단독 artifact 차단 강도 | 차단 아닌 redirect + override 경로 (사유 stub 의무) |
| D3 | re-review 범위 | block persona 만, 전체 재실행 아님 |
| D4 | iteration cap | 동일 persona 2회 연속 block → 사용자 override |
| D5 | resolution 위치 | design.md 본문 `## Review Resolution` 섹션 |

## Phase 분할

**Phase 1: severity 태깅 + resolution log (필수, 독립 가치)**
- `templates/agents/sf-design-*-reviewer.md` 7개 파일에 verdict 스키마 명시.
- `stop-reviewer-validate.js` 확장.
- `validate-design.js` 확장 (resolution 검증).
- `/sf-feature` SKILL.md Step 5/6 사이에 resolution log 작성 단계 명시.

**Phase 2: 단독 artifact redirect 게이트 (필수, 독립 가치)**
- `_lib/check-feature-context.js` 신규.
- 5개 artifact 스킬 SKILL.md 의 Step 0 갱신.
- override stub 포맷 정의.

**Phase 3: targeted re-review + iteration cap (Phase 1 의존)**
- `/sf-feature` SKILL.md 에 revision 흐름 명시.
- `validate-design.js` 에 revision diff 추적 추가.

각 phase 는 다음 phase 없이도 가치 있음. Phase 2 는 Phase 1 과 독립.

## Risks

- **R1**: severity 라벨 부정확 — reviewer 가 `concern` 으로 깎아 dispatch 통과 시도. 완화: reviewer prompt 에 예시 + 자기 검열 문구. CEO 리뷰가 메타 검토.
- **R2**: resolution log 가 형식적 응답으로 채워짐 ("수용함" 1단어). 완화: `validate-design.js` 가 최소 글자수/근거 키워드 휴리스틱 검사.
- **R3**: 단독 artifact 작업이 매번 `/sf-feature` 경유 강요로 마찰 증가. 완화: 명시 override 경로 (D2) — 단, 사유 stub 작성을 강제해 마찰을 *느끼게* 한다 (그게 목적).
- **R4**: 동일 persona 연속 block 사용자 override 가 회피 경로화. 완화: override 사유도 design.md 에 기록, retro 시 패턴 검토.

## Test plan

- Fixture design.md 3종: (a) 모든 block 해결, (b) block 미해결, (c) concern 응답 누락.
- `validate-design.js` 단위 테스트 — 각 fixture 의 verdict 일치 확인.
- 단독 artifact 호출 시나리오: feature design.md 존재/부재 케이스 양쪽 게이트 동작.
- revision 2 에서 같은 persona block → AskUserQuestion 트리거 확인.

## 단계별 산출물 (artifact 분해)

| ID | 종류 | 파일 | Phase |
|----|------|------|-------|
| A1 | hook | `templates/hooks/_lib/check-feature-context.js` | 2 |
| A2 | hook 확장 | `templates/hooks/stop-reviewer-validate.js` | 1 |
| A3 | hook 확장 | `templates/hooks/_lib/validate-design.js` | 1, 3 |
| A4 | agent prompt | `templates/agents/sf-design-{ceo,eng,security,qa,library}-reviewer.md` (5) | 1 |
| A5 | agent prompt | `templates/agents/sf-apex-code-reviewer.md` | 1 |
| A6 | skill prompt | `templates/skills/sf-feature/SKILL.md` (Step 5/6, revision flow) | 1, 3 |
| A7 | skill prompt | `templates/skills/sf-{apex,lwc,aura,sobject,field}/SKILL.md` (Step 0) | 2 |

## Reviews

(5-persona 리뷰 대기 — 본 design.md 자체가 본 제도의 첫 시험대.)

## Review Resolution

(Reviews 후 작성.)
