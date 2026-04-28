---
name: sf-library-install
description: Salesforce 프로젝트에 외부 라이브러리/패키지를 안전하게 설치. 5가지 방식(Managed/Unlocked Package / Source Vendoring / Git Submodule / npm devDependency / Static Resource) 중 입력 단서로 자동 추정 또는 사용자 선택. 설치 전 plan 승인 게이트, 설치 후 인벤토리 재검증 + decisions.md 기록. design-first skill 의 ## Decisions 가 라이브러리 도입을 명시했을 때 호출되거나, 사용자가 직접 호출. "fflib 설치", "TriggerHandler 도입", "Nebula Logger install", "이 패키지 깔아줘" 같은 요청 시 사용.
---

# /sf-library-install

Salesforce 프로젝트에 라이브러리/패키지를 추가하는 ensure-mode skill. **Iron Law: 인벤토리에 이미 있으면 install 안 함, 사용자가 명시 입력하지 않은 식별자(04t/git URL/npm명/CDN URL)는 추측 금지.**

## Iron Laws

1. **추측 금지** — 04t 패키지 ID, git URL, npm 패키지명, CDN URL 은 **사용자가 입력하거나 design.md 에 명시한 것만** 사용. skill 이 검색해서 찾아오는 행위 금지.
2. **plan dump 필수** — 모든 외부 호출(network / filesystem / org deploy)은 plan 단계에서 명시하고 사용자 승인 후 실행.
3. **production org 보호** — 대상 org 가 production 이면 강한 확인 게이트. default 는 abort.
4. **충돌 abort** — 같은 namespace prefix 또는 같은 클래스명이 이미 있으면 abort, reuse 권유.
5. **부분 실패 시 rollback 안 함** — 이미 한 작업은 보존하고 사용자에게 명시. 사용자가 직접 정리 결정.

## Step 0: 호출 모드 판별

- **delegated 모드**: 호출자가 design.md 경로 + 라이브러리명 전달 (`/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-feature` 의 Step 1.9 후속). design.md 의 `## Decisions` 에서 도입 결정된 라이브러리만 처리.
- **standalone 모드**: 사용자가 직접 호출. 라이브러리명 + (선택) 식별자 인자.

## Step 1: 대상 라이브러리 식별

### delegated 모드
1. design.md 를 `Read`.
2. `## Decisions` 섹션에서 "도입(adopt)" 으로 표기된 라이브러리 추출. 형식 예:
   ```
   - 라이브러리: TriggerHandler — 도입 (방식 미정)
   - 라이브러리: Nebula Logger 04t5Y0000027FQ7QAM — 도입 (방식 A)
   ```
3. 추출된 라이브러리 목록 + 사용자에게 확정 질문 (1개씩 또는 batch).

### standalone 모드
사용자에게 AskUserQuestion 으로 다음 입력:
- 라이브러리 이름 (자유 텍스트, 식별용)
- 식별자 (있으면): 04t ID / git URL / npm 패키지명 / CDN URL / 없음
- 대상 위치 힌트 (있으면): "force-app/main/default/classes/framework/" 같은 경로

## Step 2: 인벤토리 충돌 체크 (필수, install 전)

**`Glob` + `Grep` 으로 다음을 직접 확인** — 추측 금지.

| 검사 | 명령 |
|---|---|
| 같은 클래스명 존재 | `Glob force-app/**/{LibClassName}.cls` |
| 같은 namespace prefix 사용 | `Grep "<ns>__" force-app/**` (managed package 흔적) |
| 같은 npm 패키지 이미 의존성 | `Read package.json` → dependencies/devDependencies |
| 같은 staticresource 이름 | `Glob force-app/**/staticresources/{name}/` 또는 `{name}.resource-meta.xml` |
| sfdx-project.json packageDirectories dependencies | `Read sfdx-project.json` |

