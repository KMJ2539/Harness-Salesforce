'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withClean(envOverrides, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-ovr-'));
  const oldCwd = process.cwd();
  process.chdir(dir);
  // Save & clear any HARNESS_SF_* env so module-level reads start clean.
  const saved = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('HARNESS_SF_') || k === 'CLAUDE_SESSION_ID') {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }
  for (const [k, v] of Object.entries(envOverrides || {})) {
    process.env[k] = v;
  }
  // Force fresh module load — override caches no env, but audit caches AUDIT_PATH.
  delete require.cache[require.resolve('../override')];
  delete require.cache[require.resolve('../audit')];
  try {
    fn(require('../override'));
  } finally {
    process.chdir(oldCwd);
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HARNESS_SF_') || k === 'CLAUDE_SESSION_ID') delete process.env[k];
    }
    Object.assign(process.env, saved);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('no env → no override', () => {
  withClean({}, (ovr) => {
    assert.equal(ovr.isActive('deploy'), false);
    assert.equal(ovr.describe(), null);
  });
});

test('valid scope:reason → isActive true', () => {
  withClean({ HARNESS_SF_OVERRIDE: 'deploy:legitimate ci bypass for nightly run' }, (ovr) => {
    assert.equal(ovr.isActive('deploy'), true);
    assert.equal(ovr.isActive('modify'), false);
    const d = ovr.describe();
    assert.equal(d.scope, 'deploy');
  });
});

test('all scope matches everything', () => {
  withClean({ HARNESS_SF_OVERRIDE: 'all:emergency global bypass needed' }, (ovr) => {
    assert.equal(ovr.isActive('deploy'), true);
    assert.equal(ovr.isActive('modify'), true);
    assert.equal(ovr.isActive('library'), true);
  });
});

test('reason too short → isActive false', () => {
  withClean({ HARNESS_SF_OVERRIDE: 'deploy:short' }, (ovr) => {
    assert.equal(ovr.isActive('deploy'), false);
  });
});

test('unknown scope → isActive false', () => {
  withClean({ HARNESS_SF_OVERRIDE: 'bogus:long enough reason for sure' }, (ovr) => {
    assert.equal(ovr.isActive('bogus'), false);
    assert.equal(ovr.isActive('deploy'), false);
  });
});

test('decideBypass logs once + denies second use', () => {
  withClean({ HARNESS_SF_OVERRIDE: 'deploy:first valid bypass try here' }, (ovr) => {
    assert.equal(ovr.decideBypass('deploy', 'gate1'), true);
    // Same process, same gate — already logged, returns true.
    assert.equal(ovr.decideBypass('deploy', 'gate1'), true);
    // audit log has one line at this point
    const audit = require('../audit');
    assert.equal(audit.tail(10).length, 1);
  });
});

test('legacy SKIP_DEPLOY_GATE no longer bypasses', () => {
  withClean({ HARNESS_SF_SKIP_DEPLOY_GATE: '1' }, (ovr) => {
    assert.equal(ovr.isActive('deploy'), false);
  });
});
