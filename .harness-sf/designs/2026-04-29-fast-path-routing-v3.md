---
type: feature
name: fast-path-routing
date: 2026-04-29
author: mjkang2539
status: draft-v3
revision: 3
supersedes: 2026-04-29-fast-path-routing.md
---

# fast-path-routing v3 — 단일 artifact fast-path (delegation token + Artifacts 보존)

## Why revision 3

revision 2 외부 리뷰에서 발견:

- **codex-H1**: "최소 기록" 포맷 (`## What` + 결과만) 이 현 feature design 계약 위반. `validate-design.js:18,267` 가 `## Artifacts` 필수, fast-path 산출물이 파이프라인 진입 불가.
- **codex-H2**: sub-skill standalone 위임이 `check-feature-context.js:2,107` 에서 active feature 감지 → `/sf-feature` redirect — 첫 dispatch 부터 무한 redirect 루프.
- **codex-M1**: `state.entered_via` 소비처 부재.
- **codex-M2**: `routing.*_keywords` override 가 doctor 에서 검증 안 됨.
- **codex-Seq**: 라우팅 도입 전 sub-skill 의 "feature 내부 fast-path 호출" 계약 선행 필요.

state-consolidation v3 가 `state.entered_via` 위치를 frontmatter → state.json 으로 옮긴다. 동시에 design.md 형식 자체는 유지 — fast-path 도 `## Artifacts` 1개를 작성한다.

## 의존성

- **state-consolidation v3** (state.json `entered_via` 필드).
- **step-consolidation v3** (transition table — fast-path 는 `1 → 7` 점프 허용 필요, 별도 entered_via 별 분기 표 필요).
- delegated-mode 토큰 시스템 (현 `templates/hooks/_lib/issue-delegated-token.js` / `check-delegated-token.js`) 를 fast 변종 도입으로 확장.

## Design

### Path 결정 (probe 1 질문, 키워드 매칭 우선)

```
키워드 매칭 (deterministic, PROJECT.md routing.*_keywords override 가능):
  fast: "필드 1개", "메서드 추가", "단일 필드", "한 개"
  full: "마이그레이션", "OWD", "sharing 변경", "라이브러리", "외부 시스템"

fast 매칭 → 1줄 확인 ("fast-path 로 진행할까요? Y/n")
full 매칭 → 풀 사이클 진입
미매칭   → probe 1 질문:
  "위험 신호 (해당 모두 선택):
   - 없음
   - 데이터 마이그레이션
   - sharing 변경
   - 외부 시스템 연동
   - 라이브러리 도입"
  '없음' → fast / 1개 선택 → standard / 2개 이상 → full
```

### fast-path 흐름 (codex-H1 해결)

`## Artifacts` 형식을 **유지**. 단, artifact 1개 + 페르소나 리뷰 생략 + resolution log 생략:

```markdown
---
type: feature
name: account-description-field
date: 2026-04-29
status: in-flight
revision: 1
---

# Account.Description 필드 추가

## What
Account 에 Description__c (텍스트 영역 255) 추가.

## Artifacts
### 1. account-description-field [type: field]
Object: Account, API name: Description__c, type: TextArea(255), required: false.

## Reviews
(fast-path — 리뷰 생략)

## Review Resolution
(fast-path — 해당 없음)
```

`validate-design.js` 통과. state.json 에 `entered_via: "sf-feature-fast"` 기록.

### Sub-skill 위임 — delegated-mode 변종 (codex-H2 해결)

문제: sub-skill 호출 → `check-feature-context.js` 가 active feature 감지 → `/sf-feature` redirect 권고 → 무한 루프.

해결: delegated-mode 토큰에 `mode` 차원 추가:

```
hsf delegated issue \
  --slug=account-description-field \
  --artifact-id=A1 \
  --delegation-mode=fast    # 또는 full

→ .harness-sf/.cache/sentinels/delegated-mode/<key>.json:
{
  "delegation_mode": "fast",
  "design_path": "...",
  "artifact_id": "A1",
  "sub_skill": "/sf-field",
  "issued_at": "...",
  "hmac": "..."
}
```

`check-feature-context.js` 변경:
```js
// 신규 로직: delegated-mode sentinel 이 있으면 redirect 거부
const sentinel = checkDelegatedSentinel(slug, artifactId);
if (sentinel && sentinel.delegation_mode in ('fast', 'standard', 'full')) {
  return { redirect: false, mode: sentinel.delegation_mode };
}
// 기존 redirect 로직
```

