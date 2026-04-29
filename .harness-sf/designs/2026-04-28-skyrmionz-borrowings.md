---
type: harness-improvement
date: 2026-04-28
status: draft
source: skyrmionz/harnessforce comparative analysis
---

# Combined plan: 4 borrowings from skyrmionz

Goals: cut context budget, separate team/personal config, harden the deploy gate, and reduce agent-reporting cost.
Keep the zero-dep installer, design-first review, and ensure-mode gates as-is.

---

## Task 1. Knowledge lazy-load split

### Problem
Agent prompts each spell out governor limits, Order of Execution, sharing/FLS rules, async timing, etc. in their own bodies. The same rules are duplicated across multiple agents and burn tokens on every call.

### Change
- New `templates/knowledge/` directory. One file per topic:
  - `order-of-execution.md`
  - `governor-limits.md`
  - `sharing-fls-crud.md`
  - `async-mixed-dml.md`
  - `apex-test-patterns.md`
  - `lwc-data-access.md`
  - `metadata-deploy-rules.md`
  - `soql-anti-patterns.md`
- In each agent prompt, drop the rule text and replace it with a one-line index entry: "Read `templates/knowledge/{topic}.md` on demand."
- Add a `knowledge` category to the `installCategory` calls in `bin/install.js`. Add a `--knowledge-only` flag too.
- Install location: `.claude/knowledge/` (sibling of agents/skills).

### Affected files
- New: `templates/knowledge/*.md` (8 files)
- Modified: every `templates/agents/sf-*.md` (rule body → index reference)
- Modified: `bin/install.js` (new category, list output, --knowledge-only)
- Modified: `CLAUDE.md` "Architecture / Two-layer agent design" section gets the knowledge layer (becomes 3-layer)

### Compatibility / risk (analysis applied)
- Missed Read → **mitigated with imperative steps + self-check**. Add to the agent prompt: imperative "Must Read before Step N" plus an end-of-task self-check "If you made a sharing decision, did you Read sharing-fls-crud.md? If not, Read it now."
- Graceful handling when the knowledge file is missing → add "On Read failure, report 'knowledge file missing' to the user and stop."
- Install location is fixed at `.claude/knowledge/`.

### Measurement
- Token line count: per-agent before/after `wc -l`. Goal: at least 30% reduction.

---

## Task 2. Beef up deploy-validator (absorb skyrmionz tool rules)

### Problem
`sf-deploy-validator` has strong static analysis but weak production-org auto-detection and SOQL/Apex pre-scan. skyrmionz hardcodes that into the tool, but we can get the same effect via the agent prompt.

### Change — `templates/agents/sf-deploy-validator.md`
1. **Production-org auto-detection** (new Step 0):
   ```
   Bash: sf data query -q "SELECT IsSandbox, Name FROM Organization LIMIT 1" --target-org {alias} --json
   IsSandbox=false → production. Force a strong user confirmation and force --test-level RunLocalTests on deploy validate. This takes precedence over alias-name heuristics (`prod/production/prd`).
   ```
2. **SOQL pre-scan** (added in Step 2):
   - Queries on big standard objects (Account/Contact/Case/Lead/Opportunity/Task/Event) without WHERE/LIMIT → 🟡
   - LIKE '%...' leading wildcard → non-selective 🟡
   - String concatenation inside Database.query → 🔴
3. **Apex governor pre-scan** (added in Step 2):
   - DML inside a for-loop body (`insert/update/delete/upsert`) → 🔴
   - SOQL inside a for-loop body (`[SELECT`) → 🔴
   - SOQL on a big object without LIMIT → 🟡
4. **Stronger test-coverage gate** (Step 5 output):
   - orgWideCoverage < 75% → BLOCKED
   - Per-changed-class coverage < 75% → BLOCKED (currently weak)
5. **Delegate the with-sharing auto-check from sf-apex skill to deploy-validator on write** — remove duplication.

### Affected files
- Modified: `templates/agents/sf-deploy-validator.md` (current 127 lines → keep under 200)
- Modified: `templates/skills/sf-apex/SKILL.md` (sharing-validation rule on write → one-line reference delegating to deploy-validator)

### Compatibility / risk (analysis applied)
- The extra single query is negligible against validate-only cost.
- Real risk: **the gate dies entirely if auth/network failure kills the query** → explicit fallback: on query failure, infer from alias-name heuristic (`prod/production/prd`), emit "IsSandbox unconfirmed, inferred from alias name" warning, then proceed.
- Even if alias is mismapped, the IsSandbox result wins.

### Measurement
- A fake prod alias (sandbox whose name is "prod") must still pass when IsSandbox=true. One manual test.

---

## Task 3. PROJECT.md / local.md 2-layer

### Problem
`CLAUDE.md` is a single layer, mixing team-shared rules with personal overrides. From skyrmionz's 4-layer FORCE.md pattern we adopt only the 2 layers that are meaningful for us.

### Change
- The installer creates two stubs in the `.harness-sf/` directory (the designs/ directory already exists):
  - `.harness-sf/PROJECT.md` — team-shared. Recommended to commit. Don't create when empty (merge only if it exists). The installer creates a placeholder once on first init.
  - `.harness-sf/local.md` — personal override. **The installer auto-adds this to `.gitignore`**.
- Agent prompts must Read both files (if present) before starting work. Priority: `local.md` > `PROJECT.md` > project `CLAUDE.md`.
- The two files are free-form. Recommended sections appear only as comments in the stub (object naming convention, sharing default, team-forbidden patterns, etc.).

