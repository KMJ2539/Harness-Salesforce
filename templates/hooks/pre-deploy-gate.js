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

const TTL_MS = 30 * 60 * 1000;
const DEFAULT_COVERAGE_TARGET = 75;

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

  const valPath = path.join(process.cwd(), '.harness-sf', 'last-validation.json');
  if (!fs.existsSync(valPath)) {
    deny(`deploy gate: no .harness-sf/last-validation.json found. Run /sf-deploy-validator first.`);
  }

  let val;
  try { val = JSON.parse(fs.readFileSync(valPath, 'utf8')); }
  catch (e) { deny(`deploy gate: last-validation.json unreadable (${e.message}). Re-run /sf-deploy-validator.`); }

  if (val.validation_result !== 'Succeeded') {
    deny(`deploy gate: last validation_result='${val.validation_result || 'unknown'}'. Fix issues and re-run /sf-deploy-validator.`);
  }

  // validated_at is the deploy-gate field name; map to the shared sentinel shape.
  const shaped = { issued_at: val.validated_at, head_sha: val.head_sha };
  const v = sentinel.validate(shaped, TTL_MS);
  if (!v.ok) {
    deny(`deploy gate: ${v.reason}. Re-run /sf-deploy-validator.`);
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
