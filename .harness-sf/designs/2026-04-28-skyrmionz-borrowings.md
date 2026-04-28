---
type: harness-improvement
date: 2026-04-28
status: draft
source: skyrmionz/harnessforce 비교 분석 결과
---

# skyrmionz 차용 4종 통합 plan

목표: 컨텍스트 예산 절감 + 팀/개인 설정 분리 + 배포 게이트 강화 + agent 보고 비용 절감.
zero-dep 인스톨러 / design-first 리뷰 / ensure-mode 게이트는 그대로 유지.

---

## 작업 1. Knowledge lazy-load 분리

### 문제
agent 프롬프트들이 governor limits, Order of Execution, sharing/FLS 룰, async 타이밍 등을 각자 본문에 풀어 적고 있음. 같은 룰이 여러 agent에 중복되어 토큰을 매 호출마다 태움.

### 변경
- `templates/knowledge/` 신규 디렉터리. 토픽별 1파일:
  - `order-of-execution.md`
  - `governor-limits.md`
  - `sharing-fls-crud.md`
  - `async-mixed-dml.md`
  - `apex-test-patterns.md`
  - `lwc-data-access.md`
  - `metadata-deploy-rules.md`
  - `soql-anti-patterns.md`
- 각 agent 프롬프트 본문에서 해당 룰 본문 제거 → "필요 시 `Read templates/knowledge/{topic}.md`로 로드" 한 줄 인덱스로 대체.
- `bin/install.js`의 `installCategory` 호출에 `knowledge` 카테고리 추가. `--knowledge-only` 플래그도 같이.
- 설치 위치: `.claude/knowledge/` (agents/skills와 형제).

### 영향 파일
- 신규: `templates/knowledge/*.md` (8개)
- 수정: `templates/agents/sf-*.md` 전부 (룰 본문 → 인덱스 참조로)
- 수정: `bin/install.js` (카테고리 추가, list 출력, --knowledge-only)
- 수정: `CLAUDE.md` "Architecture / Two-layer agent design" 섹션에 knowledge 레이어 추가 (3-layer로)

### 비호환 / 위험 (분석 반영)
- Read 누락 → **명령형 Step + self-check로 완화**. agent 프롬프트에 "Step N 시작 전 반드시 Read" 명령형 + 작업 끝에 "sharing 결정을 했다면 sharing-fls-crud.md를 Read 했는가? 안 했다면 지금 Read" self-check.
- knowledge 파일 누락 시 graceful 처리 → "Read 실패 시 사용자에게 'knowledge 파일 누락' 보고 후 중단" 추가.
- 설치 위치는 `.claude/knowledge/` 고정.

### 측정
- 토큰 줄 수: agent별 before/after `wc -l`. 목표 30% 이상 감소.

---

## 작업 2. deploy-validator 보강 (skyrmionz tool 룰 흡수)

### 문제
현재 `sf-deploy-validator`는 정적 분석은 강하지만 production org 자동 감지, SOQL/Apex 사전 스캔이 약함. skyrmionz는 툴 자체에 이걸 박았는데 우리는 agent 프롬프트로 같은 효과를 낼 수 있음.

### 변경 — `templates/agents/sf-deploy-validator.md`
1. **Production org 자동 감지** (Step 0 신규):
   ```
   Bash: sf data query -q "SELECT IsSandbox, Name FROM Organization LIMIT 1" --target-org {alias} --json
   IsSandbox=false → production. 사용자에게 강한 확인 요구하고, deploy validate에 --test-level RunLocalTests 강제. alias 이름 휴리스틱(`prod/production/prd`)보다 우선.
   ```
2. **SOQL 사전 스캔** (Step 2 추가):
   - 큰 표준 객체(Account/Contact/Case/Lead/Opportunity/Task/Event)에 WHERE/LIMIT 없는 쿼리 → 🟡
   - LIKE '%...' leading wildcard → non-selective 🟡
   - Database.query 내부에 String 결합 → 🔴
3. **Apex governor 사전 스캔** (Step 2 추가):
   - for loop body 내부 DML (`insert/update/delete/upsert`) → 🔴
   - for loop body 내부 SOQL (`[SELECT`) → 🔴
   - LIMIT 없는 SOQL on 큰 객체 → 🟡
4. **Test coverage 게이트 강화** (Step 5 출력):
   - orgWideCoverage < 75% → BLOCKED
   - 변경된 클래스 단위 coverage < 75% → BLOCKED (이건 기존에 약함)
