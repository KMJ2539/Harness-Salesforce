#!/usr/bin/env node
// harness-sf statusLine. One line:
//   🔧 sf-harness · org:X · design:Y · phase:build · current:Z · dispatch:2/5 · failed:1 · approval:23m · step:7.5 · val:1h
//
// Token rules (P1 — observability):
//   - phase: omitted when no design.md (idle); shown otherwise.
//   - current: shown only when state has an in_progress artifact (typically build phase).
//   - dispatch: shown when state.json exists; format is `done/total` (failed split out).
//   - failed: shown only when failed > 0.
//   - approval: shown only when remainingMs < 60m (or expired); names the closest-to-expiry sentinel.
//   - val: last-validation age, always when available.
//
// Reads stdin (Claude session JSON) but doesn't require it. Best-effort, never errors.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { summarize } = require('./_lib/state-summary');

const cwd = process.cwd();
const harnessDir = path.join(cwd, '.harness-sf');
const cacheDir = path.join(harnessDir, '.cache');

function safe(fn, def) { try { return fn(); } catch { return def; } }

function readJsonCache(name, ttlMs) {
  const p = path.join(cacheDir, name);
  if (!fs.existsSync(p)) return null;
  const stat = fs.statSync(p);
  if (Date.now() - stat.mtimeMs > ttlMs) return null;
  return safe(() => JSON.parse(fs.readFileSync(p, 'utf8')), null);
}

function writeJsonCache(name, data) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, name), JSON.stringify(data));
  } catch {}
}

// 1. target-org (cached 5 min)
let org = readJsonCache('org.json', 5 * 60 * 1000);
if (!org) {
  const r = safe(() => {
    const isWin = process.platform === 'win32';
    const res = isWin
      ? spawnSync('sf config get target-org --json', { encoding: 'utf8', shell: true, timeout: 2500 })
      : spawnSync('sf', ['config', 'get', 'target-org', '--json'], { encoding: 'utf8', timeout: 2500 });
    return res.status === 0 ? JSON.parse(res.stdout) : null;
  }, null);
  if (r && r.result && r.result[0]) {
    org = { value: r.result[0].value || null };
    writeJsonCache('org.json', org);
  }
}

// 2. shared state summary (P1)
const sum = summarize({ cwd });

// 2b. read state.json directly only for the auxiliary fields (current_step / entered_via)
//     that aren't part of state-summary's contract.
let currentStep = null;
let enteredVia = null;
safe(() => {
  const stateDir = path.join(harnessDir, 'state');
  if (!sum.designSlug || !fs.existsSync(stateDir)) return;
  const escaped = sum.designSlug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^${escaped}__r(\\d+)\\.json$`);
  const files = fs.readdirSync(stateDir)
    .map(f => ({ f, m: f.match(re) }))
    .filter(x => x.m)
    .sort((a, b) => parseInt(b.m[1], 10) - parseInt(a.m[1], 10));
  if (!files.length) return;
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, files[0].f), 'utf8'));
  if (state && state.current_step) currentStep = state.current_step;
  if (state && state.entered_via) enteredVia = state.entered_via;
});

// 2d. quality score (most recent slug's aggregate)
let scoreSummary = null;
safe(() => {
  const dir = path.join(cacheDir, 'scores');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) return;
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0].f), 'utf8'));
  const present = Object.keys(rec.scores || {});
  if (!present.length) return;
  const weights = { design: 0.30, code_review: 0.25, test: 0.25, deploy: 0.20 };
  let ws = 0, ss = 0;
  for (const c of present) { const w = weights[c] || 0; ws += w; ss += w * rec.scores[c].score; }
  if (ws === 0) return;
  const agg = Math.round((ss / ws) * 10) / 10;
  scoreSummary = `${agg}/10 (${present.length}/4)`;
});

function fmtAgeMs(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const m = Math.floor(ageMs / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

function fmtApproval(remainingMs, kind) {
  if (remainingMs <= 0) return `approval:expired(${kind})`;
  const m = Math.floor(remainingMs / 60000);
  return `approval:${m}m(${kind.replace(/-approvals$/, '')})`;
}

const parts = ['🔧 sf-harness'];
if (org && org.value) parts.push(`org:${org.value}`);

if (sum.hasDesign) {
  const short = sum.designFile.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  parts.push(`design:${short.slice(0, 28)}`);
  parts.push(`phase:${sum.phase}`);
}

if (sum.current) parts.push(`current:${sum.current}`);

if (sum.total > 0) parts.push(`dispatch:${sum.done}/${sum.total}`);
if (sum.failed > 0) parts.push(`failed:${sum.failed}`);

if (sum.approvalTtlMs !== null && sum.approvalTtlMs < 60 * 60 * 1000) {
  parts.push(fmtApproval(sum.approvalTtlMs, sum.approvalKind));
}

if (enteredVia && enteredVia !== 'full') parts.push(`[${enteredVia}]`);
if (currentStep) parts.push(`step:${currentStep}`);
if (scoreSummary) parts.push(`score:${scoreSummary}`);

const lastVal = fmtAgeMs(sum.lastValidationAgeMs);
if (lastVal) parts.push(`val:${lastVal}`);

process.stdout.write(parts.join(' · '));
