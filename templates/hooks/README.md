# harness-sf hooks

Project-local Claude Code hooks shipped by `harness-sf`. Wired into `<consumer-project>/.claude/settings.json` by the installer (safe-merge). Skipped by `--global` installs since they need absolute project paths and project state.

Each hook is a zero-dep Node script. Shared utilities live in `_lib/`.

## Hook table

| Hook | Event | Role |
|---|---|---|
| `session-start-context.js` | `SessionStart` | Inject `.harness-sf/PROJECT.md` + `local.md` + target-org summary + most-recent design.md as `additionalContext`. Skill `Step 0.5` becomes a 1-line confirmation instead of a Read step. |
| `pre-write-path-guard.js` | `PreToolUse` (Write/Edit/MultiEdit) | Per-`CLAUDE_AGENT` allow-prefix check. Reviewers are explicitly forbidden from Write (defense-in-depth alongside their `tools:` frontmatter). Also enforces a global deny on `force-app/**/profiles/**.profile-meta.xml` for ALL agents (including main) — Permission Set only. Escape hatch: `HARNESS_SF_ALLOW_PROFILE_EDIT=1`. |
| `pre-modify-approval-gate.js` | `PreToolUse` (Write/Edit/MultiEdit) | For paths under `force-app/**`: if the file already exists (MODIFY mode), require a fresh approval sentinel at `.harness-sf/.cache/modify-approvals/<key>.json` (TTL 30 min + git HEAD match). Sentinels issued by skills via `_lib/issue-modify-approval.js` after explicit user approval of the diff plan. CREATE mode (file absent) passes through. Escape hatch: `HARNESS_SF_OVERRIDE='modify:<reason>'` (>= 8 non-whitespace chars). |
| `pre-create-design-link-gate.js` | `PreToolUse` (Write/Edit/MultiEdit) | For paths under `force-app/main/default/{classes,triggers,lwc,aura,objects}/**`: if the file does NOT exist (CREATE mode), require ANY fresh design approval sentinel under `.harness-sf/.cache/design-approvals/` (TTL 2h + git HEAD match). Sentinels issued by design-first skills (`/sf-apex` Step 1.92, `/sf-lwc` Step 1.92, `/sf-sobject` Step 1.92, `/sf-feature` Step 5.2) via `_lib/issue-design-approval.js` after the 5-persona review approval gate. The issuance script validates frontmatter `type` ∈ {apex, lwc, aura, sobject, field, feature} and requires `name`. MODIFY mode passes through. Escape hatch: `HARNESS_SF_OVERRIDE='create:<reason>'`. |
| `pre-deploy-gate.js` | `PreToolUse` (Bash) | Match `sf project deploy start` (also `sfdx force:source:deploy`); deny unless `.harness-sf/last-validation.json` exists, is <30 min old, has `validation_result: Succeeded`, `head_sha` matches `git rev-parse HEAD`, and `coverage_overall >= target` (default 75; override via `PROJECT.md`'s `coverage_target_percent: NN` line, or `HARNESS_SF_COVERAGE_TARGET` env). Escape hatch: `HARNESS_SF_OVERRIDE='deploy:<reason>'`. The validator agent (`sf-deploy-validator`) writes the sentinel only when its judgment is `READY TO DEPLOY` and must include `coverage_overall` (number 0–100). |
| `pre-library-install-gate.js` | `PreToolUse` (Bash) | Match library install commands (`sf package install -p 04t...`, `git clone <github-url> force-app/...`, `git submodule add ...`, `npm install <name>`, `curl ... force-app/.../staticresources/...`); deny unless a fresh approval sentinel exists at `.harness-sf/.cache/library-approvals/<hash>.json` (TTL 30 min + git HEAD match). Sentinels issued by `/sf-library-install` Step 5.5 via `_lib/issue-library-approval.js` after plan dump + user approval. The issuance script regex-validates the identifier shape (04t prefix / github.com host / valid npm name / http(s) URL) — Iron Law for "no hallucinated identifiers". Escape hatch: `HARNESS_SF_OVERRIDE='library:<reason>'`. |
| `stop-reviewer-validate.js` | `SubagentStop` | For `sf-design-{ceo,eng,security,qa,library}-reviewer` only — block reviewer outputs that emit a `block` verdict or exceed 80 lines, and ask them to revise. |
| `stop-analyzer-validate.js` | `SubagentStop` | For analyzer agents (`sf-context-explorer`, `sf-flow-analyzer`, `sf-trigger-auditor`, `sf-lwc-auditor`, `sf-bug-investigator`) — enforce body ≤80 lines AND require the body to end with a `detail: .harness-sf/reports/{agent}/...` pointer line, so detail dumps are never inlined into parent context. |
| `statusline.js` | `statusLine` | Single line: target-org · active design · dispatch progress · last-validation age. Reads `.harness-sf/.cache/org.json` (5-min TTL) to avoid running `sf` every refresh. |

## Sentinel files

Hook gates and orchestration helpers read state from JSON files under `.harness-sf/.cache/`:

| Path | Issued by | Consumed by | TTL |
|---|---|---|---|
| `modify-approvals/<key>.json` | `_lib/issue-modify-approval.js` (skills) | `pre-modify-approval-gate.js` | 30 min |
| `design-approvals/<hash>.json` | `_lib/issue-design-approval.js` (skills, after 5-persona review) | `pre-create-design-link-gate.js` | 2h |
| `library-approvals/<hash>.json` | `_lib/issue-library-approval.js` (`/sf-library-install`) | `pre-library-install-gate.js` | 30 min |
| `delegated-mode/<hash>.json` | `_lib/issue-delegated-token.js` (`/sf-feature` Step 6 per artifact) | `_lib/check-delegated-token.js` (sub-skill Step 0) | 30 min |
| `dispatch-state/<feature-slug>.json` | `_lib/dispatch-state-cli.js init` (`/sf-feature` Step 6.0) | `_lib/dispatch-state-cli.js` (start/done/fail/skip) + `statusline.js` | — (lifecycle of the feature) |
| `last-validation.json` | `sf-deploy-validator` agent | `pre-deploy-gate.js` | 30 min |

All approval/token sentinels also bind to `git rev-parse HEAD` — any new commit invalidates them, forcing fresh approval. Dispatch state stores `head_sha` for resume-time validation but does not auto-expire (a feature can legitimately span hours).

## `_lib/`

Shared utilities + CLIs reused across hooks and skills:

- `sentinel.js` — generic TTL + git-HEAD validation reused by all gate hooks and token issuers
- `output-cap.js` — SubagentStop transcript reading + line-counting + block-decision emission, shared by `stop-reviewer-validate.js` and `stop-analyzer-validate.js`
- **Approval issuers** (called by skills via Bash after user approval):
  - `issue-modify-approval.js` — MODIFY mode diff approval
  - `issue-design-approval.js` — design.md 5-persona review approval
  - `issue-library-approval.js` — library install plan approval
- **Dispatch orchestration** (called by `/sf-feature`):
  - `validate-design.js` — design.md schema + DAG check (Step 3.9)
  - `dispatch-state.js` + `dispatch-state-cli.js` — machine-readable progress record (Step 6.0/6.1)
  - `issue-delegated-token.js` — per-artifact delegated-mode token (Step 6.1, before each sub-skill call)
  - `check-delegated-token.js` — sub-skill Step 0 verification of the above

## Extending

When adding new enforcement, evaluate "is this a hook, or just a prompt?". If it's a hook:

1. Add the script under `templates/hooks/` (zero-dep, Node 18+).
2. Register it in `templates/_stubs/settings.json` so the installer's safe-merge picks it up.
3. Never bypass `installSettings()` to write settings directly.
4. Add the row to the table above.

Emergency override is unified under `HARNESS_SF_OVERRIDE='<scope>:<reason>'` where scope ∈ {create, modify, design, deploy, library, all} and reason has ≥ 8 non-whitespace chars. Every use writes one line to `.harness-sf/audit.log` (sha256 hash chain — `hsf audit verify` detects tampering, `hsf audit tail` shows recent uses). Legacy `HARNESS_SF_SKIP_*=1` flags are removed and now emit a migration error.
