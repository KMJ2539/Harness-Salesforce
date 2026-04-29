'use strict';
// state.json schema validator — zero-dep, ~120 lines.
// Per .harness-sf/designs/2026-04-29-state-schema.md (schema_version: 1).
//
// validate(stateObj) → { ok: true } | { ok: false, errors: [string, ...] }

const ARTIFACT_TYPES = new Set([
  'sobject', 'field', 'apex', 'lwc', 'aura', 'permission-set', 'flow',
]);
const ARTIFACT_STATUSES = new Set([
  'pending', 'in_progress', 'done', 'skipped', 'failed',
]);
const ENTERED_VIA = new Set(['fast', 'standard', 'full', 'direct']);
const FINGERPRINT_MODES = new Set(['git', 'tree-hash', 'timestamp']);
const ERROR_CLASSES = new Set(['mechanical', 'logical']);
const STEP_RE = /^\d+(\.[a-z-]+)?$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isString(v) { return typeof v === 'string'; }
function isInt(v) { return Number.isInteger(v); }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isArray(v) { return Array.isArray(v); }

function validate(s) {
  const errs = [];
  if (!isObject(s)) return { ok: false, errors: ['state must be an object'] };

  if (s.schema_version !== 1) errs.push(`schema_version must be 1, got ${JSON.stringify(s.schema_version)}`);
  if (!isInt(s.version) || s.version < 1) errs.push('version must be integer >= 1');
  if (!isString(s.slug) || !SLUG_RE.test(s.slug)) errs.push('slug must match ^[a-z0-9-]+$');
  if (!isString(s.design_path)) errs.push('design_path must be string');
  if (!isInt(s.design_revision) || s.design_revision < 1) errs.push('design_revision must be integer >= 1');
  if (!isString(s.design_body_hash) || !HASH_RE.test(s.design_body_hash)) errs.push('design_body_hash must match sha256:[0-9a-f]{64}');

  if (s.lock !== null && !validateLock(s.lock, errs)) { /* errors pushed inside */ }

  if (!isString(s.current_step) || !STEP_RE.test(s.current_step)) {
    errs.push(`current_step must be string matching ${STEP_RE} (e.g. "5" or "7.deploy-validate")`);
  }
  if (!isString(s.entered_via) || !ENTERED_VIA.has(s.entered_via)) {
    errs.push(`entered_via must be one of: ${[...ENTERED_VIA].join(', ')}`);
  }

  if (!isArray(s.artifacts)) errs.push('artifacts must be array');
  else {
    const ids = new Set();
    for (let i = 0; i < s.artifacts.length; i++) {
      validateArtifact(s.artifacts[i], i, ids, errs);
    }
    for (const a of s.artifacts) {
      if (!a || !isArray(a.depends_on)) continue;
      for (const d of a.depends_on) {
        if (!ids.has(d)) errs.push(`artifacts[${a.id}].depends_on references unknown id '${d}'`);
      }
    }
  }

  validateDeploy(s.deploy, errs);
  validateLoop(s.loop, errs);

  if (s.override_active_session !== null && !isString(s.override_active_session)) {
    errs.push('override_active_session must be string or null');
  }
  if (!isArray(s.override_history)) errs.push('override_history must be array');
  else s.override_history.forEach((o, i) => validateOverrideEntry(o, i, errs));

  // Forbidden fields (codex 3차 review resolution).
  if ('review_resolution' in s) errs.push('review_resolution must NOT exist in state.json — design.md is single source');
  if ('override_used' in s) errs.push('override_used field is removed — use override_active_session !== null');
  if (s.deploy && s.deploy.approved_at) errs.push('deploy.approved_at is removed — sentinel holds approval state');

  return errs.length ? { ok: false, errors: errs } : { ok: true };
}

