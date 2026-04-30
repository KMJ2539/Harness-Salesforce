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
const { emitBlock } = require('./_lib/gate-output');

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

function deny(block) {
  emitBlock(block);
  process.exit(2);
}

const DEPLOY_OVERRIDE = 'HARNESS_OVERRIDE=deploy with audit reason (1-hour session, 1 use)';

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

  // PR D/E + 1-time enforcement. Atomic decideBypass: logs and bypasses iff
  // override valid AND not already used within the 1-hour session window.
  try {
    const { decideBypass } = require('./_lib/override');
    if (decideBypass('deploy', 'pre-deploy-gate')) process.exit(0);
  } catch { /* fall through to normal gate */ }

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
      deny({
        reason: 'deploy validation evidence missing',
        why: 'pre-deploy-gate requires a fresh validate-only run; neither canonical state.deploy.last_validation nor legacy last-validation.json exists',
        fix: 'run /sf-deploy-validator (validate-only) and retry the deploy',
        file: '.harness-sf/last-validation.json (or .harness-sf/state/<slug>__r<rev>.json:deploy.last_validation)',
        override: DEPLOY_OVERRIDE,
      });
    }
    try { val = JSON.parse(fs.readFileSync(valPath, 'utf8')); }
    catch (e) {
      deny({
        reason: 'last-validation.json is unreadable',
        why: `JSON parse failed: ${e.message}`,
        fix: 're-run /sf-deploy-validator to regenerate the file',
        file: valPath,
        override: DEPLOY_OVERRIDE,
      });
    }
    valSource = 'legacy:last-validation.json';
  }

  if (val.validation_result !== 'Succeeded') {
    deny({
      reason: `last validation did not succeed (result='${val.validation_result || 'unknown'}')`,
      why: `pre-deploy-gate only allows deploy when validate-only succeeded (source: ${valSource})`,
      fix: 'fix the underlying validation errors and re-run /sf-deploy-validator',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }

  // TTL freshness — common to both paths.
  const issuedAt = val.validated_at ? new Date(val.validated_at).getTime() : NaN;
  if (!Number.isFinite(issuedAt)) {
    deny({
      reason: 'validated_at timestamp is malformed',
      why: `cannot compute TTL freshness (source: ${valSource})`,
      fix: 're-run /sf-deploy-validator to write a fresh ISO-8601 validated_at',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }
  const ageMs = Date.now() - issuedAt;
  if (ageMs > TTL_MS) {
    const min = Math.floor(ageMs / 60000);
    const ttlMin = Math.floor(TTL_MS / 60000);
    deny({
      reason: `validation expired (${min}m old > ${ttlMin}m TTL)`,
      why: `validate-only freshness window enforces "no edits since validation" (source: ${valSource})`,
      fix: 're-run /sf-deploy-validator to refresh the fingerprint and TTL',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }

  // Integrity check — fingerprint required (head_sha legacy retired now that
  // sf-deploy-validator agent emits fingerprint).
  if (!val.fingerprint) {
    deny({
      reason: "validation record missing 'fingerprint' field",
      why: 'fingerprint binds validation to a specific source-tree state — old validator output is no longer accepted',
      fix: 're-run /sf-deploy-validator on the latest agent (which emits fingerprint)',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }
  if (!fingerprintLib) {
    deny({
      reason: 'fingerprint module unavailable',
      why: 'templates/hooks/_lib/state/fingerprint not loadable — installation likely incomplete',
      fix: 're-run `npx harness-sf init` to refresh the hook library',
      file: '.claude/hooks/_lib/state/fingerprint.js',
      override: 'N/A — fix the underlying issue',
    });
  }
  let cur = null;
  try { cur = fingerprintLib.fingerprint(); } catch { cur = null; }
  if (!cur) {
    deny({
      reason: 'cannot compute current source-tree fingerprint',
      why: 'fingerprint() threw or returned null — probable git/index issue in the working tree',
      fix: 'check `git status`/`git rev-parse HEAD`; resolve any repo-state corruption then retry',
      file: process.cwd(),
      override: 'N/A — fix the underlying issue',
    });
  }
  if (!fingerprintLib.compare(cur, val.fingerprint)) {
    deny({
      reason: 'source tree changed since validation (fingerprint mismatch)',
      why: `approved mode=${val.fingerprint.mode} value=${String(val.fingerprint.value).slice(0, 12)}…; now mode=${cur.mode} value=${String(cur.value).slice(0, 12)}… (source: ${valSource})`,
      fix: 're-run /sf-deploy-validator on the current tree state',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }

  const target = resolveCoverageTarget();
  const cov = val.coverage_overall;
  if (cov === undefined || cov === null) {
    deny({
      reason: 'coverage_overall missing in validation record',
      why: 'sf-deploy-validator must record overall coverage so the gate can enforce the target',
      fix: 're-run /sf-deploy-validator (latest agent records coverage_overall)',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }
  if (typeof cov !== 'number' || Number.isNaN(cov)) {
    deny({
      reason: `coverage_overall is not a number ('${cov}')`,
      why: 'coverage threshold check requires a numeric value',
      fix: 're-run /sf-deploy-validator to write a numeric coverage_overall',
      file: valSource.startsWith('state:') ? `.harness-sf/state/${valSource.slice(6)}` : '.harness-sf/last-validation.json',
      override: DEPLOY_OVERRIDE,
    });
  }
  if (cov < target) {
    deny({
      reason: `coverage ${cov}% below target ${target}%`,
      why: 'project coverage policy (PROJECT.md `coverage_target_percent` or default 75) blocks under-covered deploys',
      fix: 'add tests until coverage ≥ target, or temporarily lower the target via PROJECT.md `coverage_target_percent: NN`',
      file: '.harness-sf/PROJECT.md',
      override: 'HARNESS_SF_COVERAGE_TARGET=NN (per-invocation), or DEPLOY_OVERRIDE for one-shot deploy',
    });
  }

  process.exit(0);
})();
