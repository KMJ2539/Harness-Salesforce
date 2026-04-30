'use strict';
// P0 — control state singularity. check-feature-context must prefer canonical
// state.json over design.md `[status:]` tags, and only fall back to the design.md
// scan when no state file exists yet (pre-dispatch bootstrap).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'check-feature-context.js');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-check-feat-'));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeDesign(cwd, slug, body) {
  const dir = path.join(cwd, '.harness-sf', 'designs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), body);
}

function writeState(cwd, slug, rev, state) {
  const dir = path.join(cwd, '.harness-sf', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}__r${rev}.json`), JSON.stringify(state));
}

function run(cwd) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  return { stdout: JSON.parse(r.stdout), stderr: r.stderr };
}

const designBody = (status1, status2) => `---
type: feature
name: orders
revision: 1
---

## Artifacts

### 1. order-sobject  [type: sobject]  [status: ${status1}]
- Role: root

### 2. order-handler  [type: apex]  [status: ${status2}]
- Role: trigger handler
`;

test('canonical state.json wins over stale design.md [status]', () => {
  withTmpCwd((cwd) => {
    // design.md says both pending, but state.json says both done.
    writeDesign(cwd, 'orders-feat', designBody('pending', 'pending'));
    writeState(cwd, 'orders-feat', 1, {
      schema_version: 1, version: 1, slug: 'orders-feat',
      artifacts: [
        { id: 'order-sobject', type: 'sobject', status: 'done' },
        { id: 'order-handler', type: 'apex', status: 'done' },
      ],
    });
    const { stdout } = run(cwd);
    assert.equal(stdout.has_active_feature, false, 'all done in state — no active feature');
    assert.equal(stdout.candidates.length, 0);
  });
});

test('canonical state.json reflects in_progress even when design.md is pending', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, 'orders-feat', designBody('pending', 'pending'));
    writeState(cwd, 'orders-feat', 1, {
      schema_version: 1, version: 1, slug: 'orders-feat',
      artifacts: [
        { id: 'order-sobject', type: 'sobject', status: 'done' },
        { id: 'order-handler', type: 'apex', status: 'in_progress' },
      ],
    });
    const { stdout } = run(cwd);
    assert.equal(stdout.has_active_feature, true);
    assert.equal(stdout.candidates.length, 1);
    assert.equal(stdout.candidates[0].source, 'state');
    assert.equal(stdout.candidates[0].pending_artifacts.length, 1);
    assert.equal(stdout.candidates[0].pending_artifacts[0].id, 'order-handler');
    assert.equal(stdout.candidates[0].pending_artifacts[0].status, 'in_progress');
  });
});

test('bootstrap fallback: state.json absent, read design.md and warn', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, 'orders-feat', designBody('pending', 'pending'));
    // no state.json
    const { stdout, stderr } = run(cwd);
    assert.equal(stdout.has_active_feature, true);
    assert.equal(stdout.candidates[0].source, 'design-md-bootstrap');
    assert.equal(stdout.candidates[0].pending_artifacts.length, 2);
    assert.match(stderr, /bootstrap fallback/);
  });
});

test('latest revision wins when multiple state files exist', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, 'orders-feat', designBody('pending', 'pending'));
    writeState(cwd, 'orders-feat', 1, {
      schema_version: 1, version: 1, slug: 'orders-feat',
      artifacts: [{ id: 'order-sobject', type: 'sobject', status: 'pending' }],
    });
    writeState(cwd, 'orders-feat', 2, {
      schema_version: 1, version: 1, slug: 'orders-feat',
      artifacts: [{ id: 'order-sobject', type: 'sobject', status: 'done' }],
    });
    const { stdout } = run(cwd);
    assert.equal(stdout.has_active_feature, false, 'r2 done overrides r1 pending');
  });
});

test('no design.md → empty result, no warn', () => {
  withTmpCwd((cwd) => {
    const { stdout, stderr } = run(cwd);
    assert.equal(stdout.has_active_feature, false);
    assert.equal(stdout.candidates.length, 0);
    assert.doesNotMatch(stderr, /bootstrap fallback/);
  });
});
