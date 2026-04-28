---
name: sf-sobject
description: Custom SObject(커스텀 객체)를 생성하거나 수정(ensure 시맨틱). 같은 API name이 없으면 생성, 있으면 diff 승인 후 sharing/라벨/list view/탭 메타 수정. "객체 만들어줘", "Order__c sharing model 변경", "list view 추가", "Custom Object 정의" 같은 요청 시 사용.
---

# /sf-sobject

Salesforce Custom Object를 메타데이터로 **ensure 모드** 처리 — 같은 API name 디렉토리가 없으면 생성, 있으면 수정. UI 클릭 대신 source-controlled 방식.

```
Step 0: 호출 모드 판별 → [standalone 만] Step 1 → 1.5 → 1.7 → 1.9 → Step 2 이후 코드
```

## Step 0: 호출 모드 판별

호출자(주로 `/sf-feature`)가 feature design.md 경로 + artifact ID 를 전달하면 **delegated 모드 후보**. sentinel 로 검증:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated 모드 확정, exit 1 → standalone.

**delegated 모드 동작**:
- design.md 의 `## Artifacts` 에서 해당 sobject artifact 섹션 로드 (API name, 라벨, sharing model, name field 등).
- Step 1~1.9 건너뜀.
- Step 2 부터 실행, 의도 정보는 design.md 에서.
- 완료/실패 시 호출자(/sf-feature) 가 dispatch-state-cli 로 status 갱신 — 본 sub-skill 은 design.md `## Dispatch Log` 한 줄만 추가.

standalone 모드는 아래 Step 0.3 부터.

## Step 0.3: feature 컨텍스트 게이트 (standalone 진입 시 필수)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

`has_active_feature: true` 이고 type=`sobject` pending artifact 존재 시 AskUserQuestion으로 redirect 제안: `[r]` `/sf-feature` / `[s]` 사유 입력 후 stub (`type: sobject, standalone_override: true`) / `[a]` abort. 매칭 없으면 통과. bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

## Step 0.5: 프로젝트 컨벤션 확인

프로젝트 컨벤션은 SessionStart hook 이 세션 시작 시 컨텍스트로 주입함. 추가 Read 불필요. 주입이 보이지 않으면 (hook 미설치) `Read .harness-sf/PROJECT.md` 와 `Read .harness-sf/local.md` 로 fallback. 이후 sharing model / API name / PermSet 질의에서 컨벤션 default 를 `[recommend]` 로 사용.

## Step 1: Deep Intent Elicitation (AskUserQuestion 적극 활용)

기본 메타 정보(라벨, API name, sharing 등)에 더해 다음을 추가 수집:

**Why (도메인)**
- 이 객체가 표현하는 실세계/비즈니스 개념 한 문장
- 기존 객체(Account/Contact/Opportunity 등)에 필드/레코드 타입으로 처리할 수 없는 이유
- 6개월 후 예상 레코드 수 (1k / 100k / 1M+)

**What (스코프)**
- 어떤 데이터를 담는가 (대표 필드 3~5개)
- 어떤 객체와 관계가 있는가 (Lookup / Master-Detail)
- Non-goals: 이 객체에 담지 않을 것

**How (운영)**
- 누가 입력하나 (사용자 폼 / 통합 API / Apex 자동 생성)
- 누가 읽나 (모든 사용자 / 특정 PS / 외부 API)
- 라이프사이클: 생성 후 수정되나, soft delete vs hard delete

**Edge Cases**
- Master-Detail 자식이 될 가능성 (sharing 강제 변경)
- 외부 시스템 sync 가 있다면 unique/external ID 전략
- 대량 import/export 시나리오
- Roll-up summary 가 필요한 부모 측 의존

**Test Strategy**
- 배포 검증 (`sf project deploy validate-only`)
- sharing/OWD 변경 시 영향 검증 계획
- Permission Set 부여 후 사용자 walkthrough

**기본 메타 정보 (이전 그대로 — 라벨, 복수형, API name, name field, sharing model 등)**

**필수 정보**
- 라벨 (한국어 OK): "주문"
- 복수형 라벨: "주문들"
- API name: `Order__c` (자동 제안하되 확인)
- 설명 (description): 한 줄
- Name field 종류:
  - **Text**: 사용자 입력 (예: "주문번호: ORD-0001")
  - **Auto Number**: 자동 번호 (예: `ORD-{0000}`) — 대부분 권장
