---
name: sf-library-install
description: Safely install external libraries/packages into a Salesforce project. Auto-infers (or asks for) one of 5 methods (Managed/Unlocked Package / Source Vendoring / Git Submodule / npm devDependency / Static Resource). Plan-approval gate before install, inventory re-verification + decisions.md record after install. Invoked when a design-first skill's ## Decisions specifies a library adoption, or directly by the user. Use for requests like "install fflib", "adopt TriggerHandler", "install Nebula Logger", "install this package".
---

# /sf-library-install

Ensure-mode skill that adds libraries/packages to a Salesforce project. **Iron Law: do not install if already in inventory; never guess identifiers (04t / git URL / npm name / CDN URL) the user did not explicitly provide.**

## Iron Laws

1. **No guessing** — 04t package IDs, git URLs, npm package names, CDN URLs must come from **explicit user input or design.md**. The skill is forbidden from searching for them.
2. **Plan dump required** — every external call (network / filesystem / org deploy) must be stated in the plan and run only after user approval.
3. **Production org protection** — strong confirmation gate when targeting production. Default is abort.
4. **Conflict abort** — abort if the same namespace prefix or same class name already exists; recommend reuse.
5. **No rollback on partial failure** — preserve completed steps and tell the user explicitly. The user decides cleanup.

## Step 0: Invocation mode detection

- **Delegated mode**: caller passes design.md path + library names (follow-up to Step 1.9 of `/sf-apex`, `/sf-lwc`, `/sf-sobject`, `/sf-feature`). Process only libraries marked for adoption in design.md `## Decisions`.
- **Standalone mode**: invoked directly by the user. Library name + (optional) identifier as args.

## Step 1: Identify target libraries

### Delegated mode
1. `Read` design.md.
2. Extract libraries marked "adopt" in `## Decisions`. Example format:
   ```
   - Library: TriggerHandler — adopt (method TBD)
   - Library: Nebula Logger 04t5Y0000027FQ7QAM — adopt (method A)
   ```
3. Confirm extracted list with the user (one by one or batch).

### Standalone mode
Collect via AskUserQuestion:
- Library name (free text, identifier-only)
- Identifier (if any): 04t ID / git URL / npm package name / CDN URL / none
- Target location hint (if any): a path like "force-app/main/default/classes/framework/"

## Step 2: Inventory conflict check (required, before install)

**Verify directly with `Glob` + `Grep`** — no guessing.

| Check | Command |
|---|---|
| Same class name exists | `Glob force-app/**/{LibClassName}.cls` |
| Same namespace prefix in use | `Grep "<ns>__" force-app/**` (managed package traces) |
| Same npm package already a dependency | `Read package.json` → dependencies/devDependencies |
| Same staticresource name | `Glob force-app/**/staticresources/{name}/` or `{name}.resource-meta.xml` |
| sfdx-project.json packageDirectories dependencies | `Read sfdx-project.json` |

**On conflict**:
- Same library, same location → abort, output "already installed, reuse"
- Different library but namespace conflict possible → abort, ask user how to proceed (install at a different location / abort)

## Step 3: Choose install method

### Auto-inference rules

| Input cue | Method |
|---|---|
| Identifier starts with `04t` (15 or 18 chars) | **A. Managed/Unlocked Package** |
| Identifier matches `https://github.com/...` or `git@github.com:...` | **B. Source Vendoring** or **C. Git Submodule** (user picks) |
| Identifier `npm:<name>` / `@<scope>/<name>` / clear npm name | **D. npm devDependency** |
| Identifier `http(s)://...js` or CDN domain (cdn.jsdelivr.net, unpkg.com, etc.) | **E. Static Resource** |
| No identifier or ambiguous | 5-way pick via AskUserQuestion |

### 5-way pick (when ambiguous)

```
Which method to install?
A) Managed/Unlocked Package — sf package install (04t ID required)
B) Source Vendoring — git clone, then copy .cls/.cls-meta.xml into the force-app tree
C) Git Submodule — git submodule add (keep source + track updates)
D) npm devDependency — npm i -D (LWC test tooling, etc.)
E) Static Resource — register a JS/CSS file as a staticresource
```

