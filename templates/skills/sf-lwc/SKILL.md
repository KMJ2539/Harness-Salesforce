---
name: sf-lwc
description: Lightning Web Component(LWC)를 생성하거나 수정(ensure 시맨틱). 같은 이름의 컴포넌트가 없으면 4-파일 스캐폴딩으로 생성, 있으면 diff 승인 후 수정. SLDS 적용, @wire vs imperative 선택, 접근성, Jest 테스트 동반. "LWC 만들어줘", "기존 컴포넌트 수정", "Lightning 컴포넌트 필드 추가" 같은 요청 시 사용.
---

# /sf-lwc

LWC 컴포넌트를 **ensure 모드**로 다룸 — 같은 이름이 없으면 생성, 있으면 수정.

## 워크플로우

```
Step 0: 호출 모드 판별 (standalone vs delegated)
   ↓
[standalone 만] Step 1 → 1.5 → 1.7 → 1.9
   ↓
Step 2 이후: context-explorer + create/modify + 테스트 + audit
```

### Step 0: 호출 모드 판별

호출자(주로 `/sf-feature`)가 feature design.md 경로 + artifact ID 를 전달하면 **delegated 모드 후보**. 프롬프트 단독 판단 금지 — sentinel 로 검증:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated 모드 확정, exit 1 → standalone.

**delegated 모드 동작**:
- design.md 의 `## Artifacts` 에서 해당 LWC artifact 섹션 로드 (이름, 노출 위치, 데이터 소스, @api surface 등).
- Step 1~1.9 건너뜀.
- Step 2 부터 실행, 의도 정보는 design.md 에서.
- 완료/실패 시 호출자(/sf-feature) 가 dispatch-state-cli 로 status 갱신 — 본 sub-skill 은 design.md `## Dispatch Log` 한 줄만 추가.

standalone 모드는 아래 Step 0.3 부터.

### Step 0.3: feature 컨텍스트 게이트 (standalone 진입 시 필수)

설계에 시간 쏟기 원칙 — 단독 LWC 작업이 cross-cutting 설계 검토를 우회하지 않도록 게이트:

```bash
node .claude/hooks/_lib/check-feature-context.js
```

stdout JSON `has_active_feature: true` 이고 `candidates` 중 type=`lwc` pending artifact 존재 시 AskUserQuestion으로 redirect 제안:
- `[r]` → `/sf-feature` 호출 안내 + 종료.
- `[s]` → 사유 입력 후 `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}-standalone.md` stub 작성 (`type: lwc, standalone_override: true, override_reason: ...`). 사유 없으면 redirect 강제.
- `[a]` → 종료.

매칭 candidate 없으면 통과. bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

### Step 0.5: 프로젝트 컨벤션 확인

프로젝트 컨벤션은 SessionStart hook 이 세션 시작 시 컨텍스트로 주입함. 추가 Read 불필요. 주입이 보이지 않으면 (hook 미설치) `Read .harness-sf/PROJECT.md` 와 `Read .harness-sf/local.md` 로 fallback. 이후 Step 에서 컨벤션 default 를 `[recommend]` 로 사용.

### Step 1: Deep Intent Elicitation
AskUserQuestion 으로 다음을 모두 수집:

**기본**
- 컴포넌트명 (camelCase, 예: `accountSummary`)
- 노출 위치: App Page / Record Page / Home Page / Community / Quick Action / Flow Screen / 자식 컴포넌트로만
- 대상 객체 (Record Page 용이면)
- 핵심 기능 한 줄

**Why (사용자 가치)**
- 어떤 사용자 작업을 단순화/자동화하는가
- 표준 Lightning 컴포넌트 / Record Page 만으로 부족한 이유
- 기존 LWC 재사용 가능한지 검토했는가

**What (스코프)**
- 표시할 정보: 어떤 객체의 어떤 필드
- 사용자 액션: 클릭/입력/제출 후 어떤 변화
- Non-goals

**How (데이터/통신)**
- 데이터 소스: LDS Wire / Imperative Apex / 부모 props / 없음
- LDS 가능한데 imperative 선택했다면 그 이유
- `@api` 로 노출할 public surface (props/methods)
- 발행할 custom event 또는 Lightning Message Service 채널
- 부모/자식 컴포넌트 관계

