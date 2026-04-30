'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'archive-design-revision.js');

function withTempDesign(content, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-arc-'));
  const designsDir = path.join(root, '.harness-sf', 'designs');
  fs.mkdirSync(designsDir, { recursive: true });
  const designPath = path.join(designsDir, '2026-04-30-feature-foo.md');
  fs.writeFileSync(designPath, content);
  const oldCwd = process.cwd();
  process.chdir(root);
  try { return fn({ root, designPath, designsDir }); } finally {
    process.chdir(oldCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(designPath) {
  return spawnSync('node', [SCRIPT, designPath], { encoding: 'utf8' });
}

test('archives fenced revision blocks and replaces with stubs', () => {
  const content = `---
name: foo
type: feature
revision: 2
---

## Reviews

<!-- archive-revision: 1 -->
# Eng Review: (rev 1, superseded)
[H1|deploy] old issue
<!-- /archive-revision: 1 -->

# Eng Review:
[H1|deploy] current issue
`;
  withTempDesign(content, ({ designPath }) => {
    const r = run('.harness-sf/designs/2026-04-30-feature-foo.md');
    assert.equal(r.status, 0, r.stderr);
    const updated = fs.readFileSync(designPath, 'utf8');
    assert.ok(!updated.includes('archive-revision: 1'), 'fence should be removed');
    assert.ok(!updated.includes('old issue'), 'old content should be removed');
    assert.ok(updated.includes('current issue'), 'current content preserved');
    assert.match(updated, /rev 1 archived/);
    const archive = fs.readFileSync(designPath.replace(/\.md$/, '.archive.md'), 'utf8');
    assert.ok(archive.includes('Revision 1'));
    assert.ok(archive.includes('old issue'));
  });
});

test('no-op when no fences present', () => {
  const content = `---
name: foo
type: feature
---

## Reviews

# Eng Review:
nothing fenced
`;
  withTempDesign(content, ({ designPath }) => {
    const r = run('.harness-sf/designs/2026-04-30-feature-foo.md');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no-op/);
    assert.equal(fs.readFileSync(designPath, 'utf8'), content);
    assert.ok(!fs.existsSync(designPath.replace(/\.md$/, '.archive.md')));
  });
});

test('multiple revisions archived in one call', () => {
  const content = `---
name: foo
type: feature
revision: 3
---

## Reviews

<!-- archive-revision: 1 -->
rev1 reviews
<!-- /archive-revision: 1 -->

<!-- archive-revision: 2 -->
rev2 reviews
<!-- /archive-revision: 2 -->

# Eng Review:
rev3 current
`;
  withTempDesign(content, ({ designPath }) => {
    const r = run('.harness-sf/designs/2026-04-30-feature-foo.md');
    assert.equal(r.status, 0);
    const updated = fs.readFileSync(designPath, 'utf8');
    assert.match(updated, /rev 1 archived/);
    assert.match(updated, /rev 2 archived/);
    assert.ok(updated.includes('rev3 current'));
    const archive = fs.readFileSync(designPath.replace(/\.md$/, '.archive.md'), 'utf8');
    assert.ok(archive.includes('rev1 reviews'));
    assert.ok(archive.includes('rev2 reviews'));
  });
});

test('archive append preserves prior archive content', () => {
  const content = `---
name: foo
type: feature
---

<!-- archive-revision: 2 -->
rev2 body
<!-- /archive-revision: 2 -->
`;
  withTempDesign(content, ({ designPath }) => {
    const archivePath = designPath.replace(/\.md$/, '.archive.md');
    fs.writeFileSync(archivePath, '# Archive — existing\n\n## Revision 1 (archived earlier)\n\nold rev1\n\n---\n\n');
    const r = run('.harness-sf/designs/2026-04-30-feature-foo.md');
    assert.equal(r.status, 0);
    const archive = fs.readFileSync(archivePath, 'utf8');
    assert.ok(archive.includes('old rev1'));
    assert.ok(archive.includes('rev2 body'));
  });
});

test('rejects path outside .harness-sf/designs/', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-arc-'));
  const oldCwd = process.cwd();
  process.chdir(root);
  try {
    fs.writeFileSync(path.join(root, 'rogue.md'), '<!-- archive-revision: 1 -->\nx\n<!-- /archive-revision: 1 -->\n');
    const r = run('rogue.md');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must live under \.harness-sf\/designs/);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