**충돌 시**:
- 정확히 같은 라이브러리·같은 위치 → abort, "이미 설치됨, reuse 권고" 출력
- 다른 라이브러리지만 namespace 충돌 가능성 → abort, 사용자에게 어떻게 할지 질문 (다른 위치로 install / abort)

## Step 3: 설치 방식 결정

### 자동 추정 규칙

| 입력 단서 | 방식 |
|---|---|
| 식별자가 `04t` 로 시작 (15 또는 18자) | **A. Managed/Unlocked Package** |
| 식별자가 `https://github.com/...` 또는 `git@github.com:...` 형태 | **B. Source Vendoring** 또는 **C. Git Submodule** (사용자 선택) |
| 식별자가 `npm:<name>` 또는 `@<scope>/<name>` 또는 명백한 npm 이름 | **D. npm devDependency** |
| 식별자가 `http(s)://...js` 또는 CDN 도메인 (cdn.jsdelivr.net, unpkg.com 등) | **E. Static Resource** |
| 식별자 없음 또는 모호 | AskUserQuestion 으로 5지선다 |

### 5지선다 (모호할 때만)

```
어떤 방식으로 설치하시겠습니까?
A) Managed/Unlocked Package — sf package install (04t ID 필요)
B) Source Vendoring — git clone 후 .cls/.cls-meta.xml 을 force-app 트리에 복사
C) Git Submodule — git submodule add (소스 유지 + 업데이트 추적)
D) npm devDependency — npm i -D (LWC 테스트 도구 등)
E) Static Resource — JS/CSS 파일을 staticresource 로 등록
```

추정한 방식이라도 확인 한 줄 표시 후 진행.

## Step 4: 방식별 Plan 생성

### 4A. Managed/Unlocked Package

**필수 입력 확인**:
- 04t ID (사용자 명시) — 없으면 abort + "release 페이지 등에서 확인 후 다시 호출" 안내
- 대상 org alias — 없으면 `sf org list --json` 으로 default org 조회

**Plan**:
```
방식: A (Managed/Unlocked Package)
명령: sf package install --package <04t...> -o <alias> -w 10 -r
대상 org: <alias> (Production: yes/no)
설치 키: <필요 시 사용자 입력>
예상 시간: ~10분 (대형 패키지는 더 김)
부수 효과: 패키지의 모든 메타데이터가 org 에 추가됨
```

**Production 가드**: 대상 org 가 production 이면 strong confirm — "production install 정말 진행? [y/N]".

### 4B. Source Vendoring

**필수 입력 확인**:
- git URL — 사용자 명시
- (선택) commit SHA / tag — 미지정이면 default branch HEAD, plan 에 명시
- 가져올 파일 패턴 — 라이브러리별로 다름 (사용자 확인). 예: `src/classes/*.cls`, `src/classes/*.cls-meta.xml`
- 대상 디렉토리 — `force-app/main/default/classes/<framework_name>/` 가 기본값, 사용자 확인

**Plan**:
```
방식: B (Source Vendoring)
1) git clone --depth=1 <repo> /tmp/<name>
2) 가져올 파일: <pattern>
3) 대상: <target_dir>
4) apiVersion 정합: 원본 <X> → 프로젝트 sourceApiVersion <Y> 로 갱신
5) 라이선스: <SPDX> — 헤더 보존 + LICENSES/<name>.txt 추가 (해당 시)
6) 배포 + 테스트: sf project deploy start --source-dir <target_dir> -o <alias>
                   sf apex run test --tests <TestClassName> -o <alias>
7) /tmp/<name> 정리
```

### 4C. Git Submodule

**Plan**:
```
방식: C (Git Submodule)
1) git submodule add <repo> <path>
2) git submodule update --init
3) sfdx-project.json packageDirectories 에 path 추가 (필요 시)
4) 배포 + 테스트
```

**주의**: submodule 은 SFDX 빌드/CI 와 호환성 확인 필요 — plan 에 "팀 git workflow 영향 있음" 경고 포함.

