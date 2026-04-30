#!/usr/bin/env node
// harness-sf — archive superseded revision blocks out of an active design.md
// into a sibling {basename}.archive.md, replacing each with a 1-line stub.
//
// Trigger: /sf-feature Step 5.1.5 (revision bump) and Step 7.5.5
// (design-correction loop). Reduces sub-agent token cost on rev2+ designs.
//
// Usage:
//   node .claude/hooks/_lib/archive-design-revision.js <design-md-path>
//
// Contract:
//   - Marks: blocks fenced by HTML comments like
//       <!-- archive-revision: 1 -->
//       ...content...
//       <!-- /archive-revision: 1 -->
//     The orchestrator (SKILL.md prose) wraps superseded review/resolution
//     bodies in these fences before calling the archiver.
//   - Idempotent: running on a design with no fences is a no-op (exit 0).
//   - The archive file is append-only; never rewrites existing entries.
//
// Exit:
//   0 — archived N blocks (or 0); prints summary on stdout
//   1 — usage / IO error; prints diagnostics on stderr

'use strict';
const fs = require('fs');
const path = require('path');

const FENCE_RE = /<!--\s*archive-revision:\s*(\d+)\s*-->([\s\S]*?)<!--\s*\/archive-revision:\s*\1\s*-->\s*/g;

function fail(msg) { process.stderr.write(`archive-design-revision: ${msg}\n`); process.exit(1); }

const arg = process.argv[2];
if (!arg) fail('usage: archive-design-revision.js <design-md-path>');

const cwd = process.cwd();
const abs = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
const rel = path.relative(cwd, abs).split(path.sep).join('/');

if (!fs.existsSync(abs)) fail(`'${rel}' does not exist`);
if (!rel.startsWith('.harness-sf/designs/')) fail(`'${rel}' must live under .harness-sf/designs/`);

const original = fs.readFileSync(abs, 'utf8');
const blocks = [];
let m;
FENCE_RE.lastIndex = 0;
while ((m = FENCE_RE.exec(original)) !== null) {
  blocks.push({ rev: parseInt(m[1], 10), body: m[2].trim(), full: m[0] });
}

if (blocks.length === 0) {
  process.stdout.write('archive-design-revision: no fenced revision blocks found (no-op)\n');
  process.exit(0);
}

const archivePath = abs.replace(/\.md$/, '.archive.md');
const archiveRel = rel.replace(/\.md$/, '.archive.md');
const archiveBasename = path.basename(archivePath);

const ts = new Date().toISOString();
let archiveAppend = '';
if (!fs.existsSync(archivePath)) {
  archiveAppend += `# Archive — ${path.basename(rel)}\n\n`;
  archiveAppend += `Superseded revision blocks moved out of the active design.md to keep sub-agent context small. Append-only.\n\n`;
}
for (const b of blocks) {
  archiveAppend += `## Revision ${b.rev} (archived ${ts})\n\n${b.body}\n\n---\n\n`;
}

// Replace each fenced block in the active file with a 1-line stub.
let updated = original;
const stubs = new Map();
for (const b of blocks) {
  if (!stubs.has(b.rev)) {
    stubs.set(b.rev, `_(rev ${b.rev} archived → see [${archiveBasename}](./${archiveBasename}))_\n`);
  }
}
// Replace by full match string occurrence — multiple fences for the same rev
// collapse to a single stub on first replacement; subsequent become empty.
const seenRev = new Set();
updated = updated.replace(FENCE_RE, (_match, revStr) => {
  const rev = parseInt(revStr, 10);
  if (seenRev.has(rev)) return '';
  seenRev.add(rev);
  return stubs.get(rev);
});

fs.appendFileSync(archivePath, archiveAppend, 'utf8');
fs.writeFileSync(abs, updated, 'utf8');

process.stdout.write(`archive-design-revision: archived ${blocks.length} block(s) for revision(s) ${[...new Set(blocks.map(b => b.rev))].join(', ')} → ${archiveRel}\n`);
process.exit(0);
