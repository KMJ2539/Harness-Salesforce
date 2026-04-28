---
name: sf-field
description: SObject(표준/커스텀)에 필드를 추가하거나 수정(ensure 시맨틱). 같은 API name 필드가 없으면 생성, 있으면 diff 승인 후 수정. 모든 필드 타입 지원(Text, Number, Picklist, Lookup, Master-Detail, Formula, Roll-up Summary 등). 추가/변경 전 sf-context-explorer로 객체 영향 분석. "필드 추가", "Account.Status 라벨 변경", "picklist 값 추가", "Lookup 필드 생성" 같은 요청 시 사용.
---

# /sf-field

SObject 필드를 **ensure 모드**로 다룸 — 같은 API name이 없으면 생성, 있으면 수정. 표준 객체와 커스텀 객체 모두 지원.

## Step 0: 호출 모드 판별

호출자(`/sf-feature` 등)가 feature design.md 경로 + artifact ID 를 전달하면 **delegated 모드 후보**. sentinel 로 검증:
```bash
node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
```
exit 0 → delegated 모드 확정 (design.md 의 해당 field artifact 섹션 — 객체, API name, 타입, 길이/picklist 값 등 — 로드 후 Step 1 의 질문 배터리 건너뛰고 Step 2 컨텍스트 분석부터 실행, 완료/실패 시 호출자가 dispatch-state-cli 로 status 갱신).
exit 1 → standalone 모드 (아래 Step 0.3 부터).

## Step 0.3: feature 컨텍스트 게이트 (standalone 진입 시 필수)

```bash
node .claude/hooks/_lib/check-feature-context.js
```

`has_active_feature: true` 이고 type=`field` pending artifact 존재 시 AskUserQuestion 으로 redirect 제안: `[r]` `/sf-feature` / `[s]` 사유 입력 후 stub (`type: field, standalone_override: true`) / `[a]` abort. 매칭 없으면 통과. bypass: `HARNESS_SF_SKIP_FEATURE_GATE=1`.

## Step 1: 의도 명확화

**필수 정보**
- 대상 객체 (예: `Account`, `Order__c`)
- 라벨 (한국어 OK)
- API name (자동 제안: 라벨에서 변환, `__c` suffix는 자동)
- 필드 타입 (아래 목록)
- 설명 (description)
- Help text (사용자에게 보일 도움말)
- Required 여부
- Unique 여부 (해당 시)
- External ID 여부 (해당 시)

**필드 타입 목록**
| 타입 | 추가 정보 |
|---|---|
| Text | length (최대 255) |
| Long Text Area | length (최대 131,072), 보이는 줄 수 |
| Rich Text Area | length, 줄 수 |
| Text Area | (멀티라인, 255 고정) |
| Email | — |
| Phone | — |
| URL | — |
| Number | precision, scale |
| Currency | precision, scale |
| Percent | precision, scale |
| Date | — |
| Date/Time | — |
| Time | — |
| Checkbox | default value |
| Picklist | values, restricted, controlling field |
| Multi-Select Picklist | values, visible lines |
| Lookup | referenceTo, deleteConstraint (SetNull/Restrict/Cascade) |
| Master-Detail | referenceTo, sharing 설정, reparenting |
| External Lookup | external object |
| Formula | returnType, formula expression |
| Roll-up Summary | summarizedField, aggregation, filter |
| Auto Number | displayFormat, startingNumber |
| Geolocation | scale, displayLocationInDecimal |
| Encrypted Text | maskType, length |

## Step 2: 컨텍스트 분석 (필수)

**`Agent` 툴로 `sf-context-explorer` 호출** — 객체와 필드 변경 의도 전달.

특히 다음 영향 영역 확인:
- 객체에 작동하는 트리거/Flow가 이 필드를 참조하게 될지
- Validation Rule 추가 필요한지
- 페이지 레이아웃, 검색 레이아웃, list view 추가 필요
- Permission Set FLS 부여 필요
- Report Type 갱신 필요
- LWC/Aura에서 이 객체 사용 중이라면 import 추가 필요

⚠️ **표준 객체에 추가 시**: 강한 경고. 표준 필드와 충돌 없는지 확인.

## Step 2.5: 모드 결정 (CREATE vs MODIFY)

`Glob force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml` 로 필드 파일 존재 여부 확인:

**없음 → CREATE 모드**: Step 3 이후 진행.

**있음 → MODIFY 모드**:
1. 기존 `.field-meta.xml` 을 `Read`.
2. 다음 변경은 **데이터 영향이 큼 — 강한 경고 + 명시 승인 필요**:
   - `type` 변경 (예: Text → Picklist, Number → Currency) — 기존 데이터 손실/변환 위험
   - `length` 축소 (잘림) / `precision`·`scale` 축소
   - `required` false → true (기존 NULL 레코드 깨짐)
   - `unique` false → true (중복 레코드 있으면 실패)
   - Master-Detail 의 `referenceTo` 변경 (재부모화 정책)
   - Picklist `restricted` true 로 전환 (기존 값 정합 확인 필요)
   - Picklist 값 삭제 (기존 레코드의 값이 inactive 처리됨)