Even when inferred, show one-line confirmation and proceed.

## Step 4: Per-method plan generation

### 4A. Managed/Unlocked Package

**Required input check**:
- 04t ID (user-provided) — abort if missing + guide "check on the release page and re-invoke"
- Target org alias — if missing, look up the default org via `sf org list --json`

**Plan**:
```
Method: A (Managed/Unlocked Package)
Command: sf package install --package <04t...> -o <alias> -w 10 -r
Target org: <alias> (Production: yes/no)
Install key: <user input if needed>
ETA: ~10 minutes (longer for large packages)
Side effects: all package metadata is added to the org
```

**Production guard**: if target is production, strong confirm — "really run install on production? [y/N]".

### 4B. Source Vendoring

**Required input check**:
- git URL — user-provided
- (optional) commit SHA / tag — default branch HEAD if unspecified, stated in plan
- File patterns to pull — varies per library (confirm with user). Example: `src/classes/*.cls`, `src/classes/*.cls-meta.xml`
- Target directory — `force-app/main/default/classes/<framework_name>/` is the default, confirm with user

**Plan**:
```
Method: B (Source Vendoring)
1) git clone --depth=1 <repo> /tmp/<name>
2) Files to pull: <pattern>
3) Target: <target_dir>
4) apiVersion alignment: original <X> → project sourceApiVersion <Y>
5) License: <SPDX> — preserve headers + add LICENSES/<name>.txt (if applicable)
6) Deploy + test: sf project deploy start --source-dir <target_dir> -o <alias>
                  sf apex run test --tests <TestClassName> -o <alias>
7) Clean up /tmp/<name>
```

### 4C. Git Submodule

**Plan**:
```
Method: C (Git Submodule)
1) git submodule add <repo> <path>
2) git submodule update --init
3) Add path to sfdx-project.json packageDirectories (if needed)
4) Deploy + test
```

**Note**: submodules require compatibility checks with SFDX build/CI — include a "team git workflow impact" warning in the plan.

### 4D. npm devDependency

**Plan**:
```
Method: D (npm devDependency)
Command: npm i -D <pkg>[@<version>]
Files changed: package.json, package-lock.json
Side effects: node_modules/ updated
Verification: npm ls <pkg>
```

### 4E. Static Resource

**Plan**:
```
Method: E (Static Resource)
1) curl -L -o /tmp/<name>.<ext> <url>
2) File verification: size / SHA256 (when user-supplied)
3) Target: force-app/main/default/staticresources/<ResourceName>/
       or single file force-app/main/default/staticresources/<ResourceName>.<ext>
4) Generate <ResourceName>.resource-meta.xml:
     contentType: application/javascript|text/css|...
     cacheControl: Public
5) Deploy: sf project deploy start --source-dir force-app/main/default/staticresources/<ResourceName>* -o <alias>
6) Clean up /tmp
```

## Step 5: Plan dump + approval gate (common)

Show the plan to the user and explicitly state:
- External network call domains (github.com, registry.npmjs.org, login.salesforce.com, etc.)
- Filesystem change paths
- Org deploy impact (target org alias, production?)
- ETA

```
[P]roceed  [E]dit plan  [A]bort
```

On Edit: ask which item to change → update plan → return to Step 5.

### Step 5.5: Issue approval sentinel (required)

Immediately after the user's [P]roceed and **before** running the install commands of Step 6:

```bash
node .claude/hooks/_lib/issue-library-approval.js <method> <identifier>
```

`method` ∈ `package` | `git-clone` | `git-submodule` | `npm` | `staticresource`

`identifier` is the plan's identifier verbatim (04t ID, github URL, npm package name, CDN URL).

The `pre-library-install-gate.js` hook blocks `sf package install` / `git clone .. force-app/` / `npm install` / `curl ..staticresources..` without a sentinel (TTL 30 min + git HEAD match). Issuing a sentinel without user approval is a policy violation.

