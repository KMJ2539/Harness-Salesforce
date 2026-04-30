#!/usr/bin/env node
// harness-sf PreToolUse hook for Write/Edit/MultiEdit.
// Enforces "design-first" — new files under SF source dirs require a fresh DESIGN approval sentinel.
//
// Policy:
//   - Triggers ONLY for paths under force-app/main/default/{classes,triggers,lwc,aura,objects}/**.
//     (Other force-app/ paths — labels, layouts, permissionsets, staticresources — are out of scope.
//     pre-write-path-guard.js + pre-modify-approval-gate.js still cover them.)
//   - If file EXISTS → MODIFY mode → this hook is silent (pre-modify-approval-gate handles it).
//   - If file does NOT exist → CREATE mode → require ANY fresh sentinel under
//     .harness-sf/.cache/design-approvals/ (TTL 2h + git HEAD match).
//   - Sentinel issuance: skills call _lib/issue-design-approval.js after the 5-persona
//     review approval gate at Step 1.9.
//
// Escape hatch: HARNESS_SF_OVERRIDE='create:<reason>' (>= 8 non-whitespace chars)
// Defense-in-depth: pre-write-path-guard.js + pre-modify-approval-gate.js still run alongside.

'use strict';
const fs = require('fs');
const path = require('path');
const sentinel = require('./_lib/sentinel');
const { emitBlock } = require('./_lib/gate-output');

const TTL_MS = 2 * 60 * 60 * 1000;
const KIND = 'design-approvals';
const GATED_PATH_RE = /^force-app\/main\/default\/(classes|triggers|lwc|aura|objects)\//;
const CREATE_OVERRIDE = "HARNESS_OVERRIDE=create with audit reason (≥8 chars; 1-hour session, 1 use)";

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

// Find ANY fresh design-approvals sentinel. Returns the parsed sentinel or null.
function findFreshDesignSentinel() {
  const dir = sentinel.sentinelDir(KIND);
  if (!fs.existsSync(dir)) return null;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const v = sentinel.validate(s, TTL_MS);
    if (v.ok) return s;
  }
  return null;
}

(function main() {
  try {
    const { decideBypass } = require('./_lib/override');
    if (decideBypass('create', 'pre-create-design-link-gate')) process.exit(0);
  } catch { /* fall through to normal gate */ }

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }

  const tool = payload.tool_name;
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'MultiEdit') process.exit(0);

  const filePath = payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path);
  if (!filePath) process.exit(0);

  const rel = relativize(filePath);
  if (rel.startsWith('..')) process.exit(0);
  if (!GATED_PATH_RE.test(rel)) process.exit(0);

  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  // MODIFY mode (file already exists) — pre-modify-approval-gate.js handles it. Stay silent.
  if (fs.existsSync(abs)) process.exit(0);

  // CREATE mode — require ANY fresh design approval.
  const s = findFreshDesignSentinel();
  if (!s) {
    deny({
      reason: `creating new file '${rel}' without a fresh design approval sentinel`,
      why: 'design-first principle: every new SF source artifact must be backed by an approved design.md (5-persona review at Step 1.9 issues the sentinel)',
      fix: 'enter via /sf-apex, /sf-lwc, /sf-sobject, or /sf-feature and progress through Step 1.9; or manually: node .claude/hooks/_lib/issue-design-approval.js .harness-sf/designs/{your-design}.md',
      file: '.harness-sf/.cache/design-approvals/',
      override: CREATE_OVERRIDE,
    });
  }

  process.exit(0);
})();