**Edge Cases**
- recordId 없는 컨텍스트
- wire error (권한/네트워크)
- 대량 리스트 렌더링 (페이지네이션/가상화 필요?)
- Locker / CSP 제약 받는 외부 라이브러리 사용 여부
- 모바일/축소 뷰포트

**Test Strategy**
- 렌더링 smoke / @api 변경 / @wire mock / 이벤트 dispatch / 에러 분기 — 어디까지 자동 테스트할지
- 접근성 자동 점검 (jest-axe 등) 도입 의도

### Step 1.5: design.md 작성

`.harness-sf/designs/{YYYY-MM-DD}-{componentName}.md` 에 저장. frontmatter `type: lwc`, `subtype` 에 record-page / flow-screen 등 노출 위치. 본문은 Why/What/How/Edge Cases/Test Strategy/Reviews 섹션.

### Step 1.6: design.md 확인 질의 (recommend + 비즈니스 사유)

draft 직후 AskUserQuestion 으로 역질문. **recommend 는 비즈니스 우선** — 사용자 경험/신뢰 손상/되돌림 비용 관점.

질문 형식: `[항목] / [후보 + default/recommend] / [recommend 사유 — 비즈니스 우선] / [기술 사유]`.

**확인 카테고리** (해당하는 것만):

1. **데이터 액세스 패턴**: LDS Wire / Imperative Apex / Custom UI API
   - recommend: 단일 레코드/관련 리스트면 **"LDS Wire"**.
   - 사유: "LDS 는 캐시·반응성·FLS 자동. imperative 로 시작하면 캐시 일관성 사고 디버깅이 사용자 신뢰 손상으로 이어짐."

2. **Public surface (`@api`) 크기**: 최소 / 풍부
   - recommend: **"최소"** (recordId, mode 정도).
   - 사유: "props 가 늘면 외부 의존성 증가 — 향후 변경 시 깨지는 부모 N개. 작은 표면이 변경 비용을 선제적으로 줄임."

3. **이벤트 모델**: dispatchEvent / Lightning Message Service / pubsub (deprecated)
   - recommend (같은 페이지 내 형제 통신): **"dispatchEvent"**. 다른 페이지/탭이면 **"LMS"**.
   - 사유: "잘못된 통신 모델은 유지보수 부담 — 사용자 입장 변화 없는데 코드만 복잡. 단순한 게 비즈니스 가치."

4. **에러/로딩 UX**: Toast / 인라인 메시지 / 침묵
   - recommend: **"인라인 메시지 + 로딩 spinner"**.
   - 사유: "Toast 는 놓치기 쉬움 — 사용자가 '뭔가 안 됐는데 모름' 상태가 가장 큰 신뢰 손상."

5. **외부 노출 범위**: 내부 사용자 / 파트너 커뮤니티 / 외부 고객
   - recommend: 명시 안 됐으면 **"내부 사용자 (Phase 1)"**.
   - 사유: "외부 노출은 Locker/CSP/접근성/i18n 요구 다름. 내부에서 검증이 외부 사고 비용을 가장 줄임."

6. **접근성 (a11y) 자동 점검**: jest-axe 도입 / 수동만
   - recommend: 외부 노출 또는 정부/금융 분야면 **"jest-axe"**.
   - 사유: "a11y 미준수는 법적 비용 + 일부 사용자 완전 차단. 자동 점검 비용은 한 번, 수동 누락 비용은 매번."

**적용 규칙**: design.md 답 있으면 짧은 확인, 없으면 풀 질문. 다른 선택 시 `## Decisions` 기록. 1~3개씩 묶어.

결과 반영 후 Step 1.7 진행.

### Step 1.7: Persona Reviews (병렬, 최대 3회)

