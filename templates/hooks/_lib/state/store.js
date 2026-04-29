'use strict';
// state.json atomic I/O — zero-dep.
// Per .harness-sf/designs/2026-04-29-state-consolidation-v3.md (PR A).
//
// API:
//   stateFilePath(slug, designRevision) → absolute path
//   readState(slug, designRevision) → { state, version } or null
//   writeState(slug, designRevision, mutator, opts?)
//     mutator: (currentState) → newState (sync). Returns null to abort.
//     opts: { expectedVersion?: number, operation?: string }
//   acquireLock(slug, designRevision, operation) → boolean
//   releaseLock(slug, designRevision)
//
// Lock: lockfile via O_CREAT|O_EXCL with stale check (PID + 30min TTL).
// Atomic write: temp file + fsync + rename.
// CAS: read version → mutate → write only if version unchanged.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { validate } = require('./validator');

const STATE_DIR = path.join(process.cwd(), '.harness-sf', 'state');
const LOCK_TTL_MS = 30 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function stateFilePath(slug, designRevision) {
  return path.join(STATE_DIR, `${slug}__r${designRevision}.json`);
}

function lockFilePath(slug, designRevision) {
  return path.join(STATE_DIR, `${slug}__r${designRevision}.lock`);
}

function readState(slug, designRevision) {
  const p = stateFilePath(slug, designRevision);
  if (!fs.existsSync(p)) return null;
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { throw new Error(`failed to read state: ${e.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`state.json is not valid JSON: ${e.message}`); }
  return { state: parsed, version: parsed.version };
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) {
    if (e.code === 'EPERM') return true; // exists but no permission
    return false;
  }
}

function lockIsStale(lock) {
  if (!lock || typeof lock !== 'object') return true;
  if (typeof lock.pid !== 'number') return true;
  if (typeof lock.started_at !== 'string') return true;
  const ageMs = Date.now() - new Date(lock.started_at).getTime();
  if (Number.isNaN(ageMs) || ageMs > LOCK_TTL_MS) return true;
  if (!isPidAlive(lock.pid)) return true;
  return false;
}

function acquireLock(slug, designRevision, operation) {
  ensureDir();
  const lockPath = lockFilePath(slug, designRevision);
  const lockData = {
    pid: process.pid,
    host: os.hostname(),
    started_at: new Date().toISOString(),
    operation: operation || 'unknown',
  };
  try {
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify(lockData));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // Lock exists — check staleness.
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* corrupt */ }
  if (lockIsStale(existing)) {
    try { fs.unlinkSync(lockPath); } catch { /* race */ }
    return acquireLock(slug, designRevision, operation);
  }
  return false;
}

function releaseLock(slug, designRevision) {
  const lockPath = lockFilePath(slug, designRevision);
  try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
}

function atomicWrite(filePath, content) {
  ensureDir();
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // POSIX rename is atomic. On Windows, fs.renameSync replaces dest as of Node 14+.
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EEXIST') {
      fs.unlinkSync(filePath);
      fs.renameSync(tmpPath, filePath);
    } else {
      try { fs.unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      throw e;
    }
  }
}

function writeState(slug, designRevision, mutator, opts) {
  opts = opts || {};
  const operation = opts.operation || 'unknown';
  if (!acquireLock(slug, designRevision, operation)) {
    throw new Error(`state lock held: ${slug}__r${designRevision} — another process is writing. Use 'hsf doctor --repair' if stuck.`);
  }
  try {
    const cur = readState(slug, designRevision);
    const currentVersion = cur ? cur.version : 0;
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
      throw new Error(`CAS conflict: expected version ${opts.expectedVersion}, got ${currentVersion}`);
    }
    const next = mutator(cur ? cur.state : null);
    if (next === null) return null; // mutator aborted
    next.version = currentVersion + 1;
    next.schema_version = 1;
    const v = validate(next);
    if (!v.ok) {
      throw new Error('state validation failed:\n  - ' + v.errors.join('\n  - '));
    }
    atomicWrite(stateFilePath(slug, designRevision), JSON.stringify(next, null, 2) + '\n');
    return next;
  } finally {
    releaseLock(slug, designRevision);
  }
}

module.exports = {
  stateFilePath,
  lockFilePath,
  readState,
  writeState,
  acquireLock,
  releaseLock,
  // exported for doctor/repair use
  lockIsStale,
  isPidAlive,
};
