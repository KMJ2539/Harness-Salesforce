---
type: feature
name: design-rigor-gates
date: 2026-04-28
author: mjkang2539
status: implemented
revision: 1
---

# Enforce design depth: block standalone artifact invocation + add review iteration loop

## Why (background / problem)

User operating principle: **"Spend most of the time on design and produce a sure result."**

Today `harness-sf` only puts the design-first gate on the `/sf-feature` path, which leaves two evasion routes open:

1. **Bypass via standalone artifact invocation** — calling `/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-field`, or `/sf-aura` standalone skips the 5-persona review and runs only its own single review. The "just one quick thing" temptation eats into design time.
2. **No review iteration loop** — when the 5-persona review writes its concerns as prose, the hook only sees the `block` verdict. There is no severity distinction in the concerns, the resolution duty is not recorded in design.md, and re-review after a block is cleared is not enforced. The outcome ends up determined by first-round quality.

Goal: mechanically close both bypasses so time is intentionally spent on the design phase.

### Incident basis

No explicit incident — preventive hardening. Justification:

- There are 5 standalone artifact skills, each of which is a shortcut that bypasses the 5-persona review. The principle collapses the moment a user sidesteps with "this is a small change."
- A `block` buried in review prose flowing into dispatch without an explicit resolution in the design.md body is a common risk for any LLM workflow with prompt-trust dependencies.

## Non-goals

- Adding a new reviewer persona.
- Forbidding single-artifact work itself (allow modify-only).
- Removing free-form review output — only adding a structured layer on top of the current free format.
- Auto-override to prevent infinite loops (we want an explicit user decision).

## Design principles

- **Hook/sentinel enforcement, no prompt-trust** — every gate follows the `_lib/sentinel.js` pattern.
- **Machine-parseable review output** — severity labels are specified in the reviewer output schema.
- **Resolution log lives in design.md body** — no separate file; keep a single source of truth.
- **Targeted re-review** — re-run only the persona that blocked, not all 5.

## Architecture

### A. Standalone artifact invocation gate

```
User: /sf-apex AccountTriggerHandler
  ↓
Step 0: invocation-mode discrimination (existing)
  ├─ delegated token present → delegated mode (unchanged)
  └─ no token → new: design-mode gate
       ├─ Check whether a recent feature design.md exists
       ├─ None → "Recommend entering via /sf-feature. Proceed anyway?" AskUserQuestion
       │    ├─ Decline → redirect to /sf-feature
       │    └─ Explicit override → write a short reason stub in design.md, then proceed
       └─ Present → existing standalone flow (single review)
```

Implementation: new `templates/hooks/_lib/check-feature-context.js`. Called from each artifact skill at Step 0.7 (right after invocation-mode discrimination).

### B. Review severity tagging

Reviewer output schema change — mandate a structure block *on top of* free prose:

```markdown
## Review (sf-design-eng-reviewer)

(Free-form prose analysis…)

### Verdict
- block: [B1] async @future risks mixed-DML in trigger context
- block: [B2] sharing modifier not specified
- concern: [C1] insufficient governor headroom for the 200 batch-size assumption
- concern: [C2] missing retry policy
- nit: [N1] naming: handler vs controller mixed
```

Rules:
- `block` = blocks dispatch. Resolution must be stated in design.md.
- `concern` = dispatch allowed. Requires a 1-line response in design.md (accept / reject / defer + reason).
- `nit` = no obligation.

The IDs (`B1`, `C2`, `N1`) are assigned by the reviewer. Referenced in the resolution log.

`stop-reviewer-validate.js` extension: missing verdict block → block. Text outside the labels → block.

### C. Resolution log + dispatch sentinel

Mandatory section in design.md:

```markdown
## Review Resolution

### sf-design-eng-reviewer
- B1: switched handler to sync; future calls split into a separate queueable. (resolved)
- B2: explicitly marked `with sharing`. (resolved)
- C1: keeping 200. AccountTrigger averages 50 records, so 4x headroom is plenty. (not accepted)
- C2: deferred to phase 2, out of scope for this feature. (deferred)

### sf-design-security-reviewer
- (no block, concern C1: …)
```

