#!/usr/bin/env node
// harness-sf — quality score recorder. Lightweight 0~10 scoring per artifact slug.
//
// Storage: .harness-sf/.cache/scores/{slug}.json
//   {
//     slug, updated_at,
//     scores: {
//       design:      { score, detail, recorded_at },
//       code_review: { score, detail, recorded_at },
//       test:        { score, detail, recorded_at },
//       deploy:      { score, detail, recorded_at }
//     },
//     history: [{ category, score, recorded_at, detail }]   // append-only audit
//   }
//
// Aggregate score = weighted average of present categories.
// Default weights: design=0.30, code_review=0.25, test=0.25, deploy=0.20.
// Override via .harness-sf/PROJECT.md `scoring.weights:` block (future).
//
// Commands:
//   record <slug> <category> <score> [--detail "text"]
//   show <slug>            — JSON of slug record
//   aggregate <slug>       — single number 0~10 (or "n/a" if no scores)
//   list                   — all slugs with aggregates
//   compute-design <design.md path> — auto-derive design score from validate-design.js
//
// Iron Law: scoring is *advisory*. Hooks MUST NOT block on score thresholds —
// scoring exists to surface drift, not to gate. Skills may show the score but
// cannot use it as a sentinel.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VALID_CATEGORIES = ['design', 'code_review', 'test', 'deploy'];
const WEIGHTS = { design: 0.30, code_review: 0.25, test: 0.25, deploy: 0.20 };

function scoresDir() {
  return path.join(process.cwd(), '.harness-sf', '.cache', 'scores');
}

function recordPath(slug) {
  return path.join(scoresDir(), `${slug}.json`);
}

function loadRecord(slug) {
  const p = recordPath(slug);
  if (!fs.existsSync(p)) return { slug, updated_at: null, scores: {}, history: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { slug, updated_at: null, scores: {}, history: [] }; }
}

function saveRecord(slug, rec) {
  fs.mkdirSync(scoresDir(), { recursive: true });
  fs.writeFileSync(recordPath(slug), JSON.stringify(rec, null, 2));
}

function aggregate(rec) {
  const present = Object.keys(rec.scores).filter((c) => VALID_CATEGORIES.includes(c));
  if (!present.length) return null;
  let weightSum = 0;
  let scoreSum = 0;
  for (const c of present) {
    const w = WEIGHTS[c] || 0;
    weightSum += w;
    scoreSum += w * rec.scores[c].score;
  }
  if (weightSum === 0) return null;
  return Math.round((scoreSum / weightSum) * 10) / 10;
}