`Agent` 툴로 5개 reviewer 단일 메시지 병렬 호출:
- `sf-design-ceo-reviewer` — 표준 컴포넌트 / 기존 LWC 재사용 대안 검토
- `sf-design-eng-reviewer` — LDS vs imperative 적정성, @api surface 크기, 성능 패턴
- `sf-design-security-reviewer` — @AuraEnabled 컨트롤러 노출, innerHTML/CSP, 민감 데이터
- `sf-design-qa-reviewer` — 렌더/wire mock/이벤트/에러 분기 커버리지
- `sf-design-library-reviewer` — base components / LDS 모듈 / static resource 재사용, npm 의존성 한계, LWS/Locker 호환성

### Step 1.9: 리뷰 통합 + per-risk 사용자 승인 게이트

전체 일괄 [P]roceed 금지. 각 `[H#]`/`[M#]` risk 마다 [1] 진입 / [2] 추가수정 강제 + 1줄 사유(8자+) 의무. HIGH 1건이라도 [2] → 해당 persona 만 재호출 (revision N+1, `revision_block_personas` 갱신). HIGH 모두 [1] → 사유들이 design.md `## Review Resolution` 자동 채움 → Step 1.92 진행. MEDIUM 동일, LOW 묻지 않음. iteration cap: revision 5회 또는 동일 persona 연속 2회 HIGH → 명시 override. 진행 카운터 `[3/N]` 표시.

상세 게이트 동작은 `/sf-feature` Step 5 와 동일 — 그 섹션 참조.

### Step 1.92: design 승인 sentinel 발급 (필수)

승인 직후 Bash 실행:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{componentName}.md
```
없으면 `force-app/main/default/lwc/{componentName}/...` 신규 파일 Write 가 `pre-create-design-link-gate.js` 에 차단됨 (TTL 2h + git HEAD match).

### Step 1.93: 점수 기록 (advisory)

승인 sentinel 직후:
```bash
node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {componentName}
```
보고용. 차단 아님. 이후 `sf-lwc-auditor` / Jest 결과 / `sf-deploy-validator` 통과 시 각각 `score-cli.js record {slug} code_review|test|deploy <0-10>` 호출 권장.

### Step 1.95: 라이브러리 도입 (해당 시)

design.md `## Decisions` 에 새 라이브러리 도입 결정이 있으면 (예: jest-axe 도입, Chart.js static resource 등록), Step 2 전에 `/sf-library-install` delegated 모드로 호출. 도입 결정 없으면 skip. install 결과는 `.harness-sf/decisions.md` 에 기록되어 다음 design 의 reviewer 가 인지.

### Step 2: 컨텍스트 분석 (객체 의존 시)
대상 객체가 있으면 **`Agent` 툴로 `sf-context-explorer` 호출**.
- 같은 객체 사용하는 LWC 이미 있으면 → 사용자에게 "재사용/확장 검토" 권유
- 권장 필드(접근 가능한, FLS 통과한) 식별

### Step 2.5: 모드 결정 (CREATE vs MODIFY)

`Glob force-app/**/lwc/{name}/{name}.js` 로 컴포넌트 디렉토리 존재 여부 확인:

**없음 → CREATE 모드**: Step 3 이후 그대로 진행.

**있음 → MODIFY 모드**:
1. 4~5개 파일을 모두 `Read` 로 로드 (`{name}.js`, `.html`, `.css`, `.js-meta.xml`, `__tests__/{name}.test.js`).
2. 다음 요소를 **반드시 보존**:
   - 공개 API: `@api` 속성/메서드 시그니처 (외부 부모/Flow에서 의존 — 변경하려면 사용자 명시 승인)
   - `targets` 와 `targetConfigs` (App Builder 사용 중일 수 있음)
   - 발행 중인 custom event 이름과 detail 구조
