'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', '..', 'session-start-context.js');

function withProject(projectMd, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-ssc-'));
  const dir = path.join(root, '.harness-sf');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), projectMd);
  try { return fn(root); } finally {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Windows file locking — best effort */ }
  }
}

function runHook(cwd) {
  const r = spawnSync('node', [HOOK], { cwd, encoding: 'utf8', timeout: 6000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

test('compresses sections with code fence to 1-line pointer', () => {
  const md = `# PROJECT.md

Preamble.

## Naming
- short
- list

## Logging Convention

Some prose explaining what this does.

\`\`\`yaml
logging:
  log_sobject: IF_Log__c
  required_fields:
    - ApexName__c
    - StatusCode__c
\`\`\`

Trailing prose.
`;
  withProject(md, (cwd) => {
    const out = runHook(cwd);
    assert.ok(out, 'hook should produce JSON');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('## Naming'));
    assert.ok(ctx.includes('- short'), 'small section preserved verbatim');
    assert.ok(ctx.includes('## Logging Convention'));
    assert.ok(ctx.includes('section bulky'), 'bulky section replaced with pointer');
    assert.ok(!ctx.includes('log_sobject'), 'YAML body stripped from injection');
    assert.ok(!ctx.includes('IF_Log__c'), 'YAML body stripped from injection');
  });
});

test('compresses sections with 15+ non-blank lines', () => {
  const longBody = Array.from({ length: 20 }, (_, i) => `- item ${i + 1}`).join('\n');
  const md = `# PROJECT.md\n\n## Forbidden Patterns\n\n${longBody}\n\n## Coverage\n\n- 75%\n`;
  withProject(md, (cwd) => {
    const out = runHook(cwd);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('## Forbidden Patterns'));
    assert.ok(ctx.includes('section bulky'));
    assert.ok(!ctx.includes('item 15'));
    assert.ok(ctx.includes('- 75%'), 'short section preserved');
  });
});

test('preserves small sections verbatim', () => {
  const md = `# PROJECT.md

## Sharing Default

- with sharing required.

## API Floor

- 60.0
`;
  withProject(md, (cwd) => {
    const out = runHook(cwd);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('with sharing required'));
    assert.ok(ctx.includes('60.0'));
    assert.ok(!ctx.includes('section bulky'), 'no compression on small sections');
  });
});

test('preserves preamble before first heading', () => {
  const md = `# PROJECT.md

This file is the team-shared layer.

## Tiny

- one
`;
  withProject(md, (cwd) => {
    const out = runHook(cwd);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('team-shared layer'));
  });
});
