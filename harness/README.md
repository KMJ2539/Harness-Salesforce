# harness/ — measurement & verification infrastructure

A separate npm package isolated from `harness-sf`'s zero-dep installer. Provides eval / snapshot / lint / observability / replay infrastructure.

Design doc: `.harness-sf/designs/2026-04-28-harness-hardening.md`

## Directories

```
harness/
├── contracts/        # Phase 0 — AgentRunner / decisions / run-log / expected / failure-class / normalize contracts
├── runner/           # AgentRunner implementations (mock + SDK adapter)
├── fixtures/         # Phase 1 — sfdx-projects starter set
├── eval/             # Phase 1 — score, snapshot comparison
├── lint/             # Phase 3 — apex-rules, lwc-rules, vendored PMD
├── observability/    # Phase 4 — aggregate, dashboard
└── replay/           # Phase 5 — replay, bisect
```

## Commands

```bash
npm install              # from root; workspaces installs harness deps too
npm run test:harness     # vitest
npm run typecheck:harness
```

## Principles

- `templates/` is read-only — this package reads but never modifies it.
- The zero-dep principle of `bin/install.js` is independent — this package is free to use deps.
- Every run-log write must pass through `runner/redact.ts` (security).
- The 6 Phase 0 contracts are the single source of truth for all downstream phases.
