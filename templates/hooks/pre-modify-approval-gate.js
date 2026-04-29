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

const TTL_MS = 30 * 60 * 1000;
const KIND = 'modify-approvals';

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function deny(msg) {
  process.stderr.write(`[harness-sf] ${msg}\n`);
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
  const s = sentinel.readSentinel(KIND, key);
  if (!s) {
    deny(
      `modify gate: '${rel}' exists (MODIFY mode) but no approval sentinel found.\n` +
      `  Skill must call: node .claude/hooks/_lib/issue-modify-approval.js '${rel}'\n` +
      `  AFTER showing diff plan and receiving explicit user approval.`
    );
  }

  const v = sentinel.validate(s, TTL_MS);
  if (!v.ok) {
    deny(
      `modify gate: approval for '${rel}' rejected — ${v.reason}.\n` +
      `  Re-confirm with the user and re-issue via: node .claude/hooks/_lib/issue-modify-approval.js '${rel}'`
    );
  }

  // Path in sentinel must match (defense against key collisions or stale cache).
  if (s.path && s.path !== rel) {
    deny(`modify gate: sentinel path mismatch (sentinel='${s.path}', requested='${rel}'). Re-issue approval.`);
  }

  process.exit(0);
})();
