# Phase 0 contracts

The single source of truth that every downstream phase depends on. Keep in sync with the design.md `## Decisions` section when changing.

| File | Definition | Phases that use it |
|---|---|---|
| `failure-class.ts` | run-log failure-classification enum | 2, 3, 4 |
| `expected.ts` | fixture `expected.json` schema + finding-category closed enum | 1, 3 |
| `decisions.ts` | AskUserQuestion mock-injection schema | 1, 5 |
| `run-log.ts` | `meta.json` whitelist + `trace.jsonl` event | 2, 4, 5 |
| `agent-runner.ts` | runner interface — SDK isolation | 1, 2, 5 |
| `normalize-policy.ts` | snapshot normalization policy (exact-match path) | 1, 5 |

## Matching rules (expected.findings)

Used by `harness/eval/score.ts`:

- Category: closed enum, **exact match**.
- Severity mismatch → partial credit 0.5.
- Locator file match +0.25, symbol match +0.25.
- Finding outside expected → false positive (the heart of `clean-baseline`).
- Finding in expected but missing → false negative.

## decisions.json `questionId` convention

The skill side must assign a stable ID to every AskUserQuestion call. No text matching — the mock survives even when the question wording changes.

## meta.json whitelist

Only the fields in the `Meta` schema are allowed. Forbidden: serializing `process.env`, HTTP headers, raw args. zod `.strict()` automatically rejects extra fields.
