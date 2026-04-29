'use strict';
// hsf doctor [--repair <slug>] [--fingerprint] — basic health/repair tooling.
// Per .harness-sf/designs/2026-04-29-state-consolidation-v3.md (PR A scope).
//
// Subcommands handled here:
//   doctor                       → list state files + lock status + schema validation
//   doctor --repair <slug>       → pick latest revision, clear stale lock, validate, optional reset
//   doctor --fingerprint         → echo fingerprint mode plan (placeholder until fingerprint v3 lands)
//
// More advanced (e.g. --migrate-fingerprint-mode) deferred to fingerprint PR.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { validate } = require('./validator');

const STATE_DIR = path.join(process.cwd(), '.harness-sf', 'state');

function fail(msg, code) {
  process.stderr.write(`hsf doctor: ${msg}\n`);
  process.exit(code || 1);
}

function listStateFiles() {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs.readdirSync(STATE_DIR)
    .filter(f => f.endsWith('.json') && f !== 'global.json')
    .map(f => {
      const m = f.match(/^(.+)__r(\d+)\.json$/);
      if (!m) return { file: f, slug: null, revision: null, malformed: true };
      return { file: f, slug: m[1], revision: parseInt(m[2], 10), malformed: false };
    });
}

function describeLock(slug, revision) {
  const lockPath = store.lockFilePath(slug, revision);
  if (!fs.existsSync(lockPath)) return { held: false };
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return { held: true, stale: true, malformed: true }; }
  return { held: true, lock, stale: store.lockIsStale(lock) };
}

function runDoctor() {
  const files = listStateFiles();
  if (!files.length) {
    process.stdout.write('hsf doctor: no state files found in .harness-sf/state/\n');
    return 0;
  }
  process.stdout.write(`hsf doctor — ${files.length} state file(s)\n`);
  let issues = 0;
  for (const f of files) {
    if (f.malformed) {
      process.stdout.write(`  ✗ ${f.file} — malformed filename (expected <slug>__r<revision>.json)\n`);
      issues++;
      continue;
    }
    let cur;
    try { cur = store.readState(f.slug, f.revision); }
    catch (e) {
      process.stdout.write(`  ✗ ${f.file} — read error: ${e.message}\n`);
      issues++; continue;
    }
    if (!cur) {
      process.stdout.write(`  ✗ ${f.file} — vanished between listing and read\n`);
      issues++; continue;
    }
    const v = validate(cur.state);
    const lock = describeLock(f.slug, f.revision);
    let status = '✓';
    const notes = [];
    if (!v.ok) {
      status = '✗';
      issues++;
      notes.push(`schema invalid (${v.errors.length} errors)`);
    }
    if (lock.held && lock.stale) notes.push(`stale lock (pid=${lock.lock && lock.lock.pid})`);
    else if (lock.held) notes.push(`active lock (pid=${lock.lock && lock.lock.pid})`);
    process.stdout.write(`  ${status} ${f.file} — version=${cur.version}, step=${cur.state.current_step}, artifacts=${cur.state.artifacts.length}` +
      (notes.length ? `  [${notes.join('; ')}]` : '') + '\n');
    if (!v.ok) {
      for (const e of v.errors) process.stdout.write(`      - ${e}\n`);
    }
  }
  if (issues) process.stdout.write(`hsf doctor: ${issues} issue(s) found. Run 'hsf doctor --repair <slug>' for guided fix.\n`);
  return issues ? 2 : 0;
}

function runRepair(slug) {
  const files = listStateFiles().filter(f => f.slug === slug);
  if (!files.length) fail(`no state files for slug '${slug}'`, 2);
  files.sort((a, b) => b.revision - a.revision);
  const target = files[0];
  process.stdout.write(`hsf doctor --repair: targeting ${target.file}\n`);

  const lockPath = store.lockFilePath(target.slug, target.revision);
  if (fs.existsSync(lockPath)) {
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* corrupt */ }
    if (lock && !store.lockIsStale(lock)) {
      fail(`lock still active (pid=${lock.pid}, host=${lock.host}). Aborting — kill the process first if needed.`, 3);
    }
    fs.unlinkSync(lockPath);
    process.stdout.write(`  - removed stale lock\n`);
  }

  let cur;
  try { cur = store.readState(target.slug, target.revision); }
  catch (e) {
    process.stdout.write(`  ✗ state file unreadable: ${e.message}\n`);
    process.stdout.write(`  Manual recovery: inspect ${store.stateFilePath(target.slug, target.revision)}\n`);
    return 4;
  }
  if (!cur) fail('state file vanished', 4);
  const v = validate(cur.state);
  if (v.ok) {
    process.stdout.write(`  ✓ state schema valid (no further repair needed)\n`);
    return 0;
  }
  process.stdout.write(`  ✗ state schema invalid:\n`);
  for (const e of v.errors) process.stdout.write(`      - ${e}\n`);
  process.stdout.write(`\n  This release does not auto-mutate invalid state. Options:\n`);
  process.stdout.write(`    1. Edit ${store.stateFilePath(target.slug, target.revision)} manually to fix listed errors.\n`);
  process.stdout.write(`    2. Delete the file to force re-init from /sf-feature.\n`);
  return 5;
}

const argv = process.argv.slice(2);
if (argv.includes('--fingerprint')) {
  process.stdout.write('hsf doctor --fingerprint: deferred to fingerprint PR (non-git-fingerprint v3).\n');
  process.exit(0);
}
const repairIdx = argv.indexOf('--repair');
if (repairIdx !== -1) {
  const slug = argv[repairIdx + 1];
  if (!slug) fail('--repair requires <slug>', 2);
  process.exit(runRepair(slug));
}
process.exit(runDoctor());
