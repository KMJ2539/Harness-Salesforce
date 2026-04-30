---
type: feature
name: tiered-risk-approval
date: 2026-04-30
author: mjkang2539
status: draft
revision: 1
---

# Tiered risk approval — Step 5 UX 재설계

## Why

현재 `/sf-feature` Step 5 는 **모든 HIGH + MEDIUM 리스크를 항목별로 개별 승인**시킨다. 5개 reviewer 가 평균 1~2개씩만 emit 해도 합산 7~10개가 되며, 사용자는 매 항목마다 `[1] Proceed / [2] Revise` + 8자 이상 사유를 입력해야 한다.

이 정책의 본래 의도("spend-time-on-design", bulk pass 차단)는 옳다. 하지만 실제 사용 결과:

- MEDIUM 항목 다수에 대해 사용자가 "ok because reviewer recommendation" 같은 **기계적 사유** 를 반복 입력 → guardrail 이 의례적 절차로 변질
- 항목별 입력에 5~10분 소요 → 구현 전 결재 문서 작성 같은 인지 피로
- 정작 critical 한 HIGH 한두 개에 집중해야 할 사용자 주의력이 MEDIUM 묶음에 분산됨

핵심 문제: **모든 리스크를 동일 강도로 다루는 정책**. Salesforce 안전성 측면에서 진짜 비가역적인 결정(보안, 데이터 손상, 배포 실패)과 설계 품질 권고는 비용/영향이 다르다.

## What

리스크를 **category 축** 으로 분리해 승인 강도를 차등화한다.

| Risk × Category | 승인 방식 | 사유 입력 |
|---|---|---|
| HIGH (전체) | 항목별 개별 승인 | 필수 (8+ chars) |
| MEDIUM-security | 항목별 개별 승인 | 필수 |
| MEDIUM-deploy | 항목별 개별 승인 | 필수 |
| MEDIUM-test | 묶음 승인 (Apply all / Select / Defer all) | 묶음 사유 1줄 |
| MEDIUM-design | 묶음 승인 | 묶음 사유 1줄 |
| MEDIUM-exposure | 항목별 개별 승인 | 필수 |
| LOW (전체) | 묻지 않음, 리포트만 | — |

핵심 원칙:

1. **사용자는 category 를 판단하지 않는다.** Reviewer agent 가 risk emit 시 `category` 필드를 강제 출력. Skill 이 자동 분류·번들링.
2. **묶음 승인의 사유는 묶음 단위 1회.** 자동 생성 문구("accepted recommendation") 금지 — 묶음 전체에 대한 사용자의 한 줄 판단을 받는다.
3. **defer / reject 는 여전히 개별 사유.** 묶음 승인이라도 일부만 defer 하려면 그 항목은 항목별 입력으로 분기.
4. **HIGH 의 정책은 변경 없음.** 비가역 결정은 항상 개별 승인 + 사유.

## How (변경 파일)

| 파일 | 변경 |
|---|---|
| `templates/agents/sf-design-{ceo,eng,security,qa,library}-reviewer.md` | Risk emit 스키마에 `category` 필드 추가. Eng/Security/QA/Library 의 "Risk ID convention" 섹션을 `[H1|category=security]` 또는 별도 메타 라인으로 확장. CEO 는 단일 category=design 고정. |
| `templates/agents/sf-design-eng-reviewer.md` | Eng reviewer 가 emit 가능한 category: `deploy`, `design`, `test`. 가이드라인 (governor limit, sharing → deploy / 트리거 패턴, 추상화 → design / 커버리지 → test) 명시. |
| `templates/agents/sf-design-security-reviewer.md` | 단일 category=security 고정 (모든 보안 risk 는 개별 승인 대상). |
| `templates/agents/sf-design-qa-reviewer.md` | category: `test` 고정. |
| `templates/agents/sf-design-library-reviewer.md` | category: `design` 또는 `exposure` (외부 의존성/라이선스는 exposure). |
| `templates/skills/sf-feature/SKILL.md` Step 5.0 | 항목별 단일 루프를 **2-pass 분기** 로 재작성: (1) HIGH + MEDIUM-{security,deploy,exposure} 항목별 → (2) MEDIUM-{test,design} category 별 묶음 승인. Progress counter 도 `[H 2/3] [M-bundle 1/2]` 형태로 변경. |
| `templates/skills/sf-feature/SKILL.md` Step 5.1 | Resolution log 스키마 확장: 묶음 승인 항목은 `## Review Resolution > Bundled` 하위에 `category: test (3 items)` + 묶음 사유 1줄 + 자동 enumerate 된 ID 목록. 개별 승인은 기존 형식 유지. |
| `templates/hooks/_lib/validate-design.js` `--check-resolution` | 묶음 승인 인지: `Bundled` 섹션의 ID 들도 응답 처리된 것으로 간주. 단, 묶음 사유는 8+ chars 필수 검증. |
| `templates/hooks/_lib/issue-design-approval.js` | 묶음 승인 metadata 도 sentinel 에 포함 (감사 추적). |
| `templates/skills/sf-feature/SKILL.md` Step 5 도입 문구 | "No bulk [P]roceed" → "No bulk proceed for HIGH or for security/deploy/exposure MEDIUM. Other MEDIUMs may be batch-resolved by category." |