- Sharing Model — 후보군 전체를 `[default]` / `[recommend]` 표기와 함께 제시한 뒤 사용자 선택:
  - `Private` — **[recommend]** 명시적 share 없으면 안 보임. 보안 안전 디폴트.
  - `Read` (Public Read Only) — 조직 전체 읽기 가능, 쓰기는 owner/share.
  - `ReadWrite` (Public Read/Write) — **[default]** Setup UI 에서 Custom Object 생성 시 SF 가 자동 적용하는 값. 모두 수정 가능 — 위험. 명시적 의사 없으면 사용 비권장.
  - `ReadWriteTransfer` (Public Read/Write/Transfer) — Lead/Case 전용. Custom Object 에는 적용 불가.
  - `FullAccess` — Campaign 전용.
  - `ControlledByParent` — Master-Detail 자식이면 강제. 사용자가 선택할 게 아니라 부모-자식 관계에 따라 결정.

  표시 규칙: 후보를 위 순서대로 모두 보여주고, 각 항목에 `[default]`/`[recommend]` 태그와 한 줄 설명. 사용자가 명시 선택하지 않으면 **[recommend] = `Private`** 적용 (SF UI 의 default 인 `ReadWrite` 를 따라가지 않음 — 보안 우선). 다만 SF UI 와의 차이를 사용자에게 명시적으로 알림.
- Allow Activities (Tasks/Events 가능?)
- Allow Reports (보고서 대상?)
- Allow Bulk API / Streaming API / Search?
- Deployment Status: Deployed / In Development

**선택 정보**
- 탭 생성 여부 + 탭 아이콘
- Help Settings (도움말 URL)
- Track Field History
- Activate Feed Tracking

## Step 1.5: design.md 작성

`.harness-sf/designs/{YYYY-MM-DD}-{ApiName}.md` 에 저장. frontmatter `type: sobject`, 본문에 Why/What/How/Edge Cases/Test Strategy/기본 메타 정보/Reviews 섹션.

## Step 1.6: design.md 확인 질의 (recommend + 비즈니스 사유)

draft 직후 AskUserQuestion 으로 역질문. **recommend 는 비즈니스 우선** — 데이터 노출 사고/되돌림 비용/사용자 신뢰 관점.

질문 형식: `[항목] / [후보 + default/recommend] / [recommend 사유 — 비즈니스 우선] / [기술 사유]`.

**확인 카테고리**:

1. **Sharing model**: Private / Read / ReadWrite (UI default) / ReadWriteTransfer / FullAccess / ControlledByParent
   - recommend: 일반적으로 **`Private`**.
   - 사유: "데이터 노출 사고는 거래처 신뢰/컴플라이언스 비용이 운영 편의 ('모두 보이게') 보다 압도적으로 큼. SF UI default 인 `ReadWrite` 와 다름을 명시."

2. **Name field 종류**: Text / AutoNumber
   - recommend: 사람이 부르는 식별자 ("주문번호", "송장번호") 면 **AutoNumber + 의미있는 prefix**. 사용자 자유 입력이면 Text.
   - 사유: "사람이 외우거나 검색하는 ID 가 일관 형식이면 운영 사고 감소. Text 자유 입력은 오타·중복으로 추적 비용 큼."

3. **소프트 삭제 vs 하드 삭제**: hard delete / soft delete (Status=Archived) / archive
   - recommend: 비즈니스 데이터 (주문/계약/거래) 면 **soft delete**. 임시/세션 데이터면 hard.
   - 사유: "지워진 비즈니스 데이터 복구 요구는 거의 항상 옴 — 감사/분쟁/사용자 실수. 데이터 보존 비용 < 복구 불가 비용."

4. **Field History Tracking**: 전체 활성 / 핵심 필드만 / 비활성
   - recommend: 금전·계약·상태 전이 필드 있으면 **핵심 필드만 활성**.
   - 사유: "분쟁/감사 시 '누가 언제 바꿨나' 못 답하면 운영 비용 폭증. 전체 활성은 저장 비용 → 핵심 필드만이 균형."

5. **Activities / Reports / Search 활성화**: 켜기 / 끄기
   - recommend: **"전부 켜기"** (default 와 일치).
   - 사유: "나중에 켜는 것보다 처음부터 켜놓는 게 사용자 발견 비용을 줄임. 끌 사유가 명확할 때만 끄기."

