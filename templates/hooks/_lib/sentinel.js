'use strict';
// harness-sf sentinel utilities — shared across pre-*-gate.js hooks.
// Sentinel = JSON file under .harness-sf/.cache/<kind>/<key>.json that proves
// "this action was approved at this point in time, against this code state".
//
// Two invariants:
//   1) TTL freshness — approval not older than ttlMs
//   2) head_sha match — current git HEAD == sha at approval time (skipped if not a git repo)
//
// Public API:
//   - sentinelDir(kind)               → absolute dir for a sentinel kind
//   - sentinelPath(kind, key)         → absolute file path
//   - keyFromPath(absPath)            → stable sha1 key for a file path
//   - readSentinel(kind, key)         → parsed JSON or null
//   - writeSentinel(kind, key, extra) → writes { issued_at, head_sha, ...extra }
//   - validate(sentinel, ttlMs)       → { ok, reason } — TTL + head_sha checks
//   - gitHeadSha()                    → 40-char SHA or null
//   - cwd()                           → process.cwd()

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function cwd() { return process.cwd(); }

function sentinelDir(kind) {
  return path.join(cwd(), '.harness-sf', '.cache', kind);
}

function sentinelPath(kind, key) {
  return path.join(sentinelDir(kind), `${key}.json`);
}

function keyFromPath(absPath) {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);
}

function gitHeadSha() {
  try {
    const isWin = process.platform === 'win32';
    const r = isWin
      ? spawnSync('git rev-parse HEAD', { encoding: 'utf8', shell: true, timeout: 1500 })
      : spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 1500 });
    if (r.status !== 0) return null;
    const out = (r.stdout || '').trim();
    return /^[0-9a-f]{40}$/i.test(out) ? out : null;
  } catch { return null; }
}

function readSentinel(kind, key) {
  const p = sentinelPath(kind, key);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeSentinel(kind, key, extra = {}) {
  const dir = sentinelDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  const data = {
    issued_at: new Date().toISOString(),
    head_sha: gitHeadSha(),
    ...extra,
  };
  fs.writeFileSync(sentinelPath(kind, key), JSON.stringify(data, null, 2) + '\n');
  return data;
}

// validate({ issued_at, head_sha, ... }, ttlMs) → { ok: bool, reason: string }
// Returns ok=true only if both TTL and head_sha (when available) checks pass.
function validate(sentinel, ttlMs) {
  if (!sentinel) return { ok: false, reason: 'no sentinel' };

  const issuedAt = sentinel.issued_at ? new Date(sentinel.issued_at).getTime() : NaN;
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed issued_at' };

  const ageMs = Date.now() - issuedAt;
  if (ageMs > ttlMs) {
    const min = Math.floor(ageMs / 60000);
    const ttlMin = Math.floor(ttlMs / 60000);
    return { ok: false, reason: `sentinel is ${min}m old (>${ttlMin}m TTL)` };
  }

  const head = gitHeadSha();
  // If repo is not a git repo (head=null), skip head_sha check (soft-fail like deploy-gate).
  if (head && sentinel.head_sha && sentinel.head_sha !== head) {
    return {
      ok: false,
      reason: `HEAD moved since approval (approved ${String(sentinel.head_sha).slice(0,7)}, now ${head.slice(0,7)})`,
    };
  }

  return { ok: true, reason: 'fresh' };
}

module.exports = {
  cwd,
  sentinelDir,
  sentinelPath,
  keyFromPath,
  gitHeadSha,
  readSentinel,
  writeSentinel,
  validate,
};
