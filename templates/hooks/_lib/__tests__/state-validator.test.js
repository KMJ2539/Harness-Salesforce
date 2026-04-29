'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../state/validator');

function baseState(overrides = {}) {
  return {
    schema_version: 1,
    version: 1,
    slug: 'feat',
    design_path: '.harness-sf/designs/feat.md',
    design_revision: 1,
    design_body_hash: 'sha256:' + 'a'.repeat(64),
    lock: null,
    current_step: '1',
    entered_via: 'full',
    artifacts: [{ id: 'A1', type: 'apex', status: 'pending', completed_at: null, depends_on: [] }],
    deploy: { last_validation: null, findings: [] },
    loop: { iteration: 0, last_error_class: null },
    override_active_session: null,
    override_history: [],
    ...overrides,
  };
}

test('valid baseline state passes', () => {
  const r = validate(baseState());
  assert.equal(r.ok, true, r.errors && r.errors.join('; '));
});

test('missing schema_version fails', () => {
  const r = validate(baseState({ schema_version: 0 }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /schema_version must be 1/);
});

test('current_step accepts dotted notation', () => {
  assert.equal(validate(baseState({ current_step: '7.deploy-validate' })).ok, true);
  assert.equal(validate(baseState({ current_step: '5' })).ok, true);
});

test('current_step rejects integer', () => {
  const r = validate(baseState({ current_step: 5 }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /current_step must be string/);
});

test('entered_via must be enum', () => {
  assert.equal(validate(baseState({ entered_via: 'fast' })).ok, true);
  const r = validate(baseState({ entered_via: 'sf-feature-fast' }));
  assert.equal(r.ok, false);
});

test('artifact uses type, kind is forbidden', () => {
  const r = validate(baseState({
    artifacts: [{ id: 'A1', kind: 'apex', status: 'pending', completed_at: null, depends_on: [] }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /kind is forbidden/);
});

test('done status requires completed_at', () => {
  const r = validate(baseState({
    artifacts: [{ id: 'A1', type: 'apex', status: 'done', completed_at: null, depends_on: [] }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /completed_at required.*status=done/);
});

test('depends_on must reference existing id', () => {
  const r = validate(baseState({
    artifacts: [{ id: 'A1', type: 'apex', status: 'pending', completed_at: null, depends_on: ['nope'] }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /depends_on references unknown id/);
});

test('forbidden review_resolution at root', () => {
  const r = validate(baseState({ review_resolution: { H1: { decision: 1 } } }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /review_resolution must NOT exist/);
});

test('forbidden override_used field', () => {
  const r = validate(baseState({ override_used: true }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /override_used.*removed/);
});

test('loop iteration must be 0..4', () => {
  assert.equal(validate(baseState({ loop: { iteration: 4, last_error_class: null } })).ok, true);
  const r = validate(baseState({ loop: { iteration: 5, last_error_class: null } }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /loop\.iteration must be integer 0\.\.4/);
});

test('loop last_error_class enum', () => {
  assert.equal(validate(baseState({ loop: { iteration: 1, last_error_class: 'mechanical' } })).ok, true);
  assert.equal(validate(baseState({ loop: { iteration: 1, last_error_class: 'logical' } })).ok, true);
  const r = validate(baseState({ loop: { iteration: 1, last_error_class: 'whatever' } }));
  assert.equal(r.ok, false);
});

test('override_history reason min length', () => {
  const r = validate(baseState({
    override_history: [{ at: '2026-04-29T00:00:00Z', scope: 'deploy', reason: 'short', session_id: 'x' }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(';'), /reason must be string with >= 8/);
});