5. **write 시 with sharing 자동 검증을 sf-apex skill에서 deploy-validator로 위임** — 중복 제거.

### 영향 파일
- 수정: `templates/agents/sf-deploy-validator.md` (현재 127줄 → 200줄 내)
- 수정: `templates/skills/sf-apex/SKILL.md` (write 시 sharing 검증 룰 → deploy-validator 참조로 위임 한 줄)

### 비호환 / 위험 (분석 반영)
- 추가 쿼리 1회는 validate-only 비용 대비 무시 가능.
- 진짜 위험은 **인증/네트워크 실패로 query가 죽어 게이트 전체가 중단되는 것** → fallback 명시: query 실패 시 alias 이름 휴리스틱(`prod/production/prd`)으로 추정 + "IsSandbox 미확인, alias 이름으로 추정" 경고 출력 후 진행.
- alias가 잘못 매핑됐어도 IsSandbox 결과가 우선.

### 측정
- 가짜 prod alias (sandbox지만 이름이 prod) 케이스에서도 IsSandbox=true면 통과해야 함. 수동 테스트 1건.

---

## 작업 3. PROJECT.md / local.md 2-layer

### 문제
`CLAUDE.md` 한 층이라 팀 공유 룰과 개인 override가 섞임. skyrmionz의 4-layer FORCE.md 패턴 중 우리에게 의미 있는 2층만 채택.

### 변경
- 인스톨러가 `.harness-sf/` 디렉터리에 두 stub 생성 (이미 designs/ 디렉터리는 있음):
  - `.harness-sf/PROJECT.md` — 팀 공유. 커밋 권장. 비어 있으면 생성하지 않음(존재 시만 머지). 인스톨러는 첫 init에서 한 번만 placeholder 생성.
  - `.harness-sf/local.md` — 개인 override. **인스톨러가 `.gitignore`에 자동 추가**.
- agent 프롬프트들이 작업 시작 전 두 파일을 (있으면) Read하도록 명시. 우선순위: `local.md` > `PROJECT.md` > 프로젝트 `CLAUDE.md`.
- 두 파일은 자유 양식. 권장 섹션만 stub에 주석으로 (object naming convention, sharing default, 팀이 금지하는 패턴 등).

### 영향 파일
- 수정: `bin/install.js` — init 마지막 단계에서 `.harness-sf/PROJECT.md` stub 생성, `.gitignore`에 `.harness-sf/local.md` 추가 (이미 있으면 skip)
- 신규: `templates/_stubs/PROJECT.md` — placeholder 본문
- 신규: `templates/_stubs/local.md.example` — 예시
- 수정: 모든 design-first skill의 Step 1 머리말 — "PROJECT.md/local.md 있으면 먼저 Read"
- 수정: `CLAUDE.md` Architecture 섹션 (PROJECT.md 레이어 설명 추가)

### 비호환 / 위험 (분석 반영)
- `.gitignore` 자동 수정 정책:
  - 이미 entry 있으면 skip.
  - `.gitignore` 자체가 없으면 **새로 만들지 않음** — "발견되지 않음, 수동 추가 권장" 경고만 출력 (monorepo에서 부모가 들고 있을 수 있음).
  - 추가 라인은 `# harness-sf` 주석 그룹으로 묶어 사용자가 나중에 식별 가능.
  - **`--force`여도 `.gitignore` 변경은 항상 stdout에 명시 출력** (조용한 변경 금지).
  - `--dry-run`에서 추가될 정확한 라인 미리보기 필수.
- 사용자가 `.harness-sf/`를 통째로 ignore 중인 케이스 → init 시 "design.md도 ignore됨, 의도 확인" 경고 출력.
- `_stubs/`는 templates 카테고리에 안 들어가야 함 → install.js의 카테고리 enum에서 제외.

### 측정
- 빈 프로젝트에서 init → `.harness-sf/PROJECT.md` 생성 + `.gitignore` 1줄 추가. 두 번째 init → 변화 없음.

---

## 작업 4. agent 보고 캡 강화 (파일 dump 패턴)

### 문제
현재 agent들에 "100~250줄 cap"만 있어서, 실제 분석량이 많으면 agent가 cap 안에 우겨넣어 정보 손실. skyrmionz는 ~420 token 넘으면 LLM 요약. 우리는 LLM 호출을 더 추가하지 않고, **상세는 파일로 dump하고 경로만 반환** 패턴으로 같은 효과.

### 변경
모든 agent 프롬프트 끝에 공통 출력 규약 추가:

