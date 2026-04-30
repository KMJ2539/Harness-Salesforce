'use strict';
// P0 — statusline must not depend on design.md `[status:]` tags. With state.json
// present it shows dispatch progress; with state.json absent the design.md
// regex fallback was removed (was producing phantom dispatch counts).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'statusline.js');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-statusline-'));
  try { fn(dir); }
  finally {
    // Windows occasionally holds child-process handles for a tick after spawnSync
    // returns; cleanup is best-effort. The OS reaps tmpdir eventually.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
    catch { /* ignore */ }
  }
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
  // statusline calls `sf config get target-org` — let it fail silently in tmp.
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', input: '' });
  return { stdout: r.stdout || '', stderr: r.stderr || '' };
}

const designStatusOnly = `---
type: feature
name: orders
---

## Artifacts

### 1. order-sobject  [type: sobject]  [status: pending]
### 2. order-handler  [type: apex]  [status: done]
`;

test('stale [status:] tags in design.md do not produce dispatch summary', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    // no state.json — pre-P0 this would have shown "dispatch:1/2" from regex.
    const { stdout } = run(cwd);
    assert.match(stdout, /design:/, 'design token still present');
    assert.doesNotMatch(stdout, /dispatch:/, 'no fabricated dispatch summary');
  });
});

test('canonical state.json drives dispatch summary + failed token', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    writeState(cwd, '2026-04-30-orders', 1, {
      schema_version: 1, version: 1, slug: '2026-04-30-orders',
      artifacts: [
        { id: 'a1', type: 'sobject', status: 'done' },
        { id: 'a2', type: 'apex', status: 'failed' },
        { id: 'a3', type: 'lwc', status: 'pending' },
      ],
    });
    const { stdout } = run(cwd);
    assert.match(stdout, /dispatch:1\/3/, 'shows done/total');
    assert.doesNotMatch(stdout, /dispatch:.*!/, 'no inline ! on dispatch token');
    assert.match(stdout, /failed:1/, 'failed split into its own token');
    assert.match(stdout, /phase:build/, 'incomplete artifacts → build phase');
  });
});

test('phase=plan when no state.json', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    const { stdout } = run(cwd);
    assert.match(stdout, /phase:plan/);
    assert.doesNotMatch(stdout, /failed:/);
    assert.doesNotMatch(stdout, /dispatch:/);
  });
});

test('current token only when an artifact is in_progress', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    writeState(cwd, '2026-04-30-orders', 1, {
      schema_version: 1, version: 1, slug: '2026-04-30-orders',
      artifacts: [
        { id: 'sobj-a', type: 'sobject', status: 'done' },
        { id: 'apex-b', type: 'apex', status: 'in_progress' },
      ],
    });
    const { stdout } = run(cwd);
    assert.match(stdout, /current:apex-b/);
  });
});

test('approval token shown only when remaining < 60m', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    // modify-approvals TTL=30m, issued 5m ago → 25m remaining → should show.
    const sentDir = path.join(cwd, '.harness-sf', '.cache', 'modify-approvals');
    fs.mkdirSync(sentDir, { recursive: true });
    fs.writeFileSync(
      path.join(sentDir, 'k1.json'),
      JSON.stringify({ issued_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    );
    const { stdout } = run(cwd);
    assert.match(stdout, /approval:\d+m\(modify\)/);
  });
});

test('approval token suppressed when remaining ≥ 60m', () => {
  withTmpCwd((cwd) => {
    writeDesign(cwd, '2026-04-30-orders', designStatusOnly);
    // design-approvals TTL=2h, issued 1m ago → ~119m remaining → suppressed.
    const sentDir = path.join(cwd, '.harness-sf', '.cache', 'design-approvals');
    fs.mkdirSync(sentDir, { recursive: true });
    fs.writeFileSync(
      path.join(sentDir, 'k1.json'),
      JSON.stringify({ issued_at: new Date(Date.now() - 1 * 60 * 1000).toISOString() })
    );
    const { stdout } = run(cwd);
    assert.doesNotMatch(stdout, /approval:/);
  });
});
