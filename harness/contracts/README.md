# Phase 0 계약

후행 phase 가 모두 의존하는 단일 진실의 원천. 변경 시 design.md `## Decisions` 와 동기화 필요.

| 파일 | 정의 | 사용 phase |
|---|---|---|
| `failure-class.ts` | run log 실패 분류 enum | 2, 3, 4 |
| `expected.ts` | fixture `expected.json` schema + finding 카테고리 closed enum | 1, 3 |
| `decisions.ts` | AskUserQuestion mock 주입 schema | 1, 5 |
| `run-log.ts` | `meta.json` 화이트리스트 + `trace.jsonl` event | 2, 4, 5 |
| `agent-runner.ts` | runner 인터페이스 — SDK 격리 | 1, 2, 5 |
| `normalize-policy.ts` | snapshot 정규화 정책 (exact-match 노선) | 1, 5 |

## 매칭 규칙 (expected.findings)

`harness/eval/score.ts` 가 사용:

- 카테고리는 closed enum **exact match**.
- severity 불일치 → partial credit 0.5.
- locator file 일치 +0.25, symbol 일치 +0.25.
- expected 외 finding → false positive (`clean-baseline` 핵심).
- expected 내 finding 누락 → false negative.

## decisions.json `questionId` 규약

skill 측은 AskUserQuestion 호출에 안정적 ID 부여 의무. 텍스트 매칭 금지 — 질문 문구가 변해도 mock 이 살아남도록.

## meta.json 화이트리스트

`Meta` schema 의 필드만 허용. `process.env`, HTTP 헤더, raw args 직렬화 금지. zod `.strict()` 로 추가 필드 자동 거부.