3. 변경 영역 식별 — 새 기능이 기존 데이터 액세스 패턴(LDS vs imperative)과 일관되게 추가될 수 있는지 판단.
4. **사용자 승인 게이트**: 어떤 파일에 어떤 변경을 가할지 diff 미리보기 → 확정 후 쓰기. 무음 덮어쓰기 금지.
5. **승인 sentinel 발급 (필수)**: 사용자 승인 응답 직후, Edit/Write 직전에 수정 대상 파일을 모두 인자로 발급:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../lwc/{name}/{name}.js force-app/.../lwc/{name}/{name}.html ...
   ```
   `pre-modify-approval-gate.js` hook이 sentinel 없으면 차단함 (TTL 30분 + git HEAD 매칭). 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.
6. 기존 Jest 테스트가 있으면 경로 기록 — Step 7 감사 전에 재실행.

### Step 3: 데이터 액세스 패턴 결정

**LDS Wire (선호)** — 캐시·반응형·FLS 자동
- 단일 레코드: `getRecord`
- 관련 리스트: `getRelatedListRecords`
- Picklist: `getPicklistValues`
- 객체 정보: `getObjectInfo`

**Imperative Apex** — LDS로 안 되는 경우만
- Aggregate, 커스텀 로직, 복잡한 join
- `cacheable=true` 가능하면 적용

**Custom UI API** (REST) — 외부 시스템 연동 시

### Step 4: 4-파일 생성

**`{name}.js` 기본 골격**
```javascript
import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';

import NAME_FIELD from '@salesforce/schema/Account.Name';

export default class ComponentName extends LightningElement {
    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: [NAME_FIELD] })
    record;

    get name() {
        return getFieldValue(this.record.data, NAME_FIELD);
    }

    handleError(event) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Error', message: event.detail.message, variant: 'error'
        }));
    }
}
```

**`{name}.html` 원칙**
- SLDS 클래스 사용 (`slds-card`, `slds-grid`, ...)
- Lightning Base Components 우선 (`<lightning-card>`, `<lightning-input>`)
- `for:each`에는 `key` 필수
- 조건 렌더링은 `lwc:if` (modern)
- 접근성: form input은 label, button에 텍스트, image에 alt

**`{name}.css` 원칙**
- 스타일 격리 (Shadow DOM) — 외부 침투 의도 시만 `:host`
- 가능하면 SLDS 디자인 토큰 사용 (`var(--lwc-...)`)

**`{name}.js-meta.xml` 원칙**
- API version: 프로젝트 sourceApiVersion 사용
- `isExposed`: true if 노출 필요
- targets: 명시적으로 (RecordPage / AppPage / HomePage / Community / FlowScreen / QuickAction)
- targetConfigs로 propertyTypes 정의 (Flow input 등)

### Step 5: 위험 가드 자동 적용
- ❌ `eval`, `Function` constructor
- ❌ `innerHTML =` (필요 시 `lwc:dom="manual"` + sanitize)
- ❌ console.log 잔존 (개발 끝나면 제거)
- ✅ wire error 처리 분기
- ✅ async 메서드 try-catch
- ✅ 공개 API (`@api`)에 JSDoc

### Step 6: Jest 테스트 동반 (생성 또는 보강)
- CREATE 모드: 신규 `__tests__/{name}.test.js` 생성.
- MODIFY 모드: 기존 테스트 재실행 → 회귀 없는지 확인 → 새 동작에 대한 케이스 추가.

테스트 케이스:
- 렌더링 smoke test
- @api 속성 변경 시 동작
- @wire mock (`registerLdsTestWireAdapter`)
- 이벤트 dispatch 검증

### Step 7: 감사
**`Agent` 툴로 `sf-lwc-auditor` 호출** — 방금 생성한 컴포넌트 경로 전달.
의존성·접근성·안티패턴 보고서 사용자에게 표시.

### Step 8: 보고
- 생성 파일 4~5개 (path)
- 노출 위치 / 사용 방법
- Jest 실행 명령

## AskUserQuestion 정책
필수 정보가 누락되면 묻는다:
- 컴포넌트명, 노출 위치, 데이터 소스 (필수)
- 대상 객체 (Record Page인 경우)

## 산출물 위치
- `force-app/main/default/lwc/{name}/{name}.js`
- `force-app/main/default/lwc/{name}/{name}.html`
- `force-app/main/default/lwc/{name}/{name}.js-meta.xml`
- `force-app/main/default/lwc/{name}/{name}.css` (필요 시)
- `force-app/main/default/lwc/{name}/__tests__/{name}.test.js`

## 안티패턴 거부
- 노출되지 않는 컴포넌트(`isExposed=false`)에 target 지정 거부
- imperative Apex만 쓰는데 LDS로 충분한 경우 — LDS 권유
- 자식만 쓰는데 너무 큰 props surface — 분해 권유
