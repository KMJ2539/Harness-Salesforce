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
// and `## Artifacts` has ≥1 entry with `[status: pending]` or `[status: in_progress]`.

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

function parsePendingArtifacts(section) {
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

const args = process.argv.slice(2);
const maxAgeArg = args.find((a) => a.startsWith('--max-age-days='));
const maxAgeDays = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : MAX_AGE_DAYS_DEFAULT;
const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

const cwd = process.cwd();
const designsDir = path.join(cwd, '.harness-sf', 'designs');

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

  const artifacts = parsePendingArtifacts(extractArtifactsSection(text));
  if (artifacts.length === 0) continue;

  const rel = path.relative(cwd, abs).split(path.sep).join('/');
  result.candidates.push({
    path: rel,
    name: fm.name || '',
    slug: f.replace(/\.md$/, ''),
    age_days: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
    pending_artifacts: artifacts,
  });
}

result.has_active_feature = result.candidates.length > 0;
// Sort: most recent first
result.candidates.sort((a, b) => a.age_days - b.age_days);

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(0);