이로써 fast-path 가 sub-skill 직접 호출해도 redirect 안 됨.

### state.entered_via 소비처 (codex-M1 해결)

state-consolidation v3 의 PR D (사람용 인터페이스) 에 다음 묶음 포함:
- **statusline.js**: `state.entered_via` 표시. `[fast]`, `[standard]`, `[full]`, `[direct]` prefix.
- **audit.log**: 모든 entry 에 `path:fast|standard|full|direct` 컬럼 추가.

### routing.*_keywords schema 검증 (codex-M2 해결)

`hsf doctor` 가 `.harness-sf/PROJECT.md` 의 `routing.fast_keywords` / `routing.full_keywords` 가 array of strings 인지 검증. 잘못된 형식이면 경고 + 기본값 사용 안내.

PROJECT.md 는 installer 가 수정 안 함 (codex 가 다른 문서에서 지적) — 사용자가 직접 추가.

### 자동 승격 (escape valve)

fast/standard 진행 중 위험 신호 발견 시:
```
hsf state set entered_via sf-feature-full --reason="library required"
hsf design revoke <slug>     # 기존 fast 용 sentinel 폐기
→ design.md 의 ## Reviews / ## Review Resolution 작성 단계로 진입 (Step 4)
```

step-consolidation v3 의 transition table 이 entered_via 별 분기 허용해야 함:
```
fast 모드:   1 → 7 (직접 dispatch)
standard:   1 → 2 → 3 → 4(eng+security only) → 5 → 7
full:       1 → 2 → 3 → 4(5 personas) → 5 → 6 → 7
승격 시:     entered_via 변경 + transition 재시작 가능
```

## Rollout

- **선행**: state-consolidation v3 PR A + step-consolidation v3 의 transition guard.
- **PR fast-1**: delegated-mode sentinel 에 `delegation_mode` 필드 추가, `check-feature-context.js` 가 delegation_mode 인식. 라우팅 자체는 미도입.
- **PR fast-2**: probe + 키워드 매칭 + path 결정 로직. SKILL.md 진입부 갱신.
- **PR fast-3**: `hsf doctor` 의 routing keywords 검증.
- **PR fast-4**: statusline + audit 표시 (state-consolidation v3 PR D 와 묶음).
- **PR fast-5**: 자동 승격 시나리오 + retro 일정.

## Risk

- **standard 의 페르소나 한정 (eng+security)**: 도입 후 1개월 모니터링. 기각될 경우 standard 도 4 페르소나로 복귀 — design.md 변화 없음, 라우팅 코드만.
- **승격 시 부분 sentinel 잔존**: fast → full 승격 후 fast 용 sentinel 이 남아있으면 보안 약함. → 승격 절차에 `hsf design revoke` 강제, 누락 시 doctor 경고.

## Test plan

- 라우팅: 시나리오 20개 (단일 필드 / 트리거 / sharing / 라이브러리 / 마이그레이션 등) 분류 정확도.
- delegation: fast-path 로 sub-skill 호출 시 redirect 미발생.
- design.md 호환성: fast-path 산출 design.md 가 `validate-design.js` 통과.
- 자동 승격: fast → full 전환 시 sentinel revoke + transition 재시작.

## Reviews

### External review (codex 3차, 2026-04-29)

- **(b1) split-brain**: fast-path 샘플의 `## Review Resolution` 섹션 + state.json 의 `review_resolution` 동시 존재. 진실의 두 곳.
- **(c2) discriminator**: 본 문서 + state-consolidation 은 `kind` 사용. 실제 코드는 `type` (`templates/hooks/_lib/dispatch-state.js:20-23,75-79`).
- **(c6) entered_via 표기**: 본 문서 `"sf-feature-fast"` vs statusline `"[fast]"`. enum 합의 안 됨.

### Resolution

- **(b1)**: fast-path 도 design.md single source. `## Review Resolution` 섹션은 fast-path 에선 "(fast-path — 해당 없음)" 1줄로 유지. state.json 에는 `review_resolution` 자체 부재. 본 문서 fast-path 샘플은 그대로 (이미 single-line).
- **(c2)**: artifact discriminator 는 `type`. 본 문서 + 다른 v3 의 `kind` 표기 모두 `type` 으로 정정.
- **(c6)**: `entered_via: "fast" | "standard" | "full" | "direct"` (prefix 없음). 본 문서 `"sf-feature-fast"` 표기 정정. statusline 표시는 `[fast]` 그대로.
