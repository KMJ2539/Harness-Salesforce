'use strict';
// harness-sf sentinel utilities — shared across pre-*-gate.js hooks.
// Sentinel = JSON file under .harness-sf/.cache/<kind>/<key>.json that proves
// "this action was approved at this point in time, against this code state".
//
// Invariants enforced by validate() (PR C3 — fingerprint required):
//   1) TTL freshness — approval not older than ttlMs
//   2) fingerprint match — sentinel.fingerprint must equal current repo
//      fingerprint by both mode AND value. Sentinels without fingerprint
//      (pre-C1 shape) are rejected as "legacy shape — re-issue".
//   3) state_version freshness (optional) — when sentinel binds a slug+
//      revision, the current state.json's version must NOT have advanced
//      past sentinel.state_version.
//
// gitHeadSha() is still exported for callers (e.g. pre-deploy-gate's legacy
// .harness-sf/last-validation.json path) that have not yet migrated to the
// fingerprint API. New sentinel writes do not include head_sha.
//
// Public API:
//   - sentinelDir(kind)               → absolute dir for a sentinel kind
//   - sentinelPath(kind, key)         → absolute file path
//   - keyFromPath(absPath)            → stable sha1 key for a file path
//   - readSentinel(kind, key)         → parsed JSON or null
//   - writeSentinel(kind, key, extra) → writes JSON with both shapes
//       extra may include: slug, design_revision, design_body_hash to enable
//       state_version capture from .harness-sf/state/<slug>__r<rev>.json.
//   - validate(sentinel, ttlMs)       → { ok, reason }
//   - gitHeadSha()                    → 40-char SHA or null
//   - cwd()                           → process.cwd()

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// PR C1 — fingerprint abstraction. Optional require so tests / earlier
// callers without the state/ subtree don't break.
let fingerprintLib;
try { fingerprintLib = require('./state/fingerprint'); } catch { fingerprintLib = null; }
let stateStore;
try { stateStore = require('./state/store'); } catch { stateStore = null; }

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

  // PR C3 — fingerprint-only. head_sha removed from new sentinels.
  let fp = null;
  if (fingerprintLib) {
    try { fp = fingerprintLib.fingerprint(); } catch { fp = null; }
  }

  let stateVersion = null;
  if (stateStore && extra && extra.slug && extra.design_revision) {
    try {
      const cur = stateStore.readState(extra.slug, extra.design_revision);
      if (cur) stateVersion = cur.version;
    } catch { stateVersion = null; }
  }

  const data = {
    issued_at: new Date().toISOString(),
    ...(fp ? { fingerprint: fp } : {}),
    ...(stateVersion !== null ? { state_version: stateVersion } : {}),
    ...extra,
  };
  fs.writeFileSync(sentinelPath(kind, key), JSON.stringify(data, null, 2) + '\n');
  return data;
}

// validate(sentinel, ttlMs) → { ok: bool, reason: string }
// Order:
//   1. TTL freshness.
//   2. fingerprint match — when sentinel includes one. New shape wins over head_sha.
//   3. state_version monotonic — when sentinel.state_version + slug+rev present, the
//      current state.json's version must not have advanced past it.
//   4. head_sha match (legacy fallback) — only checked when sentinel lacks fingerprint.
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

  // PR C3 — fingerprint required. Sentinels without it are stale (pre-C1
  // shape) and must be re-issued.
  if (!sentinel.fingerprint) {
    return {
      ok: false,
      reason: 'sentinel missing fingerprint (legacy shape) — re-issue approval',
    };
  }
  if (!fingerprintLib) {
    return { ok: false, reason: 'fingerprint module unavailable' };
  }
  let cur = null;
  try { cur = fingerprintLib.fingerprint(); } catch { cur = null; }
  if (!cur) return { ok: false, reason: 'cannot compute current fingerprint' };
  if (!fingerprintLib.compare(cur, sentinel.fingerprint)) {
    return {
      ok: false,
      reason: `fingerprint mismatch (approved mode=${sentinel.fingerprint.mode} value=${String(sentinel.fingerprint.value).slice(0, 12)}…, now mode=${cur.mode} value=${String(cur.value).slice(0, 12)}…)`,
    };
  }

  if (
    sentinel.state_version !== undefined && sentinel.state_version !== null
    && sentinel.slug && sentinel.design_revision && stateStore
  ) {
    try {
      const cur = stateStore.readState(sentinel.slug, sentinel.design_revision);
      // Sentinel was issued against state.version = X. Allow current X (idempotent
      // re-validate) but reject if state has advanced (an action mutated state
      // since the sentinel was issued — the approval is stale).
      if (cur && typeof cur.version === 'number' && cur.version > sentinel.state_version) {
        return {
          ok: false,
          reason: `state advanced since approval (approved at version ${sentinel.state_version}, now ${cur.version})`,
        };
      }
    } catch { /* state read failure does not block validate — TTL+fingerprint already gated */ }
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