### 4D. npm devDependency

**Plan**:
```
방식: D (npm devDependency)
명령: npm i -D <pkg>[@<version>]
변경 파일: package.json, package-lock.json
부수 효과: node_modules/ 갱신
검증: npm ls <pkg>
```

### 4E. Static Resource

**Plan**:
```
방식: E (Static Resource)
1) curl -L -o /tmp/<name>.<ext> <url>
2) 파일 검증: 크기 / SHA256 (사용자가 제공한 경우)
3) 대상: force-app/main/default/staticresources/<ResourceName>/
       또는 단일 파일 force-app/main/default/staticresources/<ResourceName>.<ext>
4) <ResourceName>.resource-meta.xml 생성:
     contentType: application/javascript|text/css|...
     cacheControl: Public
5) 배포: sf project deploy start --source-dir force-app/main/default/staticresources/<ResourceName>* -o <alias>
6) /tmp 정리
```

## Step 5: Plan Dump + 승인 게이트 (공통)

위 plan 을 사용자에게 표시, 다음 항목을 명시:
- 외부 네트워크 호출 도메인 (github.com, registry.npmjs.org, login.salesforce.com 등)
- 파일 시스템 변경 경로
- org deploy 영향 (대상 org alias, production 여부)
- 예상 시간

```
[P]roceed  [E]dit plan  [A]bort
```

Edit 선택 시: 어떤 항목을 수정할지 추가 질문 → plan 갱신 → 다시 Step 5.

### Step 5.5: 승인 sentinel 발급 (필수)

사용자가 [P]roceed 응답한 직후, Step 6 의 install 명령을 실행하기 **전에** 발급:

```bash
node .claude/hooks/_lib/issue-library-approval.js <method> <identifier>
```

`method` ∈ `package` | `git-clone` | `git-submodule` | `npm` | `staticresource`

`identifier` 는 plan 의 식별자 그대로 (04t ID, github URL, npm 패키지명, CDN URL).

`pre-library-install-gate.js` hook 이 sentinel 없으면 `sf package install` / `git clone .. force-app/` / `npm install` / `curl ..staticresources..` 를 차단함 (TTL 30분 + git HEAD 매칭). 사용자 승인 없이 sentinel만 발급하는 것은 정책 위반.

**Iron Law 강제**: `issue-library-approval.js` 는 식별자 형식을 정규식으로 검증한다 — 04t prefix / github.com 호스트 / 유효 npm name / http(s) URL. hallucinated 식별자는 발급 단계에서 즉시 실패.

## Step 6: 실행 (방식별 Bash)

각 방식의 plan 명령을 순서대로 실행. **에러 발생 시 즉시 중단**, 다음 정보 출력:
- 실패한 단계
- 이미 변경된 파일/상태 (rollback 안 함, 사용자 판단)
- 다음 권장 액션 (예: `git checkout -- force-app/...` 으로 vendoring 되돌리기)

각 단계마다 결과 요약 한 줄 출력 (사용자가 진행 상황 가시).

## Step 7: 검증 (방식별)

| 방식 | 검증 |
|---|---|
| A | `sf data query --query "SELECT NamespacePrefix, SubscriberPackageId FROM InstalledSubscriberPackage WHERE SubscriberPackageId LIKE '<04t의 첫 13자>%'" -o <alias>` |
| B | 대상 디렉토리 파일 존재 (Glob) + 테스트 클래스 통과 |
| C | `git submodule status` 출력 + 대상 디렉토리 파일 존재 |
| D | `npm ls <pkg>` 또는 `package.json` diff |
| E | staticresource meta-xml 존재 + org 에 배포됨 (`sf data query --query "SELECT Name FROM StaticResource WHERE Name='<ResourceName>'" -o <alias>`) |

검증 실패 시: install 실패로 간주, 사용자에게 보고 + decisions.md 기록 안 함.

## Step 8: 인벤토리 재검증

