#!/usr/bin/env node
// harness-sf — sub-skill side check for delegated-mode sentinel.
//
// Called by /sf-apex, /sf-lwc, /sf-aura, /sf-sobject, /sf-field at Step 0 to decide
// standalone vs delegated mode based on a verifiable sentinel rather than prompt-
// parsing alone.
//
// Usage:
//   node .claude/hooks/_lib/check-delegated-token.js <design-md-path> <artifact-id>
//
// Exit:
//   0 — fresh delegated sentinel exists; prints JSON of {design_path, artifact_id, type, sub_skill}
//   1 — no sentinel or stale (TTL 30 min); fall back to standalone mode

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sentinel = require('./sentinel');

const TTL_MS = 30 * 60 * 1000;

const [, , designArg, artifactId] = process.argv;
if (!designArg || !artifactId) {
  process.stderr.write('check-delegated-token: usage: <design-md-path> <artifact-id>\n');
  process.exit(2);
}

const cwd = process.cwd();
const abs = path.isAbsolute(designArg) ? designArg : path.resolve(cwd, designArg);
const rel = path.relative(cwd, abs).split(path.sep).join('/');

const tokenInput = `${rel}#${artifactId}`;
const key = crypto.createHash('sha1').update(tokenInput).digest('hex').slice(0, 16);
const sen = sentinel.readSentinel('delegated-mode', key);

if (!sen) {
  process.stderr.write(`no delegated-mode sentinel for ${rel}#${artifactId} — standalone mode\n`);
  process.exit(1);
}

const v = sentinel.validate(sen, TTL_MS);
if (!v.ok) {
  // Don't error out — sub-skill should fall back to standalone with a warning.
  process.stderr.write(`delegated-mode sentinel stale: ${v.reason} — falling back to standalone\n`);
  process.exit(1);
}

if (sen.design_path !== rel || sen.artifact_id !== artifactId) {
  // Cryptographic key collision is improbable; this guards against tampering.
  process.stderr.write('delegated-mode sentinel mismatch (design_path/artifact_id)\n');
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  mode: 'delegated',
  design_path: sen.design_path,
  artifact_id: sen.artifact_id,
  type: sen.type,
  sub_skill: sen.sub_skill,
  age_seconds: Math.floor((Date.now() - new Date(sen.issued_at).getTime()) / 1000),
}) + '\n');
process.exit(0);
