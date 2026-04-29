#!/usr/bin/env node
// harness-sf — issues a DESIGN approval sentinel after the user has approved
// the design.md (5-persona review passed, decisions recorded).
//
// Usage:
//   node .claude/hooks/_lib/issue-design-approval.js <design-md-relative-path>
//
// Writes:
//   .harness-sf/.cache/design-approvals/<sha1(absDesignPath)[:16]>.json
//   { issued_at, head_sha, design_path, type, name }
//
// TTL is enforced by pre-create-design-link-gate.js (2h) — this script does not check it.
// Iron Law: design.md must exist and have YAML frontmatter with `type:` and `name:`.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sentinel = require('./sentinel');

const VALID_TYPES = new Set(['apex', 'lwc', 'aura', 'sobject', 'field', 'feature']);

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/);
    if (kv) fm[kv[1].toLowerCase()] = kv[2];
  }
  return fm;
}

const arg = process.argv[2];
if (!arg) {
  process.stderr.write('issue-design-approval: usage: issue-design-approval.js <design-md-path>\n');
  process.exit(1);
}

const cwd = process.cwd();
const abs = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
const rel = path.relative(cwd, abs).split(path.sep).join('/');

if (rel.startsWith('..')) {
  process.stderr.write(`issue-design-approval: '${arg}' is outside project root\n`);
  process.exit(1);
}
if (!rel.startsWith('.harness-sf/designs/')) {
  process.stderr.write(`issue-design-approval: '${rel}' must live under .harness-sf/designs/\n`);
  process.exit(1);
}
if (!fs.existsSync(abs)) {
  process.stderr.write(`issue-design-approval: '${rel}' does not exist — write design.md first\n`);
  process.exit(1);
}

const text = fs.readFileSync(abs, 'utf8');
const fm = parseFrontmatter(text);
if (!fm) {
  process.stderr.write(`issue-design-approval: '${rel}' has no YAML frontmatter (--- ... ---) at top\n`);
  process.exit(1);
}
const type = (fm.type || '').toLowerCase();
const name = fm.name || '';
if (!VALID_TYPES.has(type)) {
  process.stderr.write(`issue-design-approval: frontmatter 'type' must be one of ${[...VALID_TYPES].join('|')}, got '${type}'\n`);
  process.exit(1);
}
if (!name) {
  process.stderr.write(`issue-design-approval: frontmatter 'name' is required\n`);
  process.exit(1);
}

// Resolution-log gate: if `## Reviews` section exists, every HIGH/MEDIUM risk
// must have a resolution line. Library Verdict gate (feature only): every
// artifact must be classified by sf-design-library-reviewer.
// Skip via HARNESS_SF_SKIP_RESOLUTION_GATE=1 (legacy) or HARNESS_SF_OVERRIDE='design:<reason>' (PR D).
let skipResolution = process.env.HARNESS_SF_SKIP_RESOLUTION_GATE === '1';
try {
  const ovr = require('./override');
  ovr.logIfActive('design', 'issue-design-approval');
  if (ovr.isActive('design')) skipResolution = true;
} catch { /* fall through */ }
if (!skipResolution) {
  const validator = path.join(__dirname, 'validate-design.js');
  const validatorArgs = [validator, rel, '--check-resolution'];
  if (type === 'feature') validatorArgs.push('--check-library-verdict');
  const r = spawnSync(process.execPath, validatorArgs, { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`issue-design-approval: design.md fails review/verdict gate:\n${r.stderr || ''}`);
    process.stderr.write(`\n  Fix '## Review Resolution' / '## Library Verdict' in '${rel}' or set HARNESS_SF_SKIP_RESOLUTION_GATE=1 to bypass.\n`);
    process.exit(1);
  }
}

// PR C2 — pass slug + design_revision so sentinel.writeSentinel captures
// fingerprint + state_version alongside head_sha. slug derived from name.
const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const designRevision = parseInt(fm.revision || '1', 10) || 1;

// Body hash for binding (PR C3 will make this required; PR C1/C2 captures opportunistically).
let bodyHashStr = null;
try {
  const { bodyHash } = require('./state/body-hash');
  bodyHashStr = bodyHash(text);
} catch { /* state/body-hash not available — older harness install */ }

const key = sentinel.keyFromPath(abs);
const extras = { design_path: rel, type, name };
if (slug) extras.slug = slug;
if (designRevision) extras.design_revision = designRevision;
if (bodyHashStr) extras.design_body_hash = bodyHashStr;
const data = sentinel.writeSentinel('design-approvals', key, extras);
const fpDesc = data.fingerprint ? `${data.fingerprint.mode}=${String(data.fingerprint.value).slice(0, 12)}…` : 'no-fingerprint';
const sv = data.state_version != null ? ` state_v=${data.state_version}` : '';
process.stdout.write(`approved DESIGN: ${rel} (type=${type}, name=${name}, ${fpDesc}${sv}, expires in 2h)\n`);
process.exit(0);