### Reviewer 출력 스키마 (확정안)

기존:
```
## Risks
- [H1] sharing modifier missing → add with sharing
- [M1] batch size 200 may hit limits → reduce to 50
```

변경 후:
```
## Risks
- [H1|deploy] sharing modifier missing → add with sharing
- [M1|test] coverage on AccountHandler.process branches missing → add 3 cases
- [M2|design] handler split into 2 classes → consider service layer
```

`category` 는 reviewer 별 허용 set 으로 고정 — agent prompt 가 enum 위반 시 self-correct. validate-design.js 가 파싱 단계에서 enum 위반 ID 를 `category=design` 으로 fallback (보수적 분류, 어차피 묶음).

### Step 5.0 분기 의사코드

```
risks = parse('## Reviews')
high = risks.filter(r => r.severity === 'H')
medium_individual = risks.filter(r => r.severity === 'M' && r.category in {security,deploy,exposure})
medium_bundled = groupBy(risks.filter(r => r.severity === 'M' && r.category in {test,design}), 'category')

# Pass 1: 개별 승인 (HIGH + critical MEDIUM)
for r in [...high, ...medium_individual]:
  ask AskUserQuestion (기존 Step 5.0 동일)

# Pass 2: 묶음 승인 (디자인 품질 / 테스트 권고)
for category, items in medium_bundled:
  show items 요약 (ID + 1줄 issue)
  ask AskUserQuestion:
    [1] Apply all — 묶음 사유 1줄 (20+ chars), 기본 옵션
    [2] Select per-item — 그 묶음만 항목별 분기
    [3] Defer all — 묶음 defer 사유 1줄 (20+ chars)
```

## Risks (이 design doc 자체)

- **(deploy) reviewer agent 5개 동시 변경**: 출력 schema 변경은 5개 agent prompt 수정 + validate-design.js 파서 수정이 동시 배포되어야 함. 부분 배포 시 `[H1]` (no category) 와 `[H1|deploy]` 가 혼재 → 파서가 fallback 으로 흡수하므로 forward-compatible 하게 작성.
- **(design) category enum 의 권위**: Eng reviewer 가 "이건 deploy 인가 design 인가?" 헷갈릴 항목이 있을 수 있음 (예: governor limit 위반은 deploy 지만, 추상화로 풀 수 있으면 design). 가이드라인을 reviewer prompt 에 명시하되, 모호하면 보수적으로 deploy 선택 (= 개별 승인).
- **(test) Resolution log 스키마 확장**: 기존 design.md 의 `## Review Resolution` 파싱이 깨지지 않도록 `Bundled` 섹션은 optional 추가, 기존 persona 별 섹션은 그대로.
- **(exposure) sentinel TTL/audit**: 묶음 승인이 audit log 에서 "한 번의 결정으로 N개 risk 통과"로 보이게 되어, 사후 추적 시 "이 MEDIUM 은 왜 통과했지?" 답변이 묶음 사유 한 줄에 의존. 묶음 사유 품질이 핵심 — 8+ chars 만으로는 부족할 수 있음 (별도 검토).

## Out of scope

- HIGH 분류의 추가 차등화 (모든 HIGH 는 개별 승인 유지).
- LOW 항목의 자동 처리 정책 변경 (현재도 무시, 그대로).
- Reviewer 가 emit 하는 risk 의 quantity 자체를 줄이는 prompt 튜닝 (별도 PR).
- Step 5.1.5 revision flow 의 변경 — HIGH [2] revise 분기는 그대로.

## Decisions (resolved 2026-04-30)

1. **MEDIUM-exposure 분리 유지** — `exposure` 와 `security` 는 결정의 성격이 다르다 (보안 취약점 vs API contract). category 의 의미론적 정확성을 우선. Library reviewer 가 외부 의존성/라이선스 risk emit 시 자연스럽게 사용.
2. **묶음 사유 20+ chars 강제** — 한 줄이 N개 결정을 대표해야 하므로 8+ 는 부족. validate-design.js 가 Bundled 섹션의 사유 길이 검증.
3. **Select per-item 옵션 유지 + 행동 형성** — "묶음 4개 중 1개만 애매" 같은 mixed-bundle 케이스에서 Select 가 없으면 Apply-all (애매한 거 통과) / Defer-all (명확한 거 묻힘) 의 잘못된 양자택일을 강제하게 됨. 대신:
   - Apply all 을 첫번째 옵션 (default) 로 배치
   - Telemetry 기록: `.harness-sf/.cache/scores/bundle-decisions.jsonl` 에 `{ts, slug, action, category, item_count}` append
   - 1주 dogfooding 후 Select 비율 ≥ 50% 면 category 분류 가이드 재검토 (옵션 자체는 유지)
