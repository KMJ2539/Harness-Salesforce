#!/usr/bin/env node
// harness-sf — issues a DELEGATED-MODE sentinel for sub-skill calls dispatched by
// /sf-feature Step 6. The sub-skill's Step 0 reads this sentinel to confirm it was
// actually called from the feature orchestrator (not a user pretending) and which
// artifact to process.
//
// Usage:
//   node .claude/hooks/_lib/issue-delegated-token.js <design-md-path> <artifact-id>
//
// Writes:
//   .harness-sf/.cache/delegated-mode/<sha1(designPath + '#' + artifactId)[:16]>.json
//   { issued_at, head_sha, design_path, artifact_id, type, sub_skill }
//
// TTL: 30 min (read-side enforcement in sub-skill or future hook).
// Iron Laws:
//   - design.md must exist and have feature-type frontmatter
//   - artifact_id must appear under "## Artifacts" with [type: ...] tag
//   - sub_skill is inferred from the artifact's [type: ...] (sobject→/sf-sobject etc.)

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sentinel = require('./sentinel');

const TYPE_TO_SKILL = {
  sobject: '/sf-sobject',
  field: '/sf-field',
  apex: '/sf-apex',
  lwc: '/sf-lwc',
  aura: '/sf-aura',
};

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

// Extract artifact section by id. Looks for "### N. <id>  [type: X] ..."
function findArtifact(text, id) {
  const re = new RegExp(`^###\\s*\\d+\\.\\s*${id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b[^\\n]*$`, 'm');
  const headerMatch = text.match(re);
  if (!headerMatch) return null;
  const header = headerMatch[0];
  const typeMatch = header.match(/\[type:\s*([\w-]+)\s*\]/i);
  if (!typeMatch) return null;
  return { type: typeMatch[1].toLowerCase(), header };
}

function fail(msg) {
  process.stderr.write(`issue-delegated-token: ${msg}\n`);
  process.exit(1);
}

const [, , designArg, artifactId] = process.argv;
if (!designArg || !artifactId) fail('usage: issue-delegated-token.js <design-md-path> <artifact-id>');

const cwd = process.cwd();
const abs = path.isAbsolute(designArg) ? designArg : path.resolve(cwd, designArg);
const rel = path.relative(cwd, abs).split(path.sep).join('/');

if (rel.startsWith('..')) fail(`'${designArg}' is outside project root`);
if (!rel.startsWith('.harness-sf/designs/')) fail(`'${rel}' must live under .harness-sf/designs/`);
if (!fs.existsSync(abs)) fail(`'${rel}' does not exist`);

const text = fs.readFileSync(abs, 'utf8');
const fm = parseFrontmatter(text);
if (!fm) fail(`'${rel}' has no YAML frontmatter`);
if ((fm.type || '').toLowerCase() !== 'feature') {
  fail(`'${rel}' frontmatter type must be 'feature' (got '${fm.type || ''}')`);
}

const artifact = findArtifact(text, artifactId);
if (!artifact) fail(`artifact '${artifactId}' not found in ${rel} (need '### N. ${artifactId}  [type: ...]' header)`);

const subSkill = TYPE_TO_SKILL[artifact.type] || null;
if (!subSkill) fail(`artifact type '${artifact.type}' has no dispatch skill (supported: ${Object.keys(TYPE_TO_SKILL).join(', ')})`);

// PR C2 — populate slug + design_revision so sentinel captures fingerprint + state_version.
const slug = (fm.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const designRevision = parseInt(fm.revision || '1', 10) || 1;

const tokenInput = `${rel}#${artifactId}`;
const key = crypto.createHash('sha1').update(tokenInput).digest('hex').slice(0, 16);
const extras = {
  design_path: rel,
  artifact_id: artifactId,
  type: artifact.type,
  sub_skill: subSkill,
};
if (slug) extras.slug = slug;
if (designRevision) extras.design_revision = designRevision;
const data = sentinel.writeSentinel('delegated-mode', key, extras);

const fpDesc = data.fingerprint ? `${data.fingerprint.mode}=${String(data.fingerprint.value).slice(0, 12)}…`
                                : `head=${(data.head_sha || 'no-git').slice(0, 7)}`;
process.stdout.write(`delegated-token: ${rel}#${artifactId} → ${subSkill} (key=${key}, ${fpDesc})\n`);
process.exit(0);
