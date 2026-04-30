'use strict';
// P1 — state-summary phase logic + approval TTL.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-summary-'));
  const oldCwd = process.cwd();
  process.chdir(dir);
  delete require.cache[require.resolve('../state-summary')];
  try { fn(require('../state-summary'), dir); }
  finally {
    process.chdir(oldCwd);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
    catch { /* ignore */ }
  }
}

function writeDesign(cwd, slug, body) {
  const dir = path.join(cwd, '.harness-sf', 'designs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), body || '---\ntype: feature\n---\n');
}

function writeState(cwd, slug, rev, artifacts) {
  const dir = path.join(cwd, '.harness-sf', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}__r${rev}.json`),
    JSON.stringify({ schema_version: 1, version: 1, slug, artifacts })
  );
}

function writeSentinel(cwd, kind, key, issuedAtMs) {
  const dir = path.join(cwd, '.harness-sf', '.cache', kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${key}.json`),
    JSON.stringify({ issued_at: new Date(issuedAtMs).toISOString() })
  );
}

function writeLastValidation(cwd, agedMs) {
  fs.writeFileSync(
    path.join(cwd, '.harness-sf', 'last-validation.json'),
    JSON.stringify({ validated_at: new Date(Date.now() - agedMs).toISOString() })
  );
}

test('phase=idle when no design.md', () => {
  withTmpCwd((mod) => {
    const s = mod.summarize();
    assert.equal(s.phase, 'idle');
    assert.equal(s.hasDesign, false);
  });
});

test('phase=plan when design.md but no state.json', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    const s = mod.summarize();
    assert.equal(s.phase, 'plan');
    assert.equal(s.designSlug, 'orders');
    assert.equal(s.total, 0);
  });
});

test('phase=build when state.json has incomplete artifact', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [
      { id: 'a1', type: 'sobject', status: 'done' },
      { id: 'a2', type: 'apex', status: 'in_progress' },
      { id: 'a3', type: 'lwc', status: 'pending' },
    ]);
    const s = mod.summarize();
    assert.equal(s.phase, 'build');
    assert.equal(s.current, 'a2');
    assert.equal(s.total, 3);
    assert.equal(s.done, 1);
    assert.equal(s.failed, 0);
  });
});

test('phase=validate when all done but no last-validation', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [
      { id: 'a1', type: 'sobject', status: 'done' },
      { id: 'a2', type: 'apex', status: 'done' },
    ]);
    const s = mod.summarize();
    assert.equal(s.phase, 'validate');
    assert.equal(s.current, null);
  });
});

test('phase=done when all done AND last-validation exists', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [{ id: 'a1', type: 'sobject', status: 'done' }]);
    writeLastValidation(cwd, 5 * 60 * 1000);
    const s = mod.summarize();
    assert.equal(s.phase, 'done');
    assert.ok(s.lastValidationAgeMs >= 5 * 60 * 1000 - 100);
  });
});

test('failed artifact is counted', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [
      { id: 'a1', type: 'sobject', status: 'done' },
      { id: 'a2', type: 'apex', status: 'failed' },
      { id: 'a3', type: 'lwc', status: 'pending' },
    ]);
    const s = mod.summarize();
    assert.equal(s.failed, 1);
    assert.equal(s.phase, 'build');
  });
});

test('skipped artifact does not block validate phase', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [
      { id: 'a1', type: 'sobject', status: 'done' },
      { id: 'a2', type: 'apex', status: 'skipped' },
    ]);
    const s = mod.summarize();
    assert.equal(s.phase, 'validate');
  });
});

test('approval TTL: closest-to-expiry sentinel wins', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    const now = Date.now();
    // design-approvals TTL=2h. Issued 110m ago → 10m remaining.
    writeSentinel(cwd, 'design-approvals', 'aaa', now - 110 * 60 * 1000);
    // modify-approvals TTL=30m. Issued 5m ago → 25m remaining.
    writeSentinel(cwd, 'modify-approvals', 'bbb', now - 5 * 60 * 1000);
    const s = mod.summarize();
    assert.equal(s.approvalKind, 'design-approvals');
    assert.ok(s.approvalTtlMs <= 10 * 60 * 1000);
    assert.ok(s.approvalTtlMs > 9 * 60 * 1000);
  });
});

test('approval TTL: expired sentinel returns negative remainingMs', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    // modify TTL=30m. Issued 60m ago → -30m.
    writeSentinel(cwd, 'modify-approvals', 'k1', Date.now() - 60 * 60 * 1000);
    const s = mod.summarize();
    assert.ok(s.approvalTtlMs < 0);
    assert.equal(s.approvalKind, 'modify-approvals');
  });
});

test('approval TTL is null when no sentinels exist', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    const s = mod.summarize();
    assert.equal(s.approvalTtlMs, null);
    assert.equal(s.approvalKind, null);
  });
});

test('latest revision wins when multiple state files exist', () => {
  withTmpCwd((mod, cwd) => {
    writeDesign(cwd, 'orders');
    writeState(cwd, 'orders', 1, [{ id: 'a1', type: 'sobject', status: 'pending' }]);
    writeState(cwd, 'orders', 2, [{ id: 'a1', type: 'sobject', status: 'done' }]);
    const s = mod.summarize();
    assert.equal(s.phase, 'validate', 'r2 done overrides r1 pending');
  });
});
