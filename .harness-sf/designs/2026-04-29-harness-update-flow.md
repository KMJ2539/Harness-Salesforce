---
type: feature
name: harness-update-flow
date: 2026-04-29
author: mjkang2539
status: draft-v1
revision: 1
---

# harness-sf 업데이트 플로우 (`update` 서브커맨드 + `/sf-harness-update` 스킬)

## Why (background / problem)

현재 `harness-sf`는 **install-once** 모델이다. 사용자가 한 번 `npx harness-sf init`으로 설치한 뒤 templates/가 갱신돼도, 기존 설치본을 안전하게 업그레이드할 경로가 없다.

존재하는 옵션은:
- `init --force` — 사용자 커스터마이즈를 무차별 덮어씀. destructive.
- `init` (인터랙티브) — 모든 파일에 대해 y/N 프롬프트. 변경 없는 파일까지 묻기 때문에 노이즈가 큼.
- 수동 git pull + 복사 — 사용자에게 책임 전가.

결과적으로 사용자는 **업그레이드를 미루거나, 한 번 덮어씌우고 커스터마이즈를 잃거나** 둘 중 하나를 한다. 두 경우 모두 harness 가치를 깎는다.

## Non-goals

- 멀티 버전 동시 설치 / 롤백 기능. (단순 forward-only 업데이트.)
- 사용자 커스터마이즈를 자동 머지하는 3-way merge UI. (충돌 시 사용자 선택만 받는다.)
- `templates/` 자체의 zero-dep 원칙 변경. installer는 여전히 dep-free.
- `--global` 설치본의 manifest 추적. (project-local 우선.)

## Design

### 두 레이어로 분리

**Layer 1 — `bin/install.js` 의 `update` 서브커맨드 (정공법, 우선 구현)**
- `.claude/.harness-sf-manifest.json` 에 설치 시점 파일 해시 + 버전 + 출처 경로 기록.
- `update` 호출 시 manifest를 읽어 4-way 분류:
  - **unchanged** — 사용자 미수정 + 템플릿 미변경 → no-op.
  - **upstream-only** — 사용자 미수정 + 템플릿 변경 → silent overwrite.
  - **user-only** — 사용자 수정 + 템플릿 미변경 → 보존.
  - **conflict** — 사용자 수정 + 템플릿 변경 → 인터랙티브 프롬프트 (`y/N/d=diff/s=skip-all`).
- 삭제된 템플릿(예: deprecated agent) → 사용자 미수정이면 자동 제거, 수정됐으면 보존+경고.
- 마지막에 manifest를 새 해시로 갱신.

**Layer 2 — `templates/skills/sf-harness-update/SKILL.md` (얇은 UX 레이어)**
- Claude Code 안에서 자연어로 트리거할 수 있게 슬래시 스킬 제공.
- 본질은 `npx harness-sf@latest update` 셸아웃 + 결과 요약 + CHANGELOG diff 표시.
- 스킬은 update 로직을 재구현하지 않는다. installer가 single source of truth.

### Manifest 스키마

`.claude/.harness-sf-manifest.json`:
```json
{
  "version": "0.x.y",           // installer package.json version at install time
  "installedAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "files": {
    "agents/sf-context-explorer.md": {
      "sha256": "abc...",        // hash at last install/update
      "templateSha256": "abc...", // hash of source template at that moment
      "source": "templates/agents/sf-context-explorer.md"
    },
    ...
  }
}
```

설치 시점 해시와 현재 디스크 해시를 비교해 "사용자 수정 여부"를 판정. 템플릿 해시 변경은 "upstream 변경 여부"를 판정. 두 비트로 4-way 분류.

### settings.json 처리

`installSettings()`의 safe-merge는 이미 멱등이라 update에서도 그대로 재사용. 추가 작업 불필요. 단 manifest는 settings.json을 추적하지 않는다 (사용자/팀 영역).

### PROJECT.md / local.md / .gitignore

이미 "절대 덮어쓰지 않음" 규칙이 있어 update에서도 동일하게 동작. manifest 추적 대상에서 제외.

### Hook scripts (`templates/hooks/`)

manifest 추적 대상 — 사용자가 hook을 직접 수정한 경우는 드물지만 충돌 처리는 동일하게 적용.

## Affected files

- `bin/install.js` — `update()` 함수 추가, `manifestRead/Write/Compute`, conflict prompt, `cmd === 'update'` 라우팅, `help()` 갱신.
- `bin/install.js` — `init()` 종료 시 manifest 작성하도록 후크 추가.
- `templates/skills/sf-harness-update/SKILL.md` — 신규.
- `README.md` — `update` 명령어 + `/sf-harness-update` 스킬 문서화.
- `package.json` — version 노출 경로 확인 (이미 require 가능).

## Risks / open questions

1. **Manifest 부재 (legacy 설치)** — 첫 update 시 manifest가 없으면? → "현재 디스크 = 미수정" 으로 가정하고 manifest 생성 후 정상 update 진행. 한 번의 무손실 마이그레이션 경로.
2. **해시 알고리즘** — sha256, Node 내장 `crypto` 모듈로 zero-dep 유지.
3. **Windows 줄바꿈** — copyFileSync는 바이너리 카피라 LF/CRLF 보존. 사용자가 에디터에서 normalize 하면 "사용자 수정"으로 잡힘. 첫 update 시 false-positive conflict 가능 → 정규화 후 비교 옵션 검토.
4. **`/sf-harness-update` 스킬의 셸아웃 권한** — `npx harness-sf@latest update` 가 permissions.allow에 추가돼야 마찰 없이 실행. settings.json stub에 포함시킬지 여부 결정 필요.
5. **버전 다운그레이드** — manifest의 version > package.json version 인 경우 경고만 하고 진행할지, 차단할지.

## Phasing

- **Phase 1**: `update` 서브커맨드 + manifest. CLI 단독으로 동작.
- **Phase 2**: `/sf-harness-update` 스킬 (Phase 1 안정화 후 얇게 추가).
- **Phase 3** (옵션): `update --check` (변경 사항만 보고, 쓰지 않음 — `--dry-run`과 별개로 manifest 갱신도 안 함).

## Decisions needed

- D1: legacy 설치(manifest 없음) 마이그레이션 — 위 안(무손실 가정)으로 OK?
- D2: conflict 프롬프트의 기본값 — `N` (보존) vs `y` (덮어쓰기). **추천: N** — 사용자 작업 보호 우선.
- D3: 삭제된 템플릿 처리 — manifest엔 있고 templates/엔 없음 → 사용자 미수정이면 silent delete vs 항상 confirm. **추천: silent delete + 요약에 카운트 표시.**
- D4: `/sf-harness-update` 스킬을 Phase 1과 동시에 낼지 분리할지. **추천: 분리** — installer가 stable 해야 스킬도 의미 있음.