`Agent` 툴로 `sf-design-library-reviewer` 1회 재호출 (대상 design.md 또는 dummy design.md 경로 전달). 출력의 `## Project Inventory (실측)` 섹션이 갱신되었는지 확인:
- 갱신됨 → 정상, Step 9 진행
- 갱신되지 않음 → 사용자에게 경고. install 명령은 성공했지만 reviewer 가 인지 못 함 → 인벤토리 패턴 불일치 가능성 (예: vendoring 위치가 reviewer 가 안 보는 경로). 사용자가 다음 design 에서 라이브러리를 활용할 때 reviewer 가 다시 권고할 수 있음을 안내.

## Step 9: `.harness-sf/decisions.md` 기록

파일 없으면 생성, 있으면 append. 형식:

```markdown
## {YYYY-MM-DD} — {라이브러리명} 도입

- **라이브러리**: {이름}
- **버전/SHA**: {tag, commit, 04t 마지막 자리, npm 버전 등 식별 가능한 값}
- **방식**: {A|B|C|D|E}
- **위치**: {경로 또는 "org 전역 namespace <ns>"}
- **사유**: {design.md 경로 + 한 줄 요약 또는 standalone 시 사용자 입력}
- **규약**: {사용 컨벤션 1~3줄 — 라이브러리별 핵심 패턴}
- **라이선스**: {SPDX or "managed package"}
- **install 시각**: {timestamp}
```

이 파일은 향후 `sf-design-library-reviewer` 가 새로운 design 검토 시 **반드시 읽어야 함** — 이미 도입된 것을 또 권고하지 않도록.

## Step 10: 사용 컨벤션 안내 + 마이그레이션 체크리스트

### 사용 컨벤션 안내
라이브러리별로 핵심 사용 패턴 1~3줄 출력. 예 (TriggerHandler):
```
TriggerHandler 설치 완료.
사용 패턴:
1) 객체별 핸들러 클래스: AccountTriggerHandler extends TriggerHandler
2) 트리거 본체 한 줄: trigger AccountTrigger on Account (...) { new AccountTriggerHandler().run(); }
3) 핸들러에서 beforeInsert / afterUpdate 등 가상 메서드 override
다음 단계: /sf-apex 호출 — design 단계에서 reviewer 가 자동으로 TriggerHandler 활용 권고를 생성합니다.
```

### 마이그레이션 체크리스트 (해당 시)

기존 패턴이 새 라이브러리와 다르면 **자동 마이그레이션 금지** — 체크리스트만 출력:

```
기존 트리거 N개 발견 (Glob force-app/**/*.trigger):
 - AccountTrigger.trigger    (15줄, 로직 포함 — 마이그레이션 권고)
 - ContactTrigger.trigger    (8줄, 핸들러 호출만 — 패턴 다름, 검토 필요)
마이그레이션은 객체별로 /sf-apex 의 MODIFY 모드로 진행 권장.
사용자가 명시 요청하지 않으면 자동 변환 안 함 (regression risk).
```

## Step 11: 메인 skill 로 복귀 (delegated 모드만)

호출자(design-first skill)에게 install 결과 요약 반환:
- 성공한 라이브러리 + 위치
- 실패한 라이브러리 + 사유
- decisions.md 갱신 여부
- 인벤토리 재검증 결과

호출자는 결과를 받아 Step 2 (sf-context-explorer) 진행.

## 절대 금지

- **존재하지 않는 04t ID 추측해서 사용** — 가장 위험한 실패 모드. 사용자가 입력한 것만.
- **production org 에 무경고 install**.
- **기존 코드 자동 마이그레이션** — 체크리스트로만.
- **rollback 시도** — 부분 실패 시 사용자가 정리.
- **license 헤더 / copyright 제거** — vendoring 시 보존 필수.
- **검증 단계 건너뛰기** — install 명령 exit 0 = 검증 통과 아님.
