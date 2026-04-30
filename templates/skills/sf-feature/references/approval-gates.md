# Step 5 — Review approval gates (detail)

Reference for `/sf-feature` Step 5. Two-pass tiered decision: **HIGH and MEDIUM-{security, deploy, exposure}** are individually approved; MEDIUM-{test, design} may be bundled by category.

## Risk routing table

Risk routing is by reviewer-emitted `category` (parsed from `[H1|category]` notation in `## Reviews`):

| Risk × Category | Approval |
|---|---|
| HIGH (any category) | Per-item, individual approval (Pass 1) |
| MEDIUM-{security, deploy, exposure} | Per-item, individual approval (Pass 1) |
| MEDIUM-{test, design} | Bundled approval by category (Pass 2) |
| LOW (any) | Not asked, retained in Reviews for record |

Forward-compat: legacy risk lines without category (`[H1]`) are treated as `category=design` (= bundled at MEDIUM, individual at HIGH).

## Step 5.0 — Pass 1: per-item decision loop

Iterate every `[H#|*]` and every `[M#|security]` / `[M#|deploy]` / `[M#|exposure]` in `## Reviews`. For each, force a choice via AskUserQuestion:

```
[H 1/3] [eng] H1|deploy: sharing modifier missing → add with sharing
  [1] Proceed — proceed without design changes (record reason in Resolution)
  [2] Revise — needs design.md augmentation (re-invoke that persona)
```

A 1-line reason (8+ chars) is mandatory with the answer. This becomes the Resolution log entry. Empty/short responses are blocked by the sentinel and re-prompted.

**Rules**:
- **Any HIGH at [2]** → enter the Step 5.1.5 revision loop (re-invoke that persona only).
- **All HIGH at [1]** → reasons auto-fill the Resolution log, then continue to Pass 2.
- **MEDIUM-security/deploy/exposure**: same [1]/[2]. Be cautious about [2] re-invocation cost.
- "Defer / phase 2 / redesign" variants are expressed as [1] + 1-line reason ("defer: phase 2", "redesign: rethink Order structure → abort phase 1").

CEO reviewer's `[H#|design]` Tradeoffs are HIGH and asked per item.

Progress counter: `[H 1/3]`, `[M-individual 2/2]` to display progress.

## Step 5.0.5 — Pass 2: bundled decision by category

Group remaining MEDIUMs by category: `bundles = { test: [M2, M5], design: [M1, M3, M4] }`.

For each non-empty bundle, summarize and ask via AskUserQuestion (Apply all is the **first/default** option):

```
[M-bundle test 1/2] 2 MEDIUM test items:
  - [qa] M2|test: missing bulk-mode test for AccountHandler
  - [qa] M5|test: assertion only checks count, not state

  [1] Apply all — accept reviewer recommendations (reason 20+ chars required)
  [2] Select per-item — drop into individual approval for this bundle
  [3] Defer all — defer to later phase (reason 20+ chars required)
```

**Rules**:
- Bundle reason is **20+ chars** (not 8+) — one line must justify N decisions.
- `[2] Select per-item` re-enters the Step 5.0 per-item loop for that bundle's items only.
- `[3] Defer all` records all bundle items as `(deferred)` in Resolution with the same reason.
- After all bundles processed, the user reviews design.md once more and chooses [P]roceed.

Telemetry: each bundle decision is appended to `.harness-sf/.cache/scores/bundle-decisions.jsonl` as `{ts, slug, action, category, item_count}` for 1-week dogfooding analysis. Run via Bash:

```bash
node .claude/hooks/_lib/bundle-telemetry.js record {slug} {category} {action} {item_count}
```

## Step 5.1 — Write Review Resolution log (required before Step 5.2)

Add a `## Review Resolution` section to design.md — record user responses for every `[H#]` HIGH and `[M#]` MEDIUM risk. Reviewers have no block authority; the block is on *user non-response*.

**Schema**:

```markdown
## Review Resolution

### sf-design-eng-reviewer
- H1|deploy: switched handler to sync, future call separated into a queueable. (resolved)
- M1|deploy: keep batch size 200. AccountTrigger averages 50 records, 4x headroom. (not accepted)

### sf-design-security-reviewer
- H1|security: declared `with sharing`. (resolved)
- M1|security: deferred to phase 2, out of this feature's scope. (deferred)

### sf-design-ceo-reviewer
- H1|design: adopted standard Order object after review, custom Order__c dropped. (redesigned)

### Bundled
- category=test (2 items): accept QA recommendations, will add bulk-mode + state assertion in same PR. (apply_all)
  - M2|test, M5|test
- category=design (3 items): defer style-level handler split to phase 2, scope of this feature is data flow only. (defer_all)
  - M1|design, M3|design, M4|design
```

**Rules**:
- HIGH (`H#`) requires a response — one of "resolved / not accepted / deferred / redesigned" + reason 8+ chars.
- MEDIUM-{security, deploy, exposure} (`M#`) also needs a 1-line response — explicit "deferred" or "rejected" with 8+ chars.
- MEDIUM-{test, design} are recorded under `### Bundled` with 20+ char bundle reason and an enumerated ID list. Individual entries under per-persona sections are NOT required for bundle-resolved items.
- LOW (`L#`) is not mandatory — ignorable.
- Single-word responses ("ok", "accepted") are blocked by the sentinel.

After writing, the user reviews design.md once more and chooses [P]roceed. On approval, proceed Step 5.2 → 5.5 → 6.

## Step 5.1.5 — Targeted re-review (revision flow)

If 1+ items in Step 5.0 are [2] revise:

- Guide the user on which design.md section (`## What`, a specific artifact in `## Artifacts`, etc.) to edit.
- After edits, increment frontmatter `revision: N` to N+1, and record only the personas that issued the [2] risks in `revision_block_personas: [persona-1, persona-2]`.
- On Step 4 re-run, **invoke only those personas** in parallel (skip the others — cost saving).
- Wrap the prior-rev `## Reviews` body and matching `## Review Resolution` entries in `<!-- archive-revision: N -->...<!-- /archive-revision: N -->` fences (rev N = the now-superseded revision number). Then run:
  ```bash
  node .claude/hooks/_lib/archive-design-revision.js .harness-sf/designs/{...}.md
  ```
  This moves the fenced blocks to `{...}.archive.md` and replaces them with a 1-line stub pointer. Audit trace preserved in the archive file; the active design.md stays small for sub-agents.
- If new risks emerge after re-invocation, re-enter the Step 5.0 per-risk decision loop.

**Iteration cap**: if the same persona issues HIGH twice in a row, require explicit user override via AskUserQuestion:

```
[persona] issued HIGH on both revision N and N+1. Proceed without further review?
  [1] Override — reason required (recorded in Resolution log)
  [2] Edit design further
  [3] Abort the feature
```

Maximum 5 revisions — beyond that, force abort + tell the user "rethink the feature scope itself".
