#!/usr/bin/env node
// harness-sf — issues a MODIFY approval sentinel for a force-app/** file.
// Called by design-first skills (sf-apex/sf-lwc/sf-sobject/sf-feature) AFTER
// the user has reviewed the diff plan and explicitly approved the modification.
//
// Usage:
//   node .claude/hooks/_lib/issue-modify-approval.js <project-relative-path> [<project-relative-path> ...]
//
// Writes:
//   .harness-sf/.cache/modify-approvals/<sha1(absPath)[:16]>.json
//   { issued_at, head_sha, path }
//
// TTL is enforced by pre-modify-approval-gate.js (30 min) — this script does not check it.

'use strict';
const path = require('path');
const fs = require('fs');
const sentinel = require('./sentinel');

const args = process.argv.slice(2);
if (!args.length) {
  process.stderr.write('issue-modify-approval: no path provided\n');
  process.exit(1);
}

const cwd = process.cwd();
let issued = 0;

for (const arg of args) {
  const abs = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
  const rel = path.relative(cwd, abs).split(path.sep).join('/');

  if (rel.startsWith('..')) {
    process.stderr.write(`issue-modify-approval: '${arg}' is outside project root — skipped\n`);
    continue;
  }
  if (!(rel === 'force-app' || rel.startsWith('force-app/'))) {
    process.stderr.write(`issue-modify-approval: '${rel}' is outside force-app/ — skipped (policy scope)\n`);
    continue;
  }
  if (!fs.existsSync(abs)) {
    process.stderr.write(`issue-modify-approval: '${rel}' does not exist — CREATE mode does not need approval; skipped\n`);
    continue;
  }

  const key = sentinel.keyFromPath(abs);
  const data = sentinel.writeSentinel('modify-approvals', key, { path: rel });
  process.stdout.write(`approved MODIFY: ${rel} (head=${(data.head_sha || 'no-git').slice(0, 7)}, expires in 30m)\n`);
  issued++;
}

process.exit(issued > 0 ? 0 : 1);
