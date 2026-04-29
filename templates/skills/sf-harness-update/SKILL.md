---
name: sf-harness-update
description: Upgrade the installed harness-sf agents/skills/hooks/knowledge in this project to the latest published version. Thin wrapper over `npx harness-sf@latest update` — runs the manifest-driven diff, surfaces conflicts for user decision, and shows a one-screen summary. Use for requests like "update harness-sf", "upgrade the harness", "pull latest agents", "/sf-harness-update".
---

# /sf-harness-update

Upgrade an existing `.claude/` install to the latest `harness-sf` templates. The actual upgrade logic lives in `bin/install.js` (`update` subcommand) — this skill is just a UX layer that runs it from inside Claude Code and explains the result.

## Iron Laws

1. **Never reimplement update logic** — always shell out to `npx harness-sf@latest update`. The CLI is the single source of truth for diff + manifest semantics.
2. **No silent overwrites of user-modified files** — the CLI's default conflict answer is "keep". Do not pass `--force` unless the user explicitly asks.
3. **Project-local only** — `--global` installs are not tracked by manifest and out of scope.

## Step 0: Preflight

1. Confirm cwd is a project root: `Glob .claude/agents/*.md` should return matches.
   - If no `.claude/` → tell the user to run `npx harness-sf init` first. Stop.
2. `Read .claude/.harness-sf-manifest.json` if present.
   - If missing → inform the user this is a legacy install; the first update will write a fresh manifest assuming current files are unmodified. One-time migration.
3. `Read package.json` (project root) — only to confirm the project exists; not used for harness version.

## Step 1: Show change preview (dry-run)

Run:
```bash
npx harness-sf@latest update --dry-run
```

Parse the Summary block:
```
unchanged       : N
upstream-only   : N  (will overwrite)
missing-on-disk : N  (will create)
user-only       : N  (preserved)
conflicts       : N  (will prompt)
deletions       : N  (M auto, K kept+warn)
```

Surface to the user as a one-screen table. Highlight:
- **conflicts > 0** — needs interactive decisions; warn this is the only step that requires per-file answers.
- **deletions kept+warn > 0** — list which deprecated files were locally modified and will be left behind for manual review.
- **upstream-only == 0 AND conflicts == 0 AND missing-on-disk == 0** — already up to date; ask user whether to skip the real run.

If the user declines the upgrade at this point, stop. No state changed.

## Step 2: Approval gate

Show:
```
Proceed with update?
  [P]roceed  — run real update; conflict prompts answered interactively
  [F]orce    — overwrite all conflicts with upstream (DESTRUCTIVE; loses local edits)
  [A]bort
```

`[F]orce` requires a second explicit "yes, overwrite my local edits" confirmation.

## Step 3: Execute

### P — proceed
```bash
npx harness-sf@latest update
```
Conflicts will prompt `[y / N=keep / d=show diff / a=overwrite-all / s=skip-all]` per file. Relay each prompt to the user verbatim and forward the answer.

### F — force (with second confirmation)
```bash
npx harness-sf@latest update --force
```

## Step 4: Post-update report

Parse the final line:
```
Done. created=N overwritten=N deleted=N skipped=N
```

Plus echo any `! kept ...` warnings (user-modified deprecated files).

Output a 5–10 line summary:
- Counts per bucket
- Files preserved due to conflict (if any)
- Deprecated files left behind (if any)
- Reminder: **Restart Claude Code** so it picks up the new agents/skills.

## Step 5: Optional next steps

If `templates/CHANGELOG.md` is fetched as part of `npx harness-sf@latest`, offer to display the changelog entries since the previous installed version (read from manifest's `version` field). If no CHANGELOG is shipped, skip silently.

## Strictly forbidden

- **Editing files in `.claude/` directly** — always go through the CLI.
- **Passing `--force` without explicit user confirmation** — destroys local edits silently.
- **Bypassing the dry-run preview** — the user must see the change scope before any write.
- **Calling `init --force`** as a substitute for `update` — it does not honor the manifest and will overwrite all user customizations.
