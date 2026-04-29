#!/usr/bin/env node
// harness-sf statusLine. One line: target-org · active design · dispatch progress · last validation age.
// Reads stdin (Claude session JSON) but doesn't require it. Best-effort, never errors.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

// 2. most-recent design.md
let design = null;
let dispatchSummary = null;
let dispatchFailed = false;
safe(() => {
  const dir = path.join(harnessDir, 'designs');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) return;
  design = files[0].f;
});

// 2b. dispatch-state — prefer canonical .harness-sf/state/<slug>__r<rev>.json
//      (PR B dual-read). Falls back to legacy .cache/dispatch-state/<slug>.json.
let currentStep = null;
let enteredVia = null;
safe(() => {
  const stateDir = path.join(harnessDir, 'state');
  if (fs.existsSync(stateDir)) {
    const files = fs.readdirSync(stateDir)
      .filter(f => /^[a-z0-9-]+__r\d+\.json$/.test(f))
      .map(f => ({ f, m: fs.statSync(path.join(stateDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) {
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, files[0].f), 'utf8'));
      if (state && Array.isArray(state.artifacts)) {
        const total = state.artifacts.length;
        const done = state.artifacts.filter(a => a.status === 'done').length;
        const failed = state.artifacts.filter(a => a.status === 'failed').length;
        dispatchSummary = `${done}/${total}${failed ? `!${failed}` : ''}`;
        dispatchFailed = failed > 0;
        if (state.current_step) currentStep = state.current_step;
        if (state.entered_via) enteredVia = state.entered_via;
        return; // canonical succeeded — skip legacy
      }
    }
  }
  // Legacy fallback.
  const dsDir = path.join(cacheDir, 'dispatch-state');
  if (!fs.existsSync(dsDir)) return;
  const files = fs.readdirSync(dsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, m: fs.statSync(path.join(dsDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) return;
  const state = JSON.parse(fs.readFileSync(path.join(dsDir, files[0].f), 'utf8'));
  if (!state || !Array.isArray(state.artifacts)) return;
  const total = state.artifacts.length;
  const done = state.artifacts.filter(a => a.status === 'done').length;
  const failed = state.artifacts.filter(a => a.status === 'failed').length;
  dispatchSummary = `${done}/${total}${failed ? `!${failed}` : ''}`;
  dispatchFailed = failed > 0;
});

// 2c. fallback to design.md scan if no dispatch-state yet
if (design && !dispatchSummary) {
  safe(() => {
    const body = fs.readFileSync(path.join(harnessDir, 'designs', design), 'utf8');
    const all = (body.match(/\[status:\s*\w+\]/g) || []);
    const done = (body.match(/\[status:\s*done\]/g) || []);
    if (all.length) dispatchSummary = `${done.length}/${all.length}`;
  });
}

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

// 3. last-validation age
let lastVal = null;
safe(() => {
  const p = path.join(harnessDir, 'last-validation.json');
  if (!fs.existsSync(p)) return;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (data && data.validated_at) {
    const ageMs = Date.now() - new Date(data.validated_at).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      const m = Math.floor(ageMs / 60000);
      lastVal = m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
    }
  }
});

const parts = ['🔧 sf-harness'];
if (org && org.value) parts.push(`org:${org.value}`);
if (design) {
  const short = design.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  parts.push(`design:${short.slice(0, 28)}`);
}
if (dispatchSummary) parts.push(`dispatch:${dispatchSummary}${dispatchFailed ? ' ✗' : ''}`);
if (enteredVia && enteredVia !== 'full') parts.push(`[${enteredVia}]`);
if (currentStep) parts.push(`step:${currentStep}`);
if (scoreSummary) parts.push(`score:${scoreSummary}`);
if (lastVal) parts.push(`val:${lastVal}`);

process.stdout.write(parts.join(' · '));