function fail(msg) {
  process.stderr.write(`score-cli: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'record') {
  const slug = args[1];
  const category = args[2];
  const scoreRaw = args[3];
  const detailIdx = args.indexOf('--detail');
  const detail = detailIdx > 0 ? (args[detailIdx + 1] || '') : '';
  if (!slug || !category || scoreRaw === undefined) fail('usage: record <slug> <category> <score> [--detail "text"]');
  if (!VALID_CATEGORIES.includes(category)) fail(`category must be one of ${VALID_CATEGORIES.join('|')}`);
  const score = parseFloat(scoreRaw);
  if (!Number.isFinite(score) || score < 0 || score > 10) fail('score must be a number in [0, 10]');
  const rec = loadRecord(slug);
  const now = new Date().toISOString();
  rec.scores[category] = { score: Math.round(score * 10) / 10, detail, recorded_at: now };
  rec.history.push({ category, score: Math.round(score * 10) / 10, detail, recorded_at: now });
  rec.updated_at = now;
  saveRecord(slug, rec);
  const agg = aggregate(rec);
  process.stdout.write(`recorded ${slug}.${category}=${rec.scores[category].score}/10 (aggregate: ${agg !== null ? agg : 'n/a'})\n`);
  process.exit(0);
}

if (cmd === 'show') {
  const slug = args[1];
  if (!slug) fail('usage: show <slug>');
  const rec = loadRecord(slug);
  const agg = aggregate(rec);
  process.stdout.write(JSON.stringify({ ...rec, aggregate: agg }, null, 2) + '\n');
  process.exit(0);
}

if (cmd === 'aggregate') {
  const slug = args[1];
  if (!slug) fail('usage: aggregate <slug>');
  const rec = loadRecord(slug);
  const agg = aggregate(rec);
  process.stdout.write((agg !== null ? String(agg) : 'n/a') + '\n');
  process.exit(0);
}

if (cmd === 'list') {
  const dir = scoresDir();
  if (!fs.existsSync(dir)) { process.stdout.write('[]\n'); process.exit(0); }
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ slug: rec.slug, aggregate: aggregate(rec), updated_at: rec.updated_at, categories: Object.keys(rec.scores || {}) });
    } catch {}
  }
  out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

if (cmd === 'compute-design') {
  // Auto-compute design score from validate-design.js --check-resolution output.
  // Formula: start from 10. For each unresolved HIGH: -3. Each unresolved MEDIUM: -1.
  // Each shallow resolution: -0.5. Each legacy unlabeled risk: -0.5. Clamp [0, 10].
  // If reviews_present=false → "n/a" (no review yet → no design score).
  const designPath = args[1];
  const slug = args[2];
  if (!designPath || !slug) fail('usage: compute-design <design-md-path> <slug>');
  const validator = path.join(__dirname, 'validate-design.js');
  const r = spawnSync(process.execPath, [validator, designPath, '--check-resolution'], { encoding: 'utf8' });
  let parsed = null;
  if (r.status === 0) {
    try { parsed = JSON.parse(r.stdout); } catch {}
  }
  // When validator fails (e.g., unresolved HIGH), it exits 1 — we still try to derive a score from stderr
  // by counting issues. But cleaner: re-run without strict mode. For now: if exit !== 0, return floor 0.
  if (!parsed) {
    if (r.status === 0) fail('validator output not parseable');
    // Failure mode: count unresolved from stderr lines.
    const stderr = r.stderr || '';
    const unresolvedHigh = (stderr.match(/unresolved HIGH risks: ([^\n]+)/) || [])[1] || '';
    const unresolvedMed = (stderr.match(/unresolved MEDIUM risks: ([^\n]+)/) || [])[1] || '';
    const shallow = (stderr.match(/shallow resolutions[^:]*:\s*([^\n]+)/) || [])[1] || '';
    const hCount = unresolvedHigh ? unresolvedHigh.split(',').length : 0;
    const mCount = unresolvedMed ? unresolvedMed.split(',').length : 0;
    const sCount = shallow ? shallow.split(',').length : 0;
    let score = 10 - hCount * 3 - mCount * 1 - sCount * 0.5;
    score = Math.max(0, Math.min(10, score));
    const detail = `unresolved H=${hCount}, M=${mCount}, shallow=${sCount} (validator failed)`;
    const rec = loadRecord(slug);
    const now = new Date().toISOString();
    rec.scores.design = { score: Math.round(score * 10) / 10, detail, recorded_at: now };
    rec.history.push({ category: 'design', score: Math.round(score * 10) / 10, detail, recorded_at: now });
    rec.updated_at = now;
    saveRecord(slug, rec);
    process.stdout.write(`recorded ${slug}.design=${rec.scores.design.score}/10 (${detail})\n`);
    process.exit(0);
  }

  if (!parsed.resolution || !parsed.resolution.reviews_present) {
    process.stdout.write('n/a (no Reviews section yet — score not recorded)\n');
    process.exit(0);
  }
  const res = parsed.resolution;
  const hCount = (res.unresolved_high || []).length;
  const mCount = (res.unresolved_medium || []).length;
  const sCount = (res.shallow || []).length;
  const lCount = res.legacy_unlabeled || 0;
  let score = 10 - hCount * 3 - mCount * 1 - sCount * 0.5 - lCount * 0.5;
  score = Math.max(0, Math.min(10, score));
  const detail = `risks=${(res.risks || []).length} unresolved(H=${hCount},M=${mCount}) shallow=${sCount} legacy=${lCount}`;
  const rec = loadRecord(slug);
  const now = new Date().toISOString();
  rec.scores.design = { score: Math.round(score * 10) / 10, detail, recorded_at: now };
  rec.history.push({ category: 'design', score: Math.round(score * 10) / 10, detail, recorded_at: now });
  rec.updated_at = now;
  saveRecord(slug, rec);
  process.stdout.write(`recorded ${slug}.design=${rec.scores.design.score}/10 (${detail})\n`);
  process.exit(0);
}

fail(`unknown command '${cmd || ''}' — use record|show|aggregate|list|compute-design`);