```
## 출력 규약
- 본문(부모 컨텍스트 반환): H1 제목 + 결론 5줄 + Top 5 finding 각 1줄.
- 상세(긴 표/코드 인용/전체 finding 목록): `.harness-sf/reports/{agent-name}/{YYYYMMDD-HHMMSS}.md` 로 Write.
- 본문 끝에 "상세: {경로}" 한 줄.
- 본문 80줄 초과 금지.
```

- `.harness-sf/reports/` 디렉터리도 `.gitignore`에 추가 (작업 3 stub 시점에 같이).

### 영향 파일
- 수정: `templates/agents/*.md` 전부 — 기존 "## 제약 / 250줄 초과 금지" 섹션을 위 규약으로 교체
- 수정: `bin/install.js` — `.gitignore`에 `.harness-sf/reports/` 추가 (작업 3과 한 번에)
- 수정: `CLAUDE.md` "Output budgets" 항목 업데이트

### Write 권한 부여 정책 (위험 분석 후 옵션 B 채택)

agent를 두 그룹으로 나눠 권한 최소화:

**그룹 1 — 분석자 (Write 부여)**: 출력이 길고 dump 효과 큼
- `sf-context-explorer`, `sf-flow-analyzer`, `sf-trigger-auditor`, `sf-lwc-auditor`, `sf-bug-investigator`
- frontmatter `tools:`에 `Write` 추가
- 프롬프트에 path-prefix 강제: "Write 경로가 `.harness-sf/reports/{agent-name}/`로 시작하지 않으면 즉시 중단하고 사용자에게 보고"

**그룹 2 — reviewer (Write 부여 안 함)**: 원래 출력이 짧음 (rubric + 등급)
- `sf-design-ceo-reviewer`, `sf-design-eng-reviewer`, `sf-design-security-reviewer`, `sf-design-qa-reviewer`, `sf-design-library-reviewer`, `sf-apex-code-reviewer`
- 본문 80줄 cap만 적용. dump 패턴 없음.

**그룹 3 — 이미 Write 보유**: 그대로 유지
- `sf-apex-test-author` (테스트 클래스 생성), `sf-deploy-validator` (필요 시 manifest 작성)
- 출력 규약은 동일 적용 (본문 80줄 + reports/ dump)

### 비호환 / 위험
- 그룹 1의 Write 오용 → path-prefix 자체검증 + self-check로 실질 0에 수렴.
- reviewer는 dump 못 하므로 80줄 안에 못 담을 만큼 길면 절단 발생. 현재 reviewer 출력 실측 결과 대부분 60줄 이하라 무리 없음. 초과 시 "상세는 design.md `## Reviews`에 직접 기록" 규약으로 처리.
- 부모는 경로를 받아 필요시 Read해서 컨텍스트에 가져옴 → 부모 skill 프롬프트에 "상세 필요 시에만 Read" 룰 추가.

### 측정
- 전형적 sf-context-explorer 호출 결과 본문 토큰 수 before/after. 목표 60% 감소.

---

## 실행 순서 (의존성)

1. **작업 1 + 작업 4 먼저 묶음** — 둘 다 agent 프롬프트 일괄 수정. 같은 PR로.
2. **작업 3** — 인스톨러 변경. 독립.
3. **작업 2** — deploy-validator만 단일 파일 변경. 독립.

각 작업 단위로 PR 분리 권장. 작업 1과 4는 모든 agent를 건드리므로 한 PR로 묶는 게 리뷰 효율 좋음.

## 비채택 (지금은 안 함)

- skyrmionz의 model routing / tiered tool loading — Claude Code가 결정하는 영역.
- Agentforce/Data Cloud skill 추가 — 도메인 수요 생기면.
- subagent 결과 LLM 요약 — 추가 LLM 호출 비용. 작업 4의 파일 dump로 대체.

## 미해결 질문

- 작업 1: knowledge 파일을 사용자가 프로젝트별로 override 하고 싶을 때 (예: 우리 회사는 `with sharing` 대신 `inherited sharing` 기본) — `.harness-sf/knowledge-overrides/` 같은 추가 레이어 필요한가? → 일단 작업 3의 PROJECT.md에서 지시 형태로 충분할 듯. 별도 레이어는 보류.
- 작업 4: 파일 dump 위치를 `.claude/` 내부 (.claude/reports/)로 할지 `.harness-sf/reports/`로 할지. → 후자 채택 (.claude는 prompt 자산 전용 유지, .harness-sf는 런타임 산출물).
