'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-store-'));
  const oldCwd = process.cwd();
  process.chdir(dir);
  delete require.cache[require.resolve('../state/store')];
  try { fn(require('../state/store')); }
  finally {
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeValid(slug = 'feat', rev = 1) {
  return {
    schema_version: 1,
    version: 1,
    slug,
    design_path: '.harness-sf/designs/feat.md',
    design_revision: rev,
    design_body_hash: 'sha256:' + 'b'.repeat(64),
    lock: null,
    current_step: '1',
    entered_via: 'full',
    artifacts: [{ id: 'A1', type: 'apex', status: 'pending', completed_at: null, depends_on: [] }],
    deploy: { last_validation: null, findings: [] },
    loop: { iteration: 0, last_error_class: null },
    override_active_session: null,
    override_history: [],
  };
}

test('writeState then readState roundtrip', () => {
  withTmpCwd((store) => {
    const written = store.writeState('feat', 1, () => makeValid(), { operation: 'test' });
    assert.equal(written.version, 1); // 0 → 1 on first write
    const cur = store.readState('feat', 1);
    assert.equal(cur.state.slug, 'feat');
    assert.equal(cur.version, 1);
  });
});

test('writeState rejects schema-invalid mutator output', () => {
  withTmpCwd((store) => {
    assert.throws(
      () => store.writeState('feat', 1, () => ({ schema_version: 0 }), { operation: 'bad' }),
      /state validation failed/
    );
  });
});

test('writeState bumps version on each write', () => {
  withTmpCwd((store) => {
    store.writeState('feat', 1, () => makeValid(), { operation: 'init' });
    const after1 = store.readState('feat', 1).version;
    store.writeState('feat', 1, (cur) => ({ ...cur, current_step: '2' }), { operation: 'step' });
    const after2 = store.readState('feat', 1).version;
    assert.equal(after2, after1 + 1);
  });
});

test('mutator returning null aborts write', () => {
  withTmpCwd((store) => {
    store.writeState('feat', 1, () => makeValid(), { operation: 'init' });
    const beforeVer = store.readState('feat', 1).version;
    const result = store.writeState('feat', 1, () => null, { operation: 'abort' });
    assert.equal(result, null);
    assert.equal(store.readState('feat', 1).version, beforeVer);
  });
});

test('readState returns null when file absent', () => {
  withTmpCwd((store) => {
    assert.equal(store.readState('missing', 1), null);
  });
});

test('lockfile stale lock cleared by acquire', () => {
  withTmpCwd((store) => {
    const lockPath = store.lockFilePath('feat', 1);
    // Write a stale lock with non-existent PID and old timestamp.
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999, host: 'old', started_at: '2020-01-01T00:00:00Z', operation: 'stale',
    }));
    // Acquire should reclaim.
    const ok = store.acquireLock('feat', 1, 'test');
    assert.equal(ok, true);
    store.releaseLock('feat', 1);
  });
});
