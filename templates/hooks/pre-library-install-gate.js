#!/usr/bin/env node
// harness-sf PreToolUse hook for Bash.
// Gates library install commands (sf package install / git clone for vendoring /
// npm install / curl into staticresources). Each invocation must reference an
// identifier (04t package id, git URL, npm name, CDN URL) for which a fresh
// approval sentinel exists at .harness-sf/.cache/library-approvals/<hash>.json.
//
// Sentinels are issued by /sf-library-install via _lib/issue-library-approval.js
// AFTER the install plan has been shown and the user has explicitly approved.
//
// Escape hatch: HARNESS_SF_OVERRIDE='library:<reason>' (>= 8 non-whitespace chars)

'use strict';
const fs = require('fs');
const crypto = require('crypto');
const sentinel = require('./_lib/sentinel');
const { emitBlock } = require('./_lib/gate-output');

const TTL_MS = 30 * 60 * 1000;
const KIND = 'library-approvals';
const LIBRARY_OVERRIDE = "HARNESS_OVERRIDE=library with audit reason (≥8 chars; 1-hour session, 1 use)";

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function deny(block) {
  emitBlock(block);
  process.exit(2);
}

// Returns { method, identifier } or null if command isn't a library install.
function classify(cmd) {
  if (!cmd) return null;
  const c = cmd.trim();

  // A. sf package install -p 04t...
  let m = c.match(/\bsf\s+package\s+install\b[\s\S]*?-p\s+(04t[A-Za-z0-9]{12,15})/);
  if (m) return { method: 'package', identifier: m[1] };

  // sfdx force:package:install -p 04t...
  m = c.match(/\bsfdx\s+force:package:install\b[\s\S]*?-p\s+(04t[A-Za-z0-9]{12,15})/);
  if (m) return { method: 'package', identifier: m[1] };

  // B/C. git clone / git submodule add — only when destined for force-app/ or vendored/
  m = c.match(/\bgit\s+clone\s+(https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+?(?:\.git)?)\b([\s\S]*)/);
  if (m && /\b(force-app\/|vendored\/)/.test(m[2] || '')) {
    return { method: 'git-clone', identifier: m[1].replace(/\.git$/, '') };
  }
  m = c.match(/\bgit\s+submodule\s+add\s+(https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+?(?:\.git)?)\b([\s\S]*)/);
  if (m && /\b(force-app\/|vendored\/)/.test(m[2] || '')) {
    return { method: 'git-submodule', identifier: m[1].replace(/\.git$/, '') };
  }

  // D. npm install / npm i <name> (devDependency context — no flag distinction here, skill handles it)
  m = c.match(/\bnpm\s+(?:install|i)\s+(?!-)([@\w./\-]+)/);
  if (m) return { method: 'npm', identifier: m[1] };

  // E. curl (or wget) downloading into staticresources — CDN URL
  m = c.match(/\b(?:curl|wget)\b[\s\S]*?\b(https?:\/\/[^\s'"]+)[\s\S]*?\bforce-app\/[^\s'"]*staticresources\b/);
  if (m) return { method: 'staticresource', identifier: m[1] };

  return null;
}

function keyForIdentifier(method, identifier) {
  return crypto.createHash('sha1').update(`${method}|${identifier}`).digest('hex').slice(0, 16);
}

(function main() {
  try {
    const { decideBypass } = require('./_lib/override');
    if (decideBypass('library', 'pre-library-install-gate')) process.exit(0);
  } catch { /* fall through to normal gate */ }

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }

  if (payload.tool_name !== 'Bash') process.exit(0);
  const cmd = payload.tool_input && payload.tool_input.command;
  const hit = classify(cmd);
  if (!hit) process.exit(0);

  const key = keyForIdentifier(hit.method, hit.identifier);
  const sentinelPath = `.harness-sf/.cache/${KIND}/${key}.json`;
  const s = sentinel.readSentinel(KIND, key);
  if (!s) {
    deny({
      reason: `library install of ${hit.method}='${hit.identifier}' has no approval sentinel`,
      why: 'external code introduces supply-chain + security review obligations — every install must pass through /sf-library-install',
      fix: `run /sf-library-install (shows plan, gets approval, issues sentinel via issue-library-approval.js ${hit.method} '${hit.identifier}')`,
      file: sentinelPath,
      override: LIBRARY_OVERRIDE,
    });
  }

  const v = sentinel.validate(s, TTL_MS);
  if (!v.ok) {
    deny({
      reason: `library approval for ${hit.method}='${hit.identifier}' rejected (${v.reason})`,
      why: 'sentinel expired, tampered, or HEAD changed — library approvals are tree-bound',
      fix: 're-approve via /sf-library-install',
      file: sentinelPath,
      override: LIBRARY_OVERRIDE,
    });
  }

  if (s.method !== hit.method || s.identifier !== hit.identifier) {
    deny({
      reason: 'library sentinel mismatch',
      why: `sentinel encodes '${s.method}:${s.identifier}' but command requests '${hit.method}:${hit.identifier}'`,
      fix: 're-run /sf-library-install for the actual identifier',
      file: sentinelPath,
      override: LIBRARY_OVERRIDE,
    });
  }

  process.exit(0);
})();
