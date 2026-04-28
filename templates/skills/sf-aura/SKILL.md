---
name: sf-aura
description: Aura 컴포넌트를 생성하거나 수정(ensure 시맨틱) — 단, LWC가 가능하면 LWC를 강력 권유. 같은 이름이 없으면 생성, 있으면 diff 승인 후 수정. Aura가 정말 필요한 경우(레거시 통합, LWC 미지원 영역)에만 진행. "Aura 컴포넌트 만들어줘", "기존 Aura 수정" 같은 요청 시 사용.
---

# /sf-aura

Aura 컴포넌트 **ensure 모드** — 같은 이름이 없으면 생성, 있으면 수정. **권장 경로는 LWC**. Aura는 레거시이며 Salesforce가 신규 기능을 추가하지 않습니다.

## Step -1: 호출 모드 판별

호출자(`/sf-feature`)가 feature design.md 경로 + artifact ID 를 전달하면 **delegated 모드 후보**. sentinel 로 검증:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated 모드 확정 (design.md 의 해당 aura artifact 섹션 로드 후 Step 0 LWC 가능성 확인과 Step 1 의도 질문 건너뛰고 — feature 단계에서 이미 검토됐으므로 — Step 2 부터 실행, 완료/실패 시 호출자가 dispatch-state-cli 로 status 갱신).
exit 1 → standalone 모드 (아래 Step -0.5 부터).

## Step -0.5: feature 컨텍스트 게이트 (standalone 진입 시 필수)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

`has_active_feature: true` 이고 type=`aura` pending artifact 존재 시 AskUserQuestion 으로 redirect 제안 (`[r]` `/sf-feature` / `[s]` 사유 입력 후 stub / `[a]` abort). stub: `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}-standalone.md` (`type: aura, standalone_override: true`). bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

매칭 없으면 Step 0 진행.

## Step 0: LWC 가능성 확인 (가장 중요)

먼저 사용자에게:
> "이 요구사항이 LWC로 구현 가능한지 검토했습니다. Aura가 꼭 필요한 이유가 있나요?"

**LWC로 못 하는 케이스 (Aura가 필요한 경우)**
- ❌ 기존 Aura 앱에서 즉시 호출되는 child (LWC도 가능하지만 wrapping 필요)
- ❌ `force:appHostable`, `force:lightningQuickAction` 일부 마커 인터페이스
- ❌ `lightning:availableForFlowActions` invocable Aura action
- ❌ 외부 Aura 라이브러리(`ltng:require`)에 직접 의존
- ❌ Salesforce Console API (Aura에서만 일부 기능)

**LWC로 가능한 케이스 (대부분)** → `/sf-lwc`로 redirect 권유

사용자가 그래도 Aura를 원하면 진행. 이유를 보고서에 기록.

## Step 1: 의도 명확화
- 컴포넌트명 (PascalCase, 예: `AccountSummary`)
- 노출 위치
- 데이터 소스
- LWC 대신 Aura를 선택한 이유 (기록용)

## Step 1.92: design 승인 sentinel 발급 (CREATE 모드 진입 전 필수)

`force-app/main/default/aura/**` 신규 파일은 `pre-create-design-link-gate.js` 가 design-approval sentinel 없이는 차단합니다. Aura 는 정식 5-persona 리뷰 흐름이 없으므로 다음 중 하나:

- **권장**: `/sf-feature` 진입 → composite design.md + 5-persona 리뷰 후 자동 발급. 그러면 이 스킬은 delegated 모드(Step -1)로 호출됨.
- **standalone 직행**: 위 Step 1 의도(특히 LWC 대신 Aura 선택 사유)를 `.harness-sf/designs/{YYYY-MM-DD}-{ComponentName}.md` 에 frontmatter `type: aura, name: {ComponentName}` 와 함께 저장한 뒤:
  ```bash
  node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ComponentName}.md
  ```
  (TTL 2h + git HEAD 매칭). MODIFY 모드만 진행할 거면 이 단계 생략 가능 — `pre-modify-approval-gate.js` 가 별도 sentinel 을 요구.

## Step 2: 컨텍스트 분석
대상 객체 있으면 **`Agent` 툴로 `sf-context-explorer` 호출**.

## Step 2.5: 모드 결정 (CREATE vs MODIFY)

`Glob force-app/**/aura/{Name}/{Name}.cmp` 로 컴포넌트 디렉토리 존재 여부 확인:

**없음 → CREATE 모드**: Step 3 이후 진행 (단, LWC 권유 메모는 유지).

**있음 → MODIFY 모드**:
1. `.cmp`, `Controller.js`, `Helper.js`, `.css`, `.design`, `.cmp-meta.xml` 등 존재 파일 모두 `Read`.
2. 다음 요소 보존:
   - `implements="..."` 인터페이스 목록 (App Builder/Quick Action 노출 깨짐 방지)
   - `aura:attribute` 의 `name`/`type` (외부에서 set하는 속성 — 변경 시 명시 승인)
   - `access="global|public"` 모디파이어
   - `controller="..."` 참조 (Apex 컨트롤러 — 분리 유지)