function validateLock(l, errs) {
  if (!isObject(l)) { errs.push('lock must be object or null'); return false; }
  if (!isInt(l.pid)) errs.push('lock.pid must be integer');
  if (!isString(l.host)) errs.push('lock.host must be string');
  if (!isString(l.started_at) || !ISO_RE.test(l.started_at)) errs.push('lock.started_at must be ISO-8601');
  if (!isString(l.operation)) errs.push('lock.operation must be string');
  return true;
}

function validateArtifact(a, idx, idsAccum, errs) {
  const tag = `artifacts[${idx}]`;
  if (!isObject(a)) { errs.push(`${tag} must be object`); return; }
  if (!isString(a.id) || !ID_RE.test(a.id)) errs.push(`${tag}.id must match ${ID_RE}`);
  else {
    if (idsAccum.has(a.id)) errs.push(`${tag}.id duplicate: ${a.id}`);
    idsAccum.add(a.id);
  }
  if (!ARTIFACT_TYPES.has(a.type)) errs.push(`${tag}.type must be one of: ${[...ARTIFACT_TYPES].join(', ')}`);
  if (!ARTIFACT_STATUSES.has(a.status)) errs.push(`${tag}.status must be one of: ${[...ARTIFACT_STATUSES].join(', ')}`);
  if (a.status === 'done') {
    if (!isString(a.completed_at) || !ISO_RE.test(a.completed_at)) errs.push(`${tag}.completed_at required (ISO-8601) when status=done`);
  }
  if (a.depends_on !== undefined && !isArray(a.depends_on)) errs.push(`${tag}.depends_on must be array if present`);
  if ('kind' in a) errs.push(`${tag}.kind is forbidden — use 'type'`);
}

function validateDeploy(d, errs) {
  if (d === undefined) return;
  if (!isObject(d)) { errs.push('deploy must be object'); return; }
  if (d.last_validation !== null && d.last_validation !== undefined) {
    const lv = d.last_validation;
    if (!isObject(lv)) errs.push('deploy.last_validation must be object or null');
    else {
      if (!isObject(lv.fingerprint)) errs.push('deploy.last_validation.fingerprint must be object');
      else {
        if (!FINGERPRINT_MODES.has(lv.fingerprint.mode)) errs.push(`deploy.last_validation.fingerprint.mode must be one of: ${[...FINGERPRINT_MODES].join(', ')}`);
        if (!isString(lv.fingerprint.value)) errs.push('deploy.last_validation.fingerprint.value must be string');
      }
      if (!['pass', 'fail'].includes(lv.result)) errs.push("deploy.last_validation.result must be 'pass' or 'fail'");
      if (!isString(lv.at) || !ISO_RE.test(lv.at)) errs.push('deploy.last_validation.at must be ISO-8601');
    }
  }
  if (d.findings !== undefined && !isArray(d.findings)) errs.push('deploy.findings must be array');
}

function validateLoop(l, errs) {
  if (l === undefined) return;
  if (!isObject(l)) { errs.push('loop must be object'); return; }
  if (!isInt(l.iteration) || l.iteration < 0 || l.iteration > 4) errs.push('loop.iteration must be integer 0..4');
  if (l.last_error_class !== null && !ERROR_CLASSES.has(l.last_error_class)) {
    errs.push(`loop.last_error_class must be null or one of: ${[...ERROR_CLASSES].join(', ')}`);
  }
}

function validateOverrideEntry(o, idx, errs) {
  const tag = `override_history[${idx}]`;
  if (!isObject(o)) { errs.push(`${tag} must be object`); return; }
  if (!isString(o.at) || !ISO_RE.test(o.at)) errs.push(`${tag}.at must be ISO-8601`);
  if (!isString(o.scope)) errs.push(`${tag}.scope must be string`);
  if (!isString(o.reason) || o.reason.replace(/\s/g, '').length < 8) errs.push(`${tag}.reason must be string with >= 8 non-whitespace chars`);
  if (!isString(o.session_id)) errs.push(`${tag}.session_id must be string`);
}

module.exports = { validate };