6. **Tab 노출 범위**: 모든 사용자 / Permission Set 받은 사용자만 / 비노출
   - recommend: **"PS 받은 사용자만 (TabVisibilities=Available)"**.
   - 사유: "권한 없는 사용자에게 탭 노출은 혼란만 — 클릭하면 'No access' 만 보임. PS 와 노출을 묶는 게 사용자 경험 일관성."

7. **외부 시스템 sync 대비 External ID 필드**: 신규 만들기 / 미준비
   - recommend: 외부 시스템 통합 가능성 있으면 **"신규 External ID 필드 (Unique=true)"**.
   - 사유: "External ID 없이 시작하면 후속 통합 시 데이터 매칭 비용 폭증. 미리 만든 필드는 비용 거의 없음."

**적용 규칙**: design.md 답 있으면 짧은 확인, 없으면 풀 질문. 다른 선택 시 `## Decisions` 기록. 1~3개씩 묶어.

결과 반영 후 Step 1.7 진행.

## Step 1.7: Persona Reviews (병렬, 최대 3회)

`Agent` 툴로 5개 reviewer 단일 메시지 병렬 호출:
- `sf-design-ceo-reviewer` — 기존 객체 활용 / Big Object / Platform Event 대안 검토
- `sf-design-eng-reviewer` — sharing model 적정성, 관계 모델, name field, 인덱싱, 확장성
- `sf-design-security-reviewer` — OWD 적정성, Master-Detail sharing 상속, PS 전략
- `sf-design-qa-reviewer` — 배포 검증, sharing 변경 영향, PS 부여 walkthrough
- `sf-design-library-reviewer` — AppExchange/Unlocked Package 중복 여부 (대부분 "해당 없음" 반환 가능)

## Step 1.9: 리뷰 통합 + per-risk 사용자 승인 게이트

전체 일괄 [P]roceed 금지. 각 `[H#]`/`[M#]` risk 마다 [1] 진입 / [2] 추가수정 강제 + 1줄 사유(8자+) 의무. HIGH 1건이라도 [2] → 해당 persona 만 재호출 (revision N+1, `revision_block_personas` 갱신). HIGH 모두 [1] → 사유들이 design.md `## Review Resolution` 자동 채움 → Step 1.92 진행. MEDIUM 동일, LOW 묻지 않음. iteration cap: revision 5회 또는 동일 persona 연속 2회 HIGH → 명시 override. 진행 카운터 `[3/N]` 표시.

상세 게이트 동작은 `/sf-feature` Step 5 참조.

## Step 1.92: design 승인 sentinel 발급 (필수)

승인 직후 Bash 실행:
```bash
node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{YYYY-MM-DD}-{ObjectApiName}.md
```
이 sentinel 이 있어야 `force-app/main/default/objects/{ApiName}/...` 신규 메타 파일 Write 가 통과한다 (TTL 2h + git HEAD match). 없으면 `pre-create-design-link-gate.js` 가 차단.

## Step 1.93: 점수 기록 (advisory)

승인 sentinel 직후 `node .claude/hooks/_lib/score-cli.js compute-design .harness-sf/designs/{...}.md {ObjectApiName}`. 보고용. 이후 `sf-deploy-validator` 통과 시 `score-cli.js record {slug} deploy 10` 호출 권장.

## Step 1.95: 라이브러리 도입 (해당 시)

sObject 단계에서는 라이브러리 도입이 드물지만, design.md `## Decisions` 에 명시된 경우(예: 사내 unlocked package 의 base 객체 의존) `/sf-library-install` delegated 모드로 호출. 없으면 skip.

## Step 2: 모드 결정 (CREATE vs MODIFY)

- `Glob force-app/**/objects/{ApiName}/{ApiName}.object-meta.xml` 로 객체 디렉토리 존재 여부 확인.
- 표준 객체와 이름 충돌 확인 (Account, Contact 등) — 충돌이면 즉시 오류.

**없음 → CREATE 모드**: Step 3 이후 진행.

**있음 → MODIFY 모드**:
1. 기존 `{ApiName}.object-meta.xml` 을 `Read`.
2. 다음 요소는 **변경 시 강한 경고 + 명시 승인 필요** (배포된 조직에서 데이터/공유에 직접 영향):
   - `sharingModel` 변경 (특히 Public→Private 또는 Master-Detail 자식이 됨)
   - `nameField.type` 변경 (Text ↔ AutoNumber — 기존 레코드 영향)
   - `enableActivities`, `enableHistory`, `enableFeeds` 끄기 (켜기는 안전, 끄기는 데이터 손실 가능)
   - `deploymentStatus` 를 Deployed 에서 InDevelopment 로 되돌리기
