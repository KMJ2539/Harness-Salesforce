'use strict';
// Centralized override parser + audit logger — gate-hardening v3 (PR E final).
//
// Single env var: HARNESS_SF_OVERRIDE='<scope>:<reason>'
//   scope ∈ { create, modify, design, deploy, library, all }
//   reason: free text, >= 8 non-whitespace chars
//
// Legacy HARNESS_SF_SKIP_* vars are detected and rejected with a clear error
// pointing to the new syntax. They no longer bypass any gate.
//
// API:
//   isActive(scope) → boolean — true iff a valid override targets this scope.
//   logIfActive(scope, gate) → void — appends to .harness-sf/audit.log on first
//     check per process. Idempotent within process.

const audit = require('./audit');

const VALID_SCOPES = new Set(['create', 'modify', 'design', 'deploy', 'library', 'all']);
const ONE_TIME_TTL_MS = 60 * 60 * 1000; // session boundary heuristic — 1 hour

const REMOVED_LEGACY_VARS = [
  'HARNESS_SF_SKIP_CREATE_GATE',
  'HARNESS_SF_SKIP_MODIFY_GATE',
  'HARNESS_SF_SKIP_DEPLOY_GATE',
  'HARNESS_SF_SKIP_LIBRARY_GATE',
  'HARNESS_SF_SKIP_RESOLUTION_GATE',
  'HARNESS_SF_SKIP_FEATURE_GATE',
];

const _logged = new Set();
let _legacyWarned = false;

function warnLegacyIfPresent() {
  if (_legacyWarned) return;
  for (const env of REMOVED_LEGACY_VARS) {
    if (process.env[env] === '1') {
      process.stderr.write(
        `[harness-sf] ${env}=1 is REMOVED. Use HARNESS_SF_OVERRIDE='<scope>:<reason>' ` +
        `where scope ∈ {${[...VALID_SCOPES].join(',')}} and reason has >= 8 non-whitespace chars.\n`
      );
      _legacyWarned = true;
      return;
    }
  }
}

function parseOverride() {
  const raw = process.env.HARNESS_SF_OVERRIDE;
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return { error: "HARNESS_SF_OVERRIDE missing prefix; expected '<scope>:<reason>' where scope is one of " + [...VALID_SCOPES].join('|') };
  const scope = raw.slice(0, idx).trim().toLowerCase();
  const reason = raw.slice(idx + 1).trim();
  if (!VALID_SCOPES.has(scope)) {
    return { error: `unknown override scope '${scope}'. Valid: ${[...VALID_SCOPES].join('|')}` };
  }
  if (reason.replace(/\s/g, '').length < 8) {
    return { error: 'override reason must have >= 8 non-whitespace chars' };
  }
  return { scope, reason };
}

// 1-time enforcement (codex H2): one override per ONE_TIME_TTL_MS window.
// Pessimistic on shared machines (any audit entry counts); correct for the
// single-user / per-session-shell common case.
function priorOverrideExists(excludeSelfSha) {
  let recent;
  try { recent = audit.tail(50); }
  catch { return false; }
  const now = Date.now();
  for (const e of recent) {
    if (excludeSelfSha && e.sha === excludeSelfSha) continue;
    const t = new Date(e.ts).getTime();
    if (Number.isFinite(t) && now - t < ONE_TIME_TTL_MS) return true;
  }
  return false;
}

let _exhaustedWarned = false;
function isActive(targetScope) {
  warnLegacyIfPresent();
  const ovr = parseOverride();
  if (!ovr || ovr.error) return false;
  if (ovr.scope !== 'all' && ovr.scope !== targetScope) return false;
  return true;
}

// Returns null if no override active. Returns { scope, reason } describing what's in effect.
function describe() {
  const ovr = parseOverride();
  if (ovr && !ovr.error) return { scope: ovr.scope, reason: ovr.reason };
  return null;
}

// decideBypass — single atomic call gates should use. Replaces the
// logIfActive + isActive pair to avoid the self-reference race where
// logIfActive's own audit append makes isActive's prior-use check trip.
//
// Returns true if the gate should bypass (override is valid + 1-time check
// passes). Logs to audit only on the first granted bypass per process.
function decideBypass(targetScope, gate, opts = {}) {
  if (!isActive(targetScope)) return false;

  const desc = describe();
  if (!desc) return false;

  const processKey = `${gate}|${desc.scope}`;
  if (_logged.has(processKey)) return true; // already decided + logged this process

  if (priorOverrideExists()) {
    if (!_exhaustedWarned) {
      _exhaustedWarned = true;
      process.stderr.write(
        `[harness-sf] HARNESS_SF_OVERRIDE already used within ${Math.floor(ONE_TIME_TTL_MS / 60000)}m. ` +
        `1-time enforcement: only one override allowed per session window. ` +
        `Restart the session (or wait for window to expire) to reset.\n`
      );
    }
    return false;
  }

  _logged.add(processKey);
  try {
    audit.append({
      gate,
      slug: opts.slug || '',
      scope: desc.scope,
      reason: desc.reason,
      session_id: process.env.CLAUDE_SESSION_ID || '',
    });
  } catch (e) {
    process.stderr.write(`[harness-sf] override audit failed: ${e.message}\n`);
    return false;
  }
  return true;
}

// Back-compat shim — same surface as before, but now the act of logging is
// atomic with the bypass decision via decideBypass. Existing callers that
// only use logIfActive (without checking isActive afterward) still work.
function logIfActive(targetScope, gate, opts = {}) {
  return decideBypass(targetScope, gate, opts) ? { logged: true } : null;
}

module.exports = { isActive, describe, decideBypass, logIfActive, VALID_SCOPES };