`templates/hooks/_lib/validate-design.js` extension:
1. Verify every reviewer-issued `block` ID appears in the Resolution section.
2. Verify every `concern` ID has at least a 1-line response.
3. On omission, refuse to issue the dispatch sentinel → `pre-create-design-link-gate.js` blocks.

### D. Targeted re-review

When design.md `revision: N` is bumped (user requesting re-review after resolving blocks):
- `/sf-feature` Step 5 (review) re-runs only the personas that issued `block` in the previous revision.
- If the same persona issues another `block` in the new revision, allow up to `revision: N+1` — when the same persona blocks twice in a row, require explicit user override (AskUserQuestion).

Previous reviews are preserved in design.md (`## Review (sf-design-eng-reviewer) [rev 1, superseded]`). Audit trail.

## Decisions

| # | Decision | Outcome |
|---|----------|---------|
| D1 | Severity-label strength | `block` hard gate, `concern` requires response, `nit` ignorable |
| D2 | Standalone artifact block strength | Not block, but redirect + override path (reason stub mandatory) |
| D3 | Re-review scope | Block persona only, not full re-run |
| D4 | Iteration cap | Same persona blocks twice in a row → user override |
| D5 | Resolution location | `## Review Resolution` section in design.md body |

## Phasing

**Phase 1: severity tagging + resolution log (mandatory, independent value)**
- Spell out the verdict schema in the 7 `templates/agents/sf-design-*-reviewer.md` files.
- Extend `stop-reviewer-validate.js`.
- Extend `validate-design.js` (resolution validation).
- In `/sf-feature` SKILL.md, add a resolution-log writing step between Step 5 and Step 6.

**Phase 2: standalone artifact redirect gate (mandatory, independent value)**
- New `_lib/check-feature-context.js`.
- Update Step 0 in each of the 5 artifact skill SKILL.md files.
- Define the override stub format.

**Phase 3: targeted re-review + iteration cap (depends on Phase 1)**
- Specify the revision flow in `/sf-feature` SKILL.md.
- Add revision-diff tracking to `validate-design.js`.

Each phase has value without the next. Phase 2 is independent of Phase 1.

## Risks

- **R1**: Inaccurate severity labels — reviewer might downgrade to `concern` to slip past the dispatch gate. Mitigation: examples + a self-policing line in the reviewer prompt. CEO review acts as meta review.
- **R2**: Resolution log filled with formulaic responses ("accepted" alone). Mitigation: `validate-design.js` runs a minimum-character / rationale-keyword heuristic.
- **R3**: Forcing every standalone artifact through `/sf-feature` adds friction. Mitigation: explicit override path (D2) — but the reason stub is mandatory so the friction *is felt* (that is the point).
- **R4**: Same-persona consecutive-block user override becomes its own escape hatch. Mitigation: override reasons are also recorded in design.md and reviewed during retro.

## Test plan

- 3 fixture design.md cases: (a) all blocks resolved, (b) blocks unresolved, (c) concern responses missing.
- `validate-design.js` unit tests — confirm verdict matches each fixture.
- Standalone artifact invocation scenarios: gate behavior in both presence/absence of a feature design.md.
- Trigger AskUserQuestion when revision 2 sees the same persona block.

## Phase artifacts (artifact decomposition)

| ID | Kind | File | Phase |
|----|------|------|-------|
| A1 | hook | `templates/hooks/_lib/check-feature-context.js` | 2 |
| A2 | hook extension | `templates/hooks/stop-reviewer-validate.js` | 1 |
| A3 | hook extension | `templates/hooks/_lib/validate-design.js` | 1, 3 |
| A4 | agent prompt | `templates/agents/sf-design-{ceo,eng,security,qa,library}-reviewer.md` (5) | 1 |
| A5 | agent prompt | `templates/agents/sf-apex-code-reviewer.md` | 1 |
| A6 | skill prompt | `templates/skills/sf-feature/SKILL.md` (Step 5/6, revision flow) | 1, 3 |
| A7 | skill prompt | `templates/skills/sf-{apex,lwc,aura,sobject,field}/SKILL.md` (Step 0) | 2 |

## Reviews

(Awaiting 5-persona review — this design.md is itself the first test of the new system.)

## Review Resolution

(To be written after Reviews.)
