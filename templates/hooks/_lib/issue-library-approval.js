#!/usr/bin/env node
// harness-sf — issues a library install approval sentinel.
// Called by /sf-library-install AFTER plan dump + user approval.
//
// Usage:
//   node .claude/hooks/_lib/issue-library-approval.js <method> <identifier>
//
// Methods (must match pre-library-install-gate.js classify()):
//   package        — 04t Package ID (15/18-char prefixed with 04t)
//   git-clone      — https://github.com/owner/repo
//   git-submodule  — https://github.com/owner/repo
//   npm            — npm package name (e.g. @scope/name or name)
//   staticresource — full CDN URL (https?://...)
//
// Writes:
//   .harness-sf/.cache/library-approvals/<sha1(method|identifier)[:16]>.json
//   { issued_at, head_sha, method, identifier }

'use strict';
const crypto = require('crypto');
const sentinel = require('./sentinel');

const VALID_METHODS = new Set(['package', 'git-clone', 'git-submodule', 'npm', 'staticresource']);

const VALIDATORS = {
  'package':        v => /^04t[A-Za-z0-9]{12,15}$/.test(v),
  'git-clone':      v => /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+?(?:\.git)?$/.test(v),
  'git-submodule':  v => /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+?(?:\.git)?$/.test(v),
  'npm':            v => /^(?:@[\w.\-]+\/)?[\w.\-]+$/.test(v),
  'staticresource': v => /^https?:\/\/[^\s'"]+$/.test(v),
};

const args = process.argv.slice(2);
if (args.length < 2) {
  process.stderr.write('issue-library-approval: usage: <method> <identifier>\n');
  process.stderr.write(`  methods: ${[...VALID_METHODS].join(', ')}\n`);
  process.exit(1);
}

const [method, identifier] = args;

if (!VALID_METHODS.has(method)) {
  process.stderr.write(`issue-library-approval: unknown method '${method}'. Valid: ${[...VALID_METHODS].join(', ')}\n`);
  process.exit(1);
}

if (!VALIDATORS[method](identifier)) {
  process.stderr.write(`issue-library-approval: identifier '${identifier}' fails format check for method '${method}'.\n`);
  process.stderr.write(`  This is the Iron Law: identifiers must come from the user or design.md, never guessed.\n`);
  process.exit(1);
}

const key = crypto.createHash('sha1').update(`${method}|${identifier}`).digest('hex').slice(0, 16);
// PR C2 — library approval is global (cross-feature) so no slug context.
// fingerprint captured automatically; state_version omitted.
const data = sentinel.writeSentinel('library-approvals', key, { method, identifier });
const fpDesc = data.fingerprint ? `${data.fingerprint.mode}=${String(data.fingerprint.value).slice(0, 12)}…`
                                : `head=${(data.head_sha || 'no-git').slice(0, 7)}`;
process.stdout.write(`approved LIBRARY: ${method}=${identifier} (${fpDesc}, expires in 30m)\n`);