3. listView/탭/help 추가 같은 부가 메타는 안전 — diff 미리보기 후 진행.
4. **사용자 승인 게이트**: 변경 항목과 diff → 확정 후 쓰기. 무음 덮어쓰기 금지.
5. **승인 sentinel 발급 (필수)**: 사용자 승인 응답 직후, Edit/Write 직전에 수정 대상 메타 파일을 모두 인자로 발급:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../objects/{ApiName}/{ApiName}.object-meta.xml ...
   ```
   `pre-modify-approval-gate.js` hook이 sentinel 없으면 차단함 (TTL 30분 + git HEAD 매칭). 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.
6. 필드 추가/수정은 이 스킬에서 다루지 않음 → `/sf-field` 안내.

## Step 3: 메타데이터 생성

**`force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>주문</label>
    <pluralLabel>주문들</pluralLabel>
    <nameField>
        <label>주문 번호</label>
        <type>AutoNumber</type>
        <displayFormat>ORD-{0000}</displayFormat>
        <startingNumber>1</startingNumber>
    </nameField>
    <sharingModel>Private</sharingModel>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>주문 정보 관리</description>
    <enableActivities>true</enableActivities>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableBulkApi>true</enableBulkApi>
    <enableStreamingApi>true</enableStreamingApi>
    <enableHistory>false</enableHistory>
    <enableFeeds>false</enableFeeds>
</CustomObject>
```

## Step 4: 기본 List View 생성

**`force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListView xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>All</fullName>
    <filterScope>Everything</filterScope>
    <label>All</label>
</ListView>
```

## Step 5: 탭 생성 (요청 시)

**`force-app/main/default/tabs/{ApiName}.tab-meta.xml`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
    <customObject>true</customObject>
    <motif>Custom20: Cash</motif>
    <label>주문</label>
</CustomTab>
```

아이콘 motif는 사용자에게 선택지 제시 (기본 제공 motif 목록 또는 Custom Image).

## Step 6: 권한 설정 가이드

객체만 만들고 권한 부여는 분리 — **Permission Set** 권유:
- 새 PS 만들기 또는 기존 PS에 추가
- Object Access (Read/Create/Edit/Delete/View All/Modify All)
- 별도 스킬 또는 수동 작업으로 안내

⚠️ **Profile에 직접 권한 부여 비권장** — Permission Set이 모범

## Step 7: 영향 알림
- 새 객체이므로 영향받는 기존 컴포넌트는 없음
- 향후 필드 추가/수정 시 `/sf-field` 사용 권유
- 트리거/Flow는 `/sf-apex` 또는 Flow Builder

## Step 8: 보고
- 생성 파일 목록 (path)
- API name, sharing model, name field type
- 다음 단계 권장:
  1. 필드 추가 (`/sf-field`)
  2. Permission Set 부여
  3. Page Layout 구성
  4. (필요 시) 트리거/Flow

## AskUserQuestion 정책
다음은 반드시 확인:
- 라벨, 복수형 라벨, API name
- Name field 종류 (text vs auto-number)
- Sharing model — 후보 6개를 `[default]`/`[recommend]` 표기로 제시하고 명시 선택 받기 (무응답 시 `Private`, SF UI default 인 `ReadWrite` 와의 차이 명시)
- 탭 생성 여부

다음은 기본값 적용 후 사용자에게 알림:
- enableActivities=true, enableReports=true, enableSearch=true, enableBulkApi=true
- 변경 원하면 알려달라고 안내

## 산출물 위치
- `force-app/main/default/objects/{ApiName}/{ApiName}.object-meta.xml`
- `force-app/main/default/objects/{ApiName}/listViews/All.listView-meta.xml`
- `force-app/main/default/tabs/{ApiName}.tab-meta.xml` (옵션)

## 안티패턴 거부
- API name에 namespace prefix 직접 넣기 거부 (sfdx-project가 자동)
- Public Read/Write를 디폴트로 거부 (사용자 명시 시만)
- Master-Detail 자동 생성 거부 — `/sf-field`에서 별도 처리
