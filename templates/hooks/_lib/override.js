'use strict';
// Centralized override parser + audit logger — gate-hardening v3.
//
// Single env var: HARNESS_SF_OVERRIDE='<scope>:<reason>'
//   scope ∈ { create, modify, design, deploy, library, all }
//   reason: free text, >= 8 non-whitespace chars
//
// Legacy SKIP_* vars are still honored with a deprecation warning so users
// don't get blocked, but every override use (legacy or new) writes an audit
// line. Removal of legacy vars is the SKIP_* deprecation step.
//
// API:
//   isActive(scope) → boolean — true iff a valid override targets this scope.
//   logIfActive(scope, gate) → void — appends to .harness-sf/audit.log on first
//     check per process. Idempotent within process.

const audit = require('./audit');

const VALID_SCOPES = new Set(['create', 'modify', 'design', 'deploy', 'library', 'all']);

const LEGACY_SKIP_TO_SCOPE = {
  HARNESS_SF_SKIP_CREATE_GATE: 'create',
  HARNESS_SF_SKIP_MODIFY_GATE: 'modify',
  HARNESS_SF_SKIP_DEPLOY_GATE: 'deploy',
  HARNESS_SF_SKIP_LIBRARY_GATE: 'library',
  HARNESS_SF_SKIP_RESOLUTION_GATE: 'design',
  HARNESS_SF_SKIP_FEATURE_GATE: 'all',
};

const _logged = new Set();

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

function legacySkipActive() {
  for (const [env, scope] of Object.entries(LEGACY_SKIP_TO_SCOPE)) {
    if (process.env[env] === '1') return { env, scope };
  }
  return null;
}

function isActive(targetScope) {
  const ovr = parseOverride();
  if (ovr && !ovr.error) {
    return ovr.scope === 'all' || ovr.scope === targetScope;
  }
  const legacy = legacySkipActive();
  if (legacy) return legacy.scope === 'all' || legacy.scope === targetScope;
  return false;
}

// Returns null if no override active. Returns { source, scope, reason, error? }
// describing what's in effect.
function describe() {
  const ovr = parseOverride();
  if (ovr) {
    if (ovr.error) return { source: 'env-malformed', error: ovr.error };
    return { source: 'HARNESS_SF_OVERRIDE', scope: ovr.scope, reason: ovr.reason };
  }
  const legacy = legacySkipActive();
  if (legacy) {
    return {
      source: legacy.env,
      scope: legacy.scope,
      reason: `legacy skip flag (${legacy.env}=1) — migrate to HARNESS_SF_OVERRIDE='${legacy.scope}:<reason>' (>=8 chars)`,
      deprecated: true,
    };
  }
  return null;
}

// Logs once per process per (gate, scope). Returns the entry written, or null if no override.
function logIfActive(targetScope, gate, opts = {}) {
  if (!isActive(targetScope)) return null;
  const desc = describe();
  if (!desc || desc.error) return null;
  const key = `${gate}|${desc.scope}`;
  if (_logged.has(key)) return null;
  _logged.add(key);
  try {
    const entry = audit.append({
      gate,
      slug: opts.slug || '',
      scope: desc.scope,
      reason: desc.reason,
      session_id: process.env.CLAUDE_SESSION_ID || '',
    });
    if (desc.deprecated) {
      process.stderr.write(`[harness-sf] override: ${desc.source} is deprecated. ${desc.reason}\n`);
    }
    return entry;
  } catch (e) {
    // audit.append rejected (e.g. reason too short for legacy synthesized message).
    process.stderr.write(`[harness-sf] override audit failed: ${e.message}\n`);
    return null;
  }
}

module.exports = { isActive, describe, logIfActive, VALID_SCOPES };
