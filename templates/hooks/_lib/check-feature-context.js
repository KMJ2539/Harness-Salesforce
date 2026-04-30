#!/usr/bin/env node
// harness-sf — sub-skill side check for active feature design.md context.
//
// Called by /sf-apex, /sf-lwc, /sf-aura, /sf-sobject, /sf-field at Step 0.3
// (after delegated-token check has fallen back to standalone) to decide whether
// the user should be redirected to /sf-feature instead of running standalone.
//
// Rationale: the harness's design-first principle is best honored when feature-level
// 5-persona review covers cross-cutting concerns. Standalone artifact runs only get
// a single-artifact review and skip composite design. A recent feature design.md
// with pending artifacts is a strong signal the user is mid-feature.
//
// Usage:
//   node .claude/hooks/_lib/check-feature-context.js [--max-age-days=14]
//
// Exit:
//   0 — always (advisory). Prints JSON:
//   {
//     has_active_feature: bool,
//     candidates: [
//       { path, name, slug, age_days, pending_artifacts: [{id, type}] }
//     ]
//   }
//
// "Active" = feature design.md frontmatter type==feature, modified within max-age,
// AND has incomplete artifacts.
//
// Source priority (P0 — control state singularity):
//   1. canonical .harness-sf/state/<slug>__r<rev>.json — primary truth.
//   2. design.md `## Artifacts [status: ...]` tags — bootstrap fallback only,
//      used when no state file exists yet (pre-dispatch). Emits a warn so
//      drift on this path is observable.

'use strict';
const fs = require('fs');
const path = require('path');

const MAX_AGE_DAYS_DEFAULT = 14;

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

function extractArtifactsSection(text) {
  const startRe = /^##\s+Artifacts\s*$/m;
  const startMatch = text.match(startRe);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIdx);
  const nextRe = /^##\s+(?!Artifacts)/m;
  const nextMatch = rest.match(nextRe);
  return nextMatch ? rest.slice(0, nextMatch.index) : rest;
}

// Bootstrap fallback only. Use readPendingFromState() first; fall back here
// when no canonical state.json exists for the slug yet.
function parsePendingFromDesignMd(section) {
  if (!section) return [];
  const headerRe = /^###\s+\d+\.\s+([\w-]+)\s+(.+)$/gm;
  const out = [];
  let m;
  while ((m = headerRe.exec(section)) !== null) {
    const id = m[1];
    const tags = m[2];
    const typeMatch = tags.match(/\[type:\s*([\w-]+)\s*\]/i);
    const statusMatch = tags.match(/\[status:\s*([\w-]+)\s*\]/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() : 'pending';
    if (status === 'pending' || status === 'in_progress' || status === 'in-progress') {
      out.push({ id, type: typeMatch ? typeMatch[1].toLowerCase() : null, status });
    }
  }
  return out;
}

// Canonical-first: read pending/in_progress artifacts from
// .harness-sf/state/<slug>__r<rev>.json (latest revision). Returns null if no
// state file exists for this slug — caller should bootstrap from design.md.
function readPendingFromState(slug, stateDir) {
  if (!fs.existsSync(stateDir)) return null;
  const escaped = slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^${escaped}__r(\\d+)\\.json$`);
  let entries;
  try { entries = fs.readdirSync(stateDir); } catch { return null; }
  const matches = entries
    .map(f => ({ f, m: f.match(re) }))
    .filter(x => x.m)
    .map(x => ({ f: x.f, rev: parseInt(x.m[1], 10) }))
    .sort((a, b) => b.rev - a.rev);
  if (!matches.length) return null;
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(stateDir, matches[0].f), 'utf8')); }
  catch { return null; }
  if (!state || !Array.isArray(state.artifacts)) return null;
  const out = [];
  for (const a of state.artifacts) {
    const status = (a.status || '').toLowerCase();
    if (status === 'pending' || status === 'in_progress') {
      out.push({ id: a.id, type: a.type || null, status });
    }
  }
  return out;
}

const args = process.argv.slice(2);
const maxAgeArg = args.find((a) => a.startsWith('--max-age-days='));
const maxAgeDays = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : MAX_AGE_DAYS_DEFAULT;
const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

const cwd = process.cwd();
const designsDir = path.join(cwd, '.harness-sf', 'designs');
const stateDir = path.join(cwd, '.harness-sf', 'state');

const result = { has_active_feature: false, candidates: [] };

if (!fs.existsSync(designsDir)) {
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

let entries;
try { entries = fs.readdirSync(designsDir); } catch { entries = []; }

const now = Date.now();
for (const f of entries) {
  if (!f.endsWith('.md')) continue;
  const abs = path.join(designsDir, f);
  let stat;
  try { stat = fs.statSync(abs); } catch { continue; }
  const ageMs = now - stat.mtimeMs;
  if (ageMs > maxAgeMs) continue;

  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
  const fm = parseFrontmatter(text);
  if (!fm) continue;
  if ((fm.type || '').toLowerCase() !== 'feature') continue;

  const slug = f.replace(/\.md$/, '');

  // Canonical-first: prefer state.json. Fall back to design.md only when
  // the state file does not exist yet (pre-dispatch bootstrap).
  let artifacts = readPendingFromState(slug, stateDir);
  let source = 'state';
  if (artifacts === null) {
    artifacts = parsePendingFromDesignMd(extractArtifactsSection(text));
    source = 'design-md-bootstrap';
    if (artifacts.length > 0) {
      process.stderr.write(
        `check-feature-context: bootstrap fallback — state.json absent for slug '${slug}', reading design.md [status:] tags\n`
      );
    }
  }
  if (artifacts.length === 0) continue;

  const rel = path.relative(cwd, abs).split(path.sep).join('/');
  result.candidates.push({
    path: rel,
    name: fm.name || '',
    slug,
    age_days: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    pending_artifacts: artifacts,
    source,
  });
}

result.has_active_feature = result.candidates.length > 0;
// Sort: most recent first
result.candidates.sort((a, b) => a.age_days - b.age_days);

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(0);