3. **변경 risk-rank 분류** (사용자에게 표로 제시):
   - **safe** — 라벨/문구 변경, SLDS 클래스 교체, helper 내부 리팩터, 신규 비공개 메서드, `.css` 추가
   - **medium** — 신규 `aura:attribute` 추가(기존 부모 영향 없음), 신규 `aura:handler`, helper 시그니처 추가, `.design` 속성 추가
   - **high (명시 승인 필수)** — `implements=` 변경/삭제, `access` 강등(`global`→`public` 등), 기존 `aura:attribute` `name`/`type` 변경 또는 삭제, `controller=` 교체, 기존 컨트롤러 액션 시그니처 변경 (외부 호출자 깨짐)
4. **사용자 승인 게이트**: 변경할 파일과 diff 미리보기 + 위 risk-rank 표 → 확정 후 쓰기. high 항목 1건이라도 있으면 항목별 명시 승인 필요.
5. **승인 sentinel 발급 (필수)**: 사용자 승인 응답 직후, Edit/Write 직전에 수정 대상 파일을 모두 인자로 발급:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../aura/{Name}/{Name}.cmp force-app/.../aura/{Name}/{Name}Controller.js ...
   ```
   `pre-modify-approval-gate.js` hook이 sentinel 없으면 차단함 (TTL 30분 + git HEAD 매칭). 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.
6. **기존 테스트 재실행 (신규 테스트 추가 전)**: 연결 Apex controller (`controller="..."`) 의 기존 테스트 클래스를 `sf apex run test -n {ControllerName}Test` 로 먼저 실행해 baseline green 확인. red 면 수정 전 원인 분리. 그 다음 변경 → 그 다음 신규 테스트 추가. 순서 위반 시 회귀와 신규 결함이 섞여 디버깅 비용 폭증.
7. 보고서에 "이 수정은 LWC 마이그레이션을 더 늦추는가?" 한 줄 평가 추가.

## Step 3: 파일 생성

**`{Name}.cmp` 골격**
```xml
<aura:component
    implements="force:appHostable,flexipage:availableForRecordHome,force:hasRecordId"
    access="global"
    controller="MyController">

    <aura:attribute name="recordId" type="Id" />
    <aura:attribute name="record" type="Object" />

    <aura:handler name="init" value="{!this}" action="{!c.doInit}"/>

    <lightning:card title="Account">
        <p class="slds-p-horizontal_small">
            {!v.record.Name}
        </p>
    </lightning:card>
</aura:component>
```

**`{Name}Controller.js`**
- `init` 핸들러
- 이벤트 핸들러
- helper 위임만 (로직 본체는 helper)

**`{Name}Helper.js`**
- 비즈니스 로직 본체
- Apex 호출 (`$A.enqueueAction`)
- Promise 패턴 사용 권장

**`{Name}.css`**
- SLDS 우선

**`{Name}.design`** (필요 시)
- App Builder 노출 속성

**`{Name}.svg`** (필요 시)
- Lightning App Builder 아이콘

**`{Name}.cmp-meta.xml`**
- API version
- description

### Step 4: Apex Controller (필요 시)
`/sf-apex` 호출 — `@AuraEnabled` controller 생성/수정.

### Step 5: 모범 패턴 강제
- ✅ `access="global"` 또는 `public` 명시
- ✅ Apex `@AuraEnabled` 메서드는 `cacheable=true`로 가능하면
- ✅ Promise 패턴: helper에서 `$A.getCallback`으로 wrap
- ✅ 에러 처리: `response.getError()` 분기 + Toast event
- ❌ 직접 DOM 조작 (`$A.util.toggleClass` 외엔 지양)
- ❌ `aura:iteration` 안 무거운 동기 작업

### Step 6: 보고
- 생성 파일 목록
- **마이그레이션 추천**: "이 Aura 컴포넌트는 향후 LWC로 마이그레이션 권장. 작성된 Apex controller는 그대로 재사용 가능"
- 차후 마이그레이션을 위한 사전 작업 권유 (예: Apex controller 분리 유지)

## AskUserQuestion 정책
- 컴포넌트명, 노출 위치 (필수)
- LWC 대신 Aura 선택 이유 (필수 — 기록 목적)

## 산출물 위치
- `force-app/main/default/aura/{Name}/{Name}.cmp` 외 파일들

## 톤
사용자에게 매번 LWC 권유를 hard-sell로 하지 말고, 한 번 명확히 안내한 뒤 사용자 결정 존중. 보고서에 마이그레이션 메모만 남김.