### Affected files
- Modified: `bin/install.js` — at the end of init, create the `.harness-sf/PROJECT.md` stub and add `.harness-sf/local.md` to `.gitignore` (skip if already present)
- New: `templates/_stubs/PROJECT.md` — placeholder body
- New: `templates/_stubs/local.md.example` — example
- Modified: header of Step 1 in every design-first skill — "Read PROJECT.md/local.md first, if present"
- Modified: `CLAUDE.md` Architecture section (add PROJECT.md layer description)

### Compatibility / risk (analysis applied)
- `.gitignore` auto-edit policy:
  - Skip if the entry already exists.
  - If `.gitignore` itself is missing, **don't create one** — emit "not found, recommend manual addition" warning only (a parent in a monorepo may own it).
  - Group added lines under a `# harness-sf` comment so users can identify them later.
  - **Even with `--force`, `.gitignore` changes are always logged to stdout** (no silent edits).
  - `--dry-run` must preview the exact lines that would be added.
- If the user is ignoring the entire `.harness-sf/` directory → on init, emit "design.md will also be ignored, please confirm intent" warning.
- `_stubs/` must NOT be one of the templates categories → exclude it from the install.js category enum.

### Measurement
- init on an empty project → creates `.harness-sf/PROJECT.md` and adds 1 line to `.gitignore`. A second init → no changes.

---

## Task 4. Strengthen agent-output cap (file-dump pattern)

### Problem
Agents currently only have a "100~250 line cap", so when there's a lot of analysis, they cram it into the cap and lose information. skyrmionz LLM-summarizes anything over ~420 tokens. Without adding more LLM calls, we can get the same effect by **dumping detail to a file and returning only the path**.

### Change
Add a common output convention to the end of every agent prompt:

```
## Output convention
- Body (returned to parent context): H1 title + 5-line conclusion + 1 line per Top 5 finding.
- Detail (long tables / code citations / full finding list): Write to `.harness-sf/reports/{agent-name}/{YYYYMMDD-HHMMSS}.md`.
- End the body with one line: "Details: {path}".
- Body must not exceed 80 lines.
```

- Add `.harness-sf/reports/` to `.gitignore` as well (alongside the Task 3 stub).

### Affected files
- Modified: every `templates/agents/*.md` — replace existing "## Constraints / 250-line cap" sections with the convention above
- Modified: `bin/install.js` — add `.harness-sf/reports/` to `.gitignore` (combined with Task 3)
- Modified: `CLAUDE.md` "Output budgets" entry

### Write-permission policy (option B chosen after risk analysis)

Split agents into two groups for least-privilege:

**Group 1 — Analyzers (Write granted)**: long output, big dump benefit
- `sf-context-explorer`, `sf-flow-analyzer`, `sf-trigger-auditor`, `sf-lwc-auditor`, `sf-bug-investigator`
- Add `Write` to frontmatter `tools:`
- Path-prefix enforcement in the prompt: "If a Write path does not start with `.harness-sf/reports/{agent-name}/`, stop immediately and report to the user."

**Group 2 — Reviewers (no Write)**: output is short anyway (rubric + grade)
- `sf-design-ceo-reviewer`, `sf-design-eng-reviewer`, `sf-design-security-reviewer`, `sf-design-qa-reviewer`, `sf-design-library-reviewer`, `sf-apex-code-reviewer`
- Apply the 80-line body cap only. No dump pattern.

**Group 3 — already have Write**: keep as-is
- `sf-apex-test-author` (creates test classes), `sf-deploy-validator` (writes manifests when needed)
- Apply the same output convention (80-line body + reports/ dump)

### Compatibility / risk
- Misuse of Write in Group 1 → path-prefix self-validation + self-check converges to effectively zero.
- Reviewers can't dump, so anything that won't fit in 80 lines gets truncated. Empirically most reviewer outputs are ≤60 lines, so this is fine. Overflow handled by the convention "Record details directly in design.md `## Reviews`."
- Parent receives a path and Reads on demand → add a "Read only when detail is needed" rule in the parent skill prompt.

### Measurement
- Body token count for a typical sf-context-explorer call before/after. Goal: 60% reduction.

---

## Execution order (dependencies)

1. **Bundle Tasks 1 + 4 first** — both touch all agent prompts in bulk. Same PR.
2. **Task 3** — installer changes. Independent.
3. **Task 2** — single-file change to deploy-validator. Independent.

Recommend a separate PR per task. Tasks 1 and 4 touch every agent, so bundle them in one PR for review efficiency.

## Not adopted (for now)

- skyrmionz model routing / tiered tool loading — that's Claude Code's domain.
- Adding Agentforce / Data Cloud skills — wait for domain demand.
- LLM summarization of subagent output — extra LLM-call cost. Replaced by the file-dump in Task 4.

## Open questions

- Task 1: when a user wants to override knowledge per project (e.g. "our company defaults to `inherited sharing` instead of `with sharing`") — do we need an extra layer like `.harness-sf/knowledge-overrides/`? → For now, instruction form via PROJECT.md (Task 3) should be enough. Defer the separate layer.
- Task 4: file-dump location — under `.claude/` (.claude/reports/) or under `.harness-sf/reports/`. → Chose the latter (.claude/ stays prompt-asset only; .harness-sf/ holds runtime artifacts).
