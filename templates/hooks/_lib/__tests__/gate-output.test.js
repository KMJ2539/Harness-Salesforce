'use strict';
// P2 — gate-output formatBlock unit tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatBlock } = require('../gate-output');

const valid = {
  reason: 'deploy fingerprint missing or expired',
  why: 'pre-deploy-gate requires a fresh fingerprint within TTL',
  fix: 'run /sf-deploy-validator and retry',
  file: '.harness-sf/last-validation.json',
  override: 'HARNESS_OVERRIDE=deploy with audit reason',
};

test('formatBlock emits all 5 fields in order', () => {
  const out = formatBlock(valid);
  const lines = out.split('\n');
  assert.match(lines[0], /^Blocked: /);
  assert.match(lines[1], /^Why:\s+/);
  assert.match(lines[2], /^Fix:\s+/);
  assert.match(lines[3], /^File:\s+/);
  assert.match(lines[4], /^Override: /);
});

test('formatBlock ends with a single trailing newline', () => {
  const out = formatBlock(valid);
  assert.equal(out.endsWith('\n'), true);
  assert.equal(out.endsWith('\n\n'), false);
});

test('formatBlock indents multi-line fix under "Fix:"', () => {
  const out = formatBlock({ ...valid, fix: 'first line\nsecond line' });
  assert.match(out, /^Fix:\s+first line$/m);
  assert.match(out, /^         second line$/m);
});

test('formatBlock rejects missing fields', () => {
  for (const k of ['reason', 'why', 'fix', 'file', 'override']) {
    const bad = { ...valid };
    delete bad[k];
    assert.throws(() => formatBlock(bad), new RegExp(`'${k}' is required`));
  }
});

test('formatBlock rejects empty/whitespace-only fields', () => {
  assert.throws(() => formatBlock({ ...valid, reason: '' }), /'reason' is required/);
  assert.throws(() => formatBlock({ ...valid, override: '   ' }), /'override' is required/);
});

test('formatBlock rejects non-string fields', () => {
  assert.throws(() => formatBlock({ ...valid, reason: 42 }), /'reason' is required/);
  assert.throws(() => formatBlock(null), /fields object is required/);
});
