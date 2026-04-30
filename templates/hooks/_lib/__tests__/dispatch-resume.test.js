'use strict';
// P3 — dispatch-state-cli `list-incomplete` + `resume` integration tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'dispatch-state-cli.js');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-resume-'));
  try { return fn(dir); }
  finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
    catch { /* ignore */ }
  }
}

function writeStateFile(cwd, slug, rev, artifacts, mtimeAgoMs = 0) {
  const dir = path.join(cwd, '.harness-sf', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${slug}__r${rev}.json`);
  fs.writeFileSync(p, JSON.stringify({
    schema_version: 1,
    version: 1,
    slug,
    design_path: `.harness-sf/designs/${slug}.md`,
    design_revision: rev,
    design_body_hash: 'sha256:' + 'a'.repeat(64),
    lock: null,
    current_step: '6',
    entered_via: 'full',
    artifacts: artifacts.map(a => ({
      completed_at: null,
      depends_on: [],
      ...a,
    })),
    deploy: { last_validation: null, findings: [] },
    loop: { iteration: 0, last_error_class: null },
    override_active_session: null,
    override_history: [],
  }, null, 2) + '\n');
  if (mtimeAgoMs > 0) {
    const t = (Date.now() - mtimeAgoMs) / 1000;
    fs.utimesSync(p, t, t);
  }
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('list-incomplete returns empty when state dir absent', () => {
  withTmpCwd((cwd) => {
    const r = run(cwd, 'list-incomplete');
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), []);
  });
});

test('list-incomplete returns slugs with pending/in_progress/failed artifacts', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'orders-feat', 1, [
      { id: 'a1', type: 'sobject', status: 'done', completed_at: new Date().toISOString() },
      { id: 'a2', type: 'apex', status: 'pending' },
    ]);
    writeStateFile(cwd, 'billing-feat', 1, [
      { id: 'b1', type: 'sobject', status: 'failed' },
    ]);
    writeStateFile(cwd, 'finished-feat', 1, [
      { id: 'c1', type: 'sobject', status: 'done', completed_at: new Date().toISOString() },
    ]);
    const r = run(cwd, 'list-incomplete');
    assert.equal(r.status, 0);
    const list = JSON.parse(r.stdout);
    const slugs = list.map(x => x.slug).sort();
    assert.deepEqual(slugs, ['billing-feat', 'orders-feat']);
    const ordersEntry = list.find(x => x.slug === 'orders-feat');
    assert.equal(ordersEntry.incomplete.length, 1);
    assert.equal(ordersEntry.incomplete[0].id, 'a2');
  });
});

test('list-incomplete hides stale (mtime > 7 days) by default', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'fresh-feat', 1, [
      { id: 'a1', type: 'sobject', status: 'pending' },
    ]);
    writeStateFile(cwd, 'stale-feat', 1, [
      { id: 'b1', type: 'sobject', status: 'pending' },
    ], 8 * 24 * 60 * 60 * 1000);

    const r = run(cwd, 'list-incomplete');
    const list = JSON.parse(r.stdout);
    const slugs = list.map(x => x.slug);
    assert.deepEqual(slugs, ['fresh-feat']);
  });
});

test('list-incomplete --all surfaces stale slugs', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'stale-feat', 1, [
      { id: 'b1', type: 'sobject', status: 'pending' },
    ], 8 * 24 * 60 * 60 * 1000);

    const r = run(cwd, 'list-incomplete', '--all');
    const list = JSON.parse(r.stdout);
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'stale-feat');
  });
});

test('list-incomplete groups by slug, picks highest revision', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'orders-feat', 1, [
      { id: 'a1', type: 'sobject', status: 'pending' },
    ]);
    writeStateFile(cwd, 'orders-feat', 2, [
      { id: 'a1', type: 'sobject', status: 'done', completed_at: new Date().toISOString() },
    ]);
    const r = run(cwd, 'list-incomplete');
    const list = JSON.parse(r.stdout);
    assert.equal(list.length, 0, 'r2 (latest) is fully done — slug should not appear');
  });
});

test('resume flips failed → pending and reports next artifact', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'orders-feat', 1, [
      { id: 'a1', type: 'sobject', status: 'done', completed_at: new Date().toISOString() },
      { id: 'a2', type: 'apex', status: 'failed' },
      { id: 'a3', type: 'lwc', status: 'pending' },
    ]);
    const r = run(cwd, 'resume', 'orders-feat');
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.next.id, 'a2');
    assert.equal(out.next.status, 'pending');
    assert.equal(out.done, 1);
    assert.equal(out.total, 3);
    assert.equal(out.all_complete, false);

    // Verify the state.json was actually mutated.
    const statePath = path.join(cwd, '.harness-sf', 'state', 'orders-feat__r1.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const a2 = state.artifacts.find(a => a.id === 'a2');
    assert.equal(a2.status, 'pending');
    assert.equal(a2.completed_at, null);
  });
});

test('resume on fully done feature returns all_complete', () => {
  withTmpCwd((cwd) => {
    writeStateFile(cwd, 'orders-feat', 1, [
      { id: 'a1', type: 'sobject', status: 'done', completed_at: new Date().toISOString() },
    ]);
    const r = run(cwd, 'resume', 'orders-feat');
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.all_complete, true);
    assert.equal(out.next, null);
  });
});

test('resume errors when slug has no canonical state', () => {
  withTmpCwd((cwd) => {
    const r = run(cwd, 'resume', 'nonexistent-feat');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no canonical state/);
  });
});
