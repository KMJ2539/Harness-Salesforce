# Step 7.5 — Auto deploy validate + auto-fix loop

Reference for `/sf-feature` Step 7.5. Dispatch finishing is not the end. Auto-run validate-only + RunLocalTests; auto-fix mechanical errors (after design-consistency check), defer logical errors or design drift to the user. Iteration cap of 4 stops infinite loops.

## Step 7.5.0 — Initialize validate-loop state

```bash
node .claude/hooks/_lib/validate-loop-state.js init {feature-slug}
```

## Step 7.5.1 — Run deploy validate (auto-loop mode)

Invoke `sf-deploy-validator` via the `Agent` tool. State `--auto-loop {feature-slug}` context in the prompt — the agent Writes results to `.harness-sf/.cache/deploy-findings/{slug}.json`.

## Step 7.5.2 — Verdict branching

```bash
cat .harness-sf/.cache/deploy-findings/{feature-slug}.json | jq -r .verdict
```

- `ready` → proceed to Step 8 (report). Clean up validate-loop state (`reset` call).
- `blocked` → proceed to Step 7.5.3 classification.

## Step 7.5.3 — Error classification

```bash
node .claude/hooks/_lib/classify-deploy-error.js \
  .harness-sf/.cache/deploy-findings/{feature-slug}.json \
  --out .harness-sf/.cache/deploy-classify/{feature-slug}.json
```

Branch on classification (`auto_fix_eligible: true|false`):

- `auto_fix_eligible: false` (contains 1+ logical errors) → **do not attempt auto-fix**. Show classification table to the user + AskUserQuestion:

  ```
  Logical errors present, outside auto-fix scope.
    [1] Delegate to /sf-bug-investigator (root cause analysis)
    [2] Fix manually
    [3] Defer (no sentinel issued, follow-up by user)
  ```

- `auto_fix_eligible: true` (mechanical only) → enter the Step 7.5.4 auto-fix loop.

## Step 7.5.4 — Auto-fix attempts per mechanical error

Process each mechanical error in classification sequentially.

### (a) Generate fix proposal

Deterministic transformation per error category:

| category | proposal action | example |
|---|---|---|
| `field-not-found` (typo: code → existing field) | `typo` | `from: Recpient__c` → `to: Recipient__c` (canonical name in design) |
| `fls-missing-in-ps` | `add` | add fieldPermissions block in PS XML |
| `class-access-missing-in-ps` | `add` | add classAccesses block in PS XML |
| `cmt-record-missing` | `add` | create customMetadata/{type}.{record}.md-meta.xml |
| `ps-field-reference-stale` | `remove` | remove stale fieldPermissions line from PS |

### (b) Design-consistency check

```bash
echo '<proposal-json>' | node .claude/hooks/_lib/verify-fix-against-design.js \
  --design .harness-sf/designs/{YYYY-MM-DD}-feature-{slug}.md \
  --proposal -
```

`consistent: true` → (c). `consistent: false` → (d) 3-way branch.

### (c) Apply automatically (consistent)

1. Apply fix via Edit tool (file_path)
2. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} code-fix --note "<category>:<target>"` — auto-abort and delegate to user when cap reached
3. Once all mechanical errors are processed, loop back to Step 7.5.1 (revalidate)

### (d) 3-way branch (inconsistent — disagrees with design)

Force a choice via AskUserQuestion:

```
Mechanical auto-fix proposal disagrees with the design.
Target: {target} ({category})
Proposal: {action} {to_value}
Design evidence: {evidence_or_"not declared in design"}

  [1] Code correction — design is correct, apply auto-fix as proposed
  [2] Design correction — design is missing/incorrect, augment then re-dispatch
  [3] Defer — user decides manually
```

Per-branch handling:
- `[1]` → apply Edit + `incr code-fix`. Abort on cap.
- `[2]` → enter Step 7.5.5 design-correction loop.
- `[3]` → mark this error Skip, move to next mechanical error. After all mechanicals are processed (with any Skips), proceed to Step 8 noting "user follow-ups: N items".

## Step 7.5.5 — Design-correction loop (reuses Step 5.1.5 revision flow)

1. Use AskUserQuestion to narrow which artifact's which item to augment.
2. Edit design.md + increment frontmatter `revision: N+1` + record `revision_block_personas: [eng, library, (optional) security]`. Wrap the now-superseded prior-rev `## Reviews` / `## Review Resolution` blocks in `<!-- archive-revision: N -->...<!-- /archive-revision: N -->` fences, then run `node .claude/hooks/_lib/archive-design-revision.js .harness-sf/designs/{...}.md` to move them to the sibling `.archive.md`.
3. **Re-invoke only the affected personas** (re-run Step 4, but not all 4).
4. Update `## Library Verdict` (only if `review_tier: full`).
5. Re-pass the resolution gate:
   ```bash
   node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{...}.md
   ```
6. Reset only affected artifacts in dispatch-state to `pending`:
   ```bash
   node .claude/hooks/_lib/dispatch-state-cli.js reset {slug} {affected-artifact-id} [...]
   ```
7. Re-dispatch the affected artifacts (Step 6.1).
8. `node .claude/hooks/_lib/validate-loop-state.js incr {slug} design-fix --note "<artifact-id>: <change summary>"` — abort on cap.
9. Loop back to Step 7.5.1 (revalidate).

## Step 7.5.6 — When cap is reached

`incr` returns exit 1 + cap-exceeded:

```
Artifact 'X' triggered design corrections twice in a row at deploy stage,
or total auto-fix cap of 4 reached.

  [1] Redesign the feature scope (start sf-feature over)
  [2] Abort just this artifact, continue with the rest (mark exclusion in dispatch-state)
  [3] Override — force ahead without further corrections (1-line reason required, no validate sentinel issued)
```

Record the choice as one line in design.md `## Dispatch Log`.
