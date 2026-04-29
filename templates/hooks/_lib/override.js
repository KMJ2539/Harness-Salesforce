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

function isActive(targetScope) {
  warnLegacyIfPresent();
  const ovr = parseOverride();
  if (ovr && !ovr.error) {
    return ovr.scope === 'all' || ovr.scope === targetScope;
  }
  return false;
}

// Returns null if no override active. Returns { scope, reason } describing what's in effect.
function describe() {
  const ovr = parseOverride();
  if (ovr && !ovr.error) return { scope: ovr.scope, reason: ovr.reason };
  return null;
}

// Logs once per process per (gate, scope). Returns the entry written, or null if no override.
function logIfActive(targetScope, gate, opts = {}) {
  if (!isActive(targetScope)) return null;
  const desc = describe();
  if (!desc) return null;
  const key = `${gate}|${desc.scope}`;
  if (_logged.has(key)) return null;
  _logged.add(key);
  try {
    return audit.append({
      gate,
      slug: opts.slug || '',
      scope: desc.scope,
      reason: desc.reason,
      session_id: process.env.CLAUDE_SESSION_ID || '',
    });
  } catch (e) {
    process.stderr.write(`[harness-sf] override audit failed: ${e.message}\n`);
    return null;
  }
}

module.exports = { isActive, describe, logIfActive, VALID_SCOPES };
