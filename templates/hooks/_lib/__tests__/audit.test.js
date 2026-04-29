'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-audit-'));
  const oldCwd = process.cwd();
  process.chdir(dir);
  // Ensure fresh module load each test (audit caches AUDIT_PATH from cwd).
  delete require.cache[require.resolve('../audit')];
  try {
    fn(require('../audit'));
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('append-verify roundtrip', () => {
  withTmpCwd((audit) => {
    audit.append({ gate: 'g1', scope: 'deploy', reason: 'first valid reason here' });
    audit.append({ gate: 'g2', scope: 'modify', reason: 'second valid reason here', slug: 'feat' });
    const r = audit.verify();
    assert.equal(r.ok, true);
    assert.equal(r.total, 2);
  });
});

test('reason min length enforcement', () => {
  withTmpCwd((audit) => {
    assert.throws(() => audit.append({ gate: 'g', scope: 'deploy', reason: 'short' }),
      /reason must have >= 8 non-whitespace chars/);
  });
});

test('chain detects sha tamper', () => {
  withTmpCwd((audit) => {
    audit.append({ gate: 'g1', scope: 'deploy', reason: 'first valid reason here' });
    audit.append({ gate: 'g2', scope: 'modify', reason: 'second valid reason here' });
    const raw = fs.readFileSync('.harness-sf/audit.log', 'utf8');
    fs.writeFileSync('.harness-sf/audit.log', raw.replace('first valid', 'first ZZZZZ'));
    const r = audit.verify();
    assert.equal(r.ok, false);
    assert.equal(r.broken_at, 1);
    assert.match(r.reason, /sha mismatch/);
  });
});

test('chain detects prev tamper (insertion)', () => {
  withTmpCwd((audit) => {
    audit.append({ gate: 'g1', scope: 'deploy', reason: 'first valid reason here' });
    // Insert a fake line at top.
    const raw = fs.readFileSync('.harness-sf/audit.log', 'utf8');
    fs.writeFileSync('.harness-sf/audit.log',
      `2026-01-01T00:00:00Z\tfake\t\tdeploy\tinjected fake reason here\tprev=000000000000000000\tsha=fakefakefakefakefa\n${raw}`);
    const r = audit.verify();
    assert.equal(r.ok, false);
  });
});

test('tail honors n', () => {
  withTmpCwd((audit) => {
    for (let i = 0; i < 5; i++) {
      audit.append({ gate: `g${i}`, scope: 'deploy', reason: `entry number ${i} reason` });
    }
    assert.equal(audit.tail(2).length, 2);
    assert.equal(audit.tail(10).length, 5);
  });
});
