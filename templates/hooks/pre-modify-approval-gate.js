#!/usr/bin/env node
// harness-sf PreToolUse hook for Write/Edit/MultiEdit.
// Enforces "MODIFY mode requires user approval" — design-first skill prose game-theory'd into a hook.
//
// Policy:
//   - Triggers ONLY for paths under force-app/** (consumer SF source tree).
//   - If file does NOT exist → CREATE mode → allow (sentinel not required).
//   - If file exists → MODIFY mode → require fresh sentinel at .harness-sf/.cache/modify-approvals/<key>.json
//     (TTL 30 min + git HEAD match).
//   - Sentinels are issued by skills via _lib/issue-modify-approval.js after user confirmation.
//
// Escape hatch: HARNESS_SF_OVERRIDE='modify:<reason>' (>= 8 non-whitespace chars)
// Path-prefix policy (pre-write-path-guard.js) still runs alongside.

'use strict';
const fs = require('fs');
const path = require('path');
const sentinel = require('./_lib/sentinel');
const { emitBlock } = require('./_lib/gate-output');

const TTL_MS = 30 * 60 * 1000;
const KIND = 'modify-approvals';
const MODIFY_OVERRIDE = "HARNESS_OVERRIDE=modify with audit reason (≥8 chars; 1-hour session, 1 use)";

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function deny(block) {
  emitBlock(block);
  process.exit(2);
}

function relativize(p) {
  const cwd = process.cwd();
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  return path.relative(cwd, abs).split(path.sep).join('/');
}

function inForceApp(rel) {
  return rel === 'force-app' || rel.startsWith('force-app/');
}

(function main() {
  try {
    const { decideBypass } = require('./_lib/override');
    if (decideBypass('modify', 'pre-modify-approval-gate')) process.exit(0);
  } catch { /* fall through to normal gate */ }

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }

  const tool = payload.tool_name;
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'MultiEdit') process.exit(0);

  const filePath = payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path);
  if (!filePath) process.exit(0);

  const rel = relativize(filePath);
  if (rel.startsWith('..')) process.exit(0); // outside cwd — let path-guard handle it
  if (!inForceApp(rel)) process.exit(0); // out of policy scope

  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  // CREATE mode (file does not yet exist) — allow.
  if (!fs.existsSync(abs)) process.exit(0);

  // MODIFY mode — sentinel required.
  const key = sentinel.keyFromPath(abs);
  const sentinelPath = `.harness-sf/.cache/${KIND}/${key}.json`;
  const s = sentinel.readSentinel(KIND, key);
  if (!s) {
    deny({
      reason: `MODIFY of '${rel}' requires user approval but no sentinel was found`,
      why: 'design-first policy: existing files are never overwritten silently — the calling skill must show diff plan + receive explicit user [Y/edit/abort]',
      fix: `after user approves the diff plan, run: node .claude/hooks/_lib/issue-modify-approval.js '${rel}'`,
      file: sentinelPath,
      override: MODIFY_OVERRIDE,
    });
  }

  const v = sentinel.validate(s, TTL_MS);
  if (!v.ok) {
    deny({
      reason: `approval sentinel for '${rel}' rejected (${v.reason})`,
      why: 'sentinel is expired, tampered, or no longer matches HEAD — approvals are bound to a specific tree state',
      fix: `re-confirm with the user, then run: node .claude/hooks/_lib/issue-modify-approval.js '${rel}'`,
      file: sentinelPath,
      override: MODIFY_OVERRIDE,
    });
  }

  // Path in sentinel must match (defense against key collisions or stale cache).
  if (s.path && s.path !== rel) {
    deny({
      reason: `sentinel path mismatch for '${rel}'`,
      why: `sentinel encodes path='${s.path}' but the Write target is '${rel}' — defense against key collisions or stale cache`,
      fix: `re-issue approval for the actual target: node .claude/hooks/_lib/issue-modify-approval.js '${rel}'`,
      file: sentinelPath,
      override: MODIFY_OVERRIDE,
    });
  }

  process.exit(0);
})();