3. 다음은 안전한 변경:
   - `label`, `description`, `inlineHelpText` 갱신
   - Picklist 값 **추가** (삭제 아님)
   - `length` 확장, `precision` 확장
4. **사용자 승인 게이트**: 변경 항목별 위험도와 diff → 확정 후 쓰기.
5. **승인 sentinel 발급 (필수)**: 사용자 승인 응답 직후, Edit/Write 직전에 발급:
   ```bash
   node .claude/hooks/_lib/issue-modify-approval.js force-app/.../objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml
   ```
   `pre-modify-approval-gate.js` hook이 sentinel 없으면 차단함 (TTL 30분 + git HEAD 매칭). 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.
6. 이 필드를 참조하는 LWC/Apex/Flow/Validation Rule(Step 2 결과) 영향 재평가.

## Step 3: 필드 메타데이터 생성

**`force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml`**

타입별 예시:

**Text**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Status__c</fullName>
    <label>상태</label>
    <type>Text</type>
    <length>50</length>
    <required>false</required>
    <unique>false</unique>
    <description>현재 상태</description>
    <inlineHelpText>레코드의 현재 상태를 입력하세요</inlineHelpText>
</CustomField>
```

**Picklist**
```xml
<type>Picklist</type>
<valueSet>
    <restricted>true</restricted>
    <valueSetDefinition>
        <sorted>false</sorted>
        <value>
            <fullName>Active</fullName>
            <default>true</default>
            <label>활성</label>
        </value>
        <value>
            <fullName>Inactive</fullName>
            <default>false</default>
            <label>비활성</label>
        </value>
    </valueSetDefinition>
</valueSet>
```
**권장**: Global Value Set 분리 (재사용 가능).

**Lookup**
```xml
<type>Lookup</type>
<referenceTo>Contact</referenceTo>
<relationshipLabel>주문</relationshipLabel>
<relationshipName>Orders</relationshipName>
<deleteConstraint>SetNull</deleteConstraint>
```

**Master-Detail**
```xml
<type>MasterDetail</type>
<referenceTo>Account</referenceTo>
<relationshipLabel>주문</relationshipLabel>
<relationshipName>Orders</relationshipName>
<reparentableMasterDetail>false</reparentableMasterDetail>
<writeRequiresMasterRead>false</writeRequiresMasterRead>
```
⚠️ Master-Detail 추가 시: 자식 객체의 sharing model이 "Controlled by Parent"가 됨. 기존 데이터 영향 경고.

**Formula**
```xml
<type>Text</type>  <!-- 또는 returnType -->
<formula>IF(ISBLANK(Status__c), "Unknown", Status__c)</formula>
<formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>
```

**Roll-up Summary** (Master-Detail 자식에 한해)
```xml
<type>Summary</type>
<summarizedField>Order__c.Amount__c</summarizedField>
<summaryForeignKey>Order__c.Account__c</summaryForeignKey>
<summaryOperation>sum</summaryOperation>
```

## Step 4: 권한 부여 가이드

필드만 만들고 FLS는 분리 — **Permission Set 갱신 권유**:
```xml
<!-- PermissionSet 파일에 추가 -->
<fieldPermissions>
    <field>ObjectApiName.FieldApiName__c</field>
    <readable>true</readable>
    <editable>true</editable>
</fieldPermissions>
```
대상 PS 사용자에게 묻고, 자동 갱신 또는 수동 안내.

## Step 5: 영향 영역 후속 권장
context-explorer 결과 기반으로:

- 트리거가 이 필드 활용하면 → "트리거 수정 필요. `/sf-apex` 또는 직접 편집"
- Flow 수정 필요하면 → "Flow Builder UI 또는 메타데이터 직접 편집"
- LWC schema import 추가 필요 → 해당 컴포넌트 list 보고
- Page Layout/Lightning Page에 노출하려면 → 별도 작업 필요
- Report Type 사용자 정의 필드 노출 필요 시 → 안내

## Step 6: 보고
- 생성 파일 (path)
- 필드 정보 요약
- 영향 영역 인벤토리 (context-explorer 결과)
- 권장 후속 작업 (1~5번 우선순위)

## AskUserQuestion 정책
- 대상 객체, 라벨, 필드 타입 (필수)
- 타입별 추가 파라미터 (length, picklist values 등)
- Required, Unique, External ID
- description, help text — 명시 권장 (관리성)

## 안티패턴 거부
- description 없이 생성 거부 — 미래의 디버깅 비용
- Picklist에 unrestricted + 다수 사용자 입력 조합 거부 (data quality 폭망)
- Master-Detail 추가 시 기존 데이터 있으면 강한 경고
- 표준 객체 필드 추가 시 sharing/profile 영향 명시

## 산출물 위치
- `force-app/main/default/objects/{ObjectApiName}/fields/{FieldApiName}.field-meta.xml`
- (옵션) PermissionSet 갱신