**Iron Law enforcement**: `issue-library-approval.js` validates identifier format with regex — 04t prefix / github.com host / valid npm name / http(s) URL. Hallucinated identifiers fail at issuance immediately.

## Step 6: Execute (per-method Bash)

Run each plan command in sequence. **Stop immediately on error**, output:
- Failed step
- Files/state already changed (no rollback, user judgment)
- Recommended next action (e.g. `git checkout -- force-app/...` to undo vendoring)

Print a one-line result summary per step (so the user sees progress).

## Step 7: Verify (per method)

| Method | Verification |
|---|---|
| A | `sf data query --query "SELECT NamespacePrefix, SubscriberPackageId FROM InstalledSubscriberPackage WHERE SubscriberPackageId LIKE '<first 13 chars of 04t>%'" -o <alias>` |
| B | Files exist in target dir (Glob) + test class passes |
| C | `git submodule status` output + files exist in target dir |
| D | `npm ls <pkg>` or `package.json` diff |
| E | staticresource meta-xml exists + deployed in org (`sf data query --query "SELECT Name FROM StaticResource WHERE Name='<ResourceName>'" -o <alias>`) |

If verification fails: treat as install failure, report to user, do not record in decisions.md.

## Step 8: Inventory re-verification

Re-invoke `sf-design-library-reviewer` once via the `Agent` tool (pass the target design.md or a dummy design.md path). Confirm the `## Project Inventory (measured)` section in the output is updated:
- Updated → fine, proceed to Step 9
- Not updated → warn the user. Install command succeeded but reviewer did not pick it up → potential inventory pattern mismatch (e.g. vendoring location not visible to reviewer). Inform the user that the reviewer may recommend it again on the next design.

## Step 9: Record in `.harness-sf/decisions.md`

Create if missing, append if present. Format:

```markdown
## {YYYY-MM-DD} — {Library name} adoption

- **Library**: {name}
- **Version/SHA**: {tag, commit, last digits of 04t, npm version, etc. — any identifier}
- **Method**: {A|B|C|D|E}
- **Location**: {path or "org-wide namespace <ns>"}
- **Reason**: {design.md path + one-line summary, or user input in standalone}
- **Convention**: {1–3 lines of usage convention — key patterns per library}
- **License**: {SPDX or "managed package"}
- **Install timestamp**: {timestamp}
```

This file **must be read** by `sf-design-library-reviewer` for future design reviews — to avoid recommending what is already adopted.

## Step 10: Usage convention notes + migration checklist

### Usage convention notes
Output 1–3 lines of key usage patterns per library. Example (TriggerHandler):
```
TriggerHandler installed.
Usage pattern:
1) Per-object handler class: AccountTriggerHandler extends TriggerHandler
2) Trigger one-liner: trigger AccountTrigger on Account (...) { new AccountTriggerHandler().run(); }
3) Override virtual methods like beforeInsert / afterUpdate in handler
Next: invoke /sf-apex — at the design step the reviewer will auto-recommend TriggerHandler usage.
```

### Migration checklist (where applicable)

When existing patterns differ from the new library, **no auto-migration** — output a checklist only:

```
N existing triggers found (Glob force-app/**/*.trigger):
 - AccountTrigger.trigger    (15 lines, contains logic — migration recommended)
 - ContactTrigger.trigger    (8 lines, handler call only — pattern differs, review needed)
Migrate per object via /sf-apex MODIFY mode.
No auto-conversion unless user explicitly requests (regression risk).
```

## Step 11: Return to main skill (delegated mode only)

Return install summary to the caller (the design-first skill):
- Successful libraries + locations
- Failed libraries + reasons
- Whether decisions.md was updated
- Inventory re-verification result

The caller takes the result and proceeds to Step 2 (sf-context-explorer).

## Strictly forbidden

- **Guessing a non-existent 04t ID** — most dangerous failure mode. User input only.
- **Installing on production with no warning**.
- **Auto-migrating existing code** — checklist only.
- **Rollback attempts** — user cleans up on partial failure.
- **Removing license headers / copyright** — must preserve when vendoring.
- **Skipping verification** — install command exit 0 ≠ verification pass.
