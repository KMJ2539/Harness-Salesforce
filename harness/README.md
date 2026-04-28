# harness/ — 측정·검증 인프라

`harness-sf` 의 zero-dep installer 와 격리된 별도 npm 패키지. eval/snapshot/lint/observability/replay 인프라.

설계 문서: `.harness-sf/designs/2026-04-28-harness-hardening.md`

## 디렉터리

```
harness/
├── contracts/        # Phase 0 — AgentRunner / decisions / run-log / expected / failure-class / normalize 계약
├── runner/           # AgentRunner 구현 (mock + SDK adapter)
├── fixtures/         # Phase 1 — sfdx-projects starter set
├── eval/             # Phase 1 — score, snapshot 비교
├── lint/             # Phase 3 — apex-rules, lwc-rules, vendored PMD
├── observability/    # Phase 4 — aggregate, dashboard
└── replay/           # Phase 5 — replay, bisect
```

## 명령

```bash
npm install              # root 에서, workspaces 가 harness deps 도 설치
npm run test:harness     # vitest
npm run typecheck:harness
```

## 원칙

- `templates/` 는 read-only — 이 패키지는 읽지만 수정하지 않는다.
- `bin/install.js` 의 zero-dep 원칙은 별개 — 이 패키지는 dep 자유.
- 모든 run log 쓰기는 `runner/redact.ts` 통과 필수 (보안).
- Phase 0 의 6개 계약은 후행 phase 의 단일 진실의 원천.
