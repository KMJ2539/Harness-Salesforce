#!/usr/bin/env node
// harness-sf PreToolUse hook for Bash. Gates `sf project deploy start ...` (and `sfdx force:source:deploy`).
// Requires that sf-deploy-validator wrote .harness-sf/last-validation.json
//   - within the last 30 minutes (TTL)
//   - with validation_result === 'Succeeded'
//   - against the current HEAD sha (no edits since validation)
// Otherwise denies the deploy and instructs the user to run /sf-deploy-validator first.

'use strict';
const fs = require('fs');
const path = require('path');
const sentinel = require('./_lib/sentinel');

// PR C2 — fingerprint-aware deploy gate. Reads new state.deploy.last_validation
// when present and validates via fingerprint. Falls back to legacy
// .harness-sf/last-validation.json with head_sha matching.
let fingerprintLib;
try { fingerprintLib = require('./_lib/state/fingerprint'); } catch { fingerprintLib = null; }

const TTL_MS = 30 * 60 * 1000;
const DEFAULT_COVERAGE_TARGET = 75;

function newestStateWithDeployValidation() {
  const dir = path.join(process.cwd(), '.harness-sf', 'state');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => /^[a-z0-9-]+__r\d+\.json$/.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const { f } of files) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (s && s.deploy && s.deploy.last_validation && s.deploy.last_validation.fingerprint) {
      return { state: s, file: f };
    }
  }
  return null;
}

function resolveCoverageTarget() {
  const envVal = process.env.HARNESS_SF_COVERAGE_TARGET;
  if (envVal && /^\d+(\.\d+)?$/.test(envVal)) return Number(envVal);
  try {
    const projectMd = path.join(process.cwd(), '.harness-sf', 'PROJECT.md');
    if (fs.existsSync(projectMd)) {
      const text = fs.readFileSync(projectMd, 'utf8');
      const m = text.match(/coverage_target_percent\s*[:=]\s*(\d+(?:\.\d+)?)/i);
      if (m) return Number(m[1]);
    }
  } catch { /* ignore */ }
  return DEFAULT_COVERAGE_TARGET;
}

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function deny(msg) {
  process.stderr.write(`[harness-sf] ${msg}\n`);
  process.exit(2);
}

function isDeployStart(cmd) {
  if (!cmd) return false;
  const c = cmd.trim();
  if (/\bsf\s+project\s+deploy\s+start\b/.test(c)) return true;
  if (/\bsfdx\s+force:source:deploy\b/.test(c)) return true;
  return false;
}

(function main() {
  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }

  if (payload.tool_name !== 'Bash') process.exit(0);
  const cmd = payload.tool_input && payload.tool_input.command;
  if (!isDeployStart(cmd)) process.exit(0);

  if (process.env.HARNESS_SF_SKIP_DEPLOY_GATE === '1') process.exit(0);

  // PR C2/C3 — prefer canonical state.deploy.last_validation (fingerprint).
  // Fall back to legacy .harness-sf/last-validation.json (head_sha) until
  // sf-deploy-validator agent ships fingerprint output.
  let val = null;
  let valSource = null;
  const newest = newestStateWithDeployValidation();
  if (newest) {
    const lv = newest.state.deploy.last_validation;
    val = {
      validation_result: lv.result === 'pass' ? 'Succeeded' : (lv.result || 'unknown'),
      validated_at: lv.at,
      coverage_overall: lv.coverage_overall,
      fingerprint: lv.fingerprint,
    };
    valSource = `state:${newest.file}`;
  } else {
    const valPath = path.join(process.cwd(), '.harness-sf', 'last-validation.json');
    if (!fs.existsSync(valPath)) {
      deny(`deploy gate: no canonical state.deploy.last_validation and no .harness-sf/last-validation.json found. Run /sf-deploy-validator first.`);
    }
    try { val = JSON.parse(fs.readFileSync(valPath, 'utf8')); }
    catch (e) { deny(`deploy gate: last-validation.json unreadable (${e.message}). Re-run /sf-deploy-validator.`); }
    valSource = 'legacy:last-validation.json';
  }

  if (val.validation_result !== 'Succeeded') {
    deny(`deploy gate: last validation_result='${val.validation_result || 'unknown'}' (${valSource}). Fix issues and re-run /sf-deploy-validator.`);
  }

  // TTL freshness — common to both paths.
  const issuedAt = val.validated_at ? new Date(val.validated_at).getTime() : NaN;
  if (!Number.isFinite(issuedAt)) deny(`deploy gate: malformed validated_at (${valSource}).`);
  const ageMs = Date.now() - issuedAt;
  if (ageMs > TTL_MS) {
    const min = Math.floor(ageMs / 60000);
    const ttlMin = Math.floor(TTL_MS / 60000);
    deny(`deploy gate: validation is ${min}m old (>${ttlMin}m TTL) (${valSource}). Re-run /sf-deploy-validator.`);
  }

  // Integrity check — fingerprint (new) or head_sha (legacy).
  if (val.fingerprint) {
    if (!fingerprintLib) deny(`deploy gate: fingerprint module unavailable.`);
    let cur = null;
    try { cur = fingerprintLib.fingerprint(); } catch { cur = null; }
    if (!cur) deny(`deploy gate: cannot compute current fingerprint.`);
    if (!fingerprintLib.compare(cur, val.fingerprint)) {
      deny(`deploy gate: fingerprint mismatch (approved mode=${val.fingerprint.mode} value=${String(val.fingerprint.value).slice(0, 12)}…, now mode=${cur.mode} value=${String(cur.value).slice(0, 12)}…) (${valSource}). Re-run /sf-deploy-validator.`);
    }
  } else if (val.head_sha) {
    // Legacy path. Inline head_sha check (sentinel.validate now requires fingerprint).
    const head = sentinel.gitHeadSha();
    if (head && val.head_sha !== head) {
      deny(`deploy gate: HEAD moved since validation (approved ${String(val.head_sha).slice(0, 7)}, now ${head.slice(0, 7)}) (${valSource}). Re-run /sf-deploy-validator.`);
    }
  }

  const target = resolveCoverageTarget();
  const cov = val.coverage_overall;
  if (cov === undefined || cov === null) {
    deny(`deploy gate: coverage_overall missing in last-validation.json. sf-deploy-validator must record it. Re-run validator.`);
  }
  if (typeof cov !== 'number' || Number.isNaN(cov)) {
    deny(`deploy gate: coverage_overall is not a number ('${cov}'). Re-run /sf-deploy-validator.`);
  }
  if (cov < target) {
    deny(`deploy gate: coverage ${cov}% < target ${target}%. Add tests or override via HARNESS_SF_COVERAGE_TARGET (project-wide override: PROJECT.md 'coverage_target_percent: NN').`);
  }

  process.exit(0);
})();
