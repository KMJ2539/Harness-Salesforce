'use strict';
// P2 — every blocking hook must emit the standardized 5-field block.
// We trigger each gate's denial path and assert "Blocked:" / "Why:" / "Fix:" /
// "File:" / "Override:" structure on stderr (or in the SubagentStop JSON.reason).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.resolve(__dirname, '..', '..');

function withTmpCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsf-gates-'));
  try { return fn(dir); }
  finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
    catch { /* ignore */ }
  }
}

function runHook(hookFile, { cwd, env = {}, stdin = '' }) {
  return spawnSync(process.execPath, [path.join(HOOKS, hookFile)], {
    cwd, encoding: 'utf8', input: stdin, env: { ...process.env, ...env },
  });
}

function assertStderrBlock(stderr) {
  assert.match(stderr, /^Blocked: .+/m, `expected "Blocked:" line in:\n${stderr}`);
  assert.match(stderr, /^Why:\s+.+/m);
  assert.match(stderr, /^Fix:\s+.+/m);
  assert.match(stderr, /^File:\s+.+/m);
  assert.match(stderr, /^Override: .+/m);
}

function assertJsonReasonBlock(stdout) {
  // SubagentStop hooks emit JSON {decision:'block', reason:'...'} on stdout.
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.decision, 'block');
  const r = parsed.reason || '';
  assert.match(r, /^Blocked: .+/m, `expected "Blocked:" line in JSON.reason:\n${r}`);
  assert.match(r, /^Why:\s+.+/m);
  assert.match(r, /^Fix:\s+.+/m);
  assert.match(r, /^File:\s+.+/m);
  assert.match(r, /^Override: .+/m);
}

test('pre-write-path-guard: reviewer agent denied', () => {
  withTmpCwd((cwd) => {
    const r = runHook('pre-write-path-guard.js', {
      cwd,
      env: { CLAUDE_AGENT: 'sf-design-eng-reviewer' },
      stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'foo.md' } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-write-path-guard: agent prefix violation', () => {
  withTmpCwd((cwd) => {
    const r = runHook('pre-write-path-guard.js', {
      cwd,
      env: { CLAUDE_AGENT: 'sf-context-explorer' },
      stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'force-app/something.cls' } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-write-path-guard: profile edit forbidden', () => {
  withTmpCwd((cwd) => {
    const r = runHook('pre-write-path-guard.js', {
      cwd,
      env: { CLAUDE_AGENT: '' },
      stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'force-app/main/default/profiles/Admin.profile-meta.xml' } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-deploy-gate: no validation evidence', () => {
  withTmpCwd((cwd) => {
    const r = runHook('pre-deploy-gate.js', {
      cwd,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sf project deploy start -x manifest/package.xml' } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-modify-approval-gate: existing file without sentinel', () => {
  withTmpCwd((cwd) => {
    const target = path.join(cwd, 'force-app', 'main', 'default', 'classes', 'Foo.cls');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'public class Foo {}');
    const r = runHook('pre-modify-approval-gate.js', {
      cwd,
      stdin: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: target } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-library-install-gate: package install without approval', () => {
  withTmpCwd((cwd) => {
    const r = runHook('pre-library-install-gate.js', {
      cwd,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sf package install -p 04t1A0000001234ABC -w 10' } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

test('pre-create-design-link-gate: new file without design approval', () => {
  withTmpCwd((cwd) => {
    const target = path.join(cwd, 'force-app', 'main', 'default', 'classes', 'NewClass.cls');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // do NOT create the file — CREATE mode
    const r = runHook('pre-create-design-link-gate.js', {
      cwd,
      stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } }),
    });
    assert.equal(r.status, 2);
    assertStderrBlock(r.stderr);
  });
});

function makeTranscript(cwd, agent, body) {
  const transcriptPath = path.join(cwd, 'transcript.jsonl');
  const entry = {
    type: 'assistant',
    message: { content: [{ type: 'text', text: body }] },
  };
  fs.writeFileSync(transcriptPath, JSON.stringify(entry) + '\n');
  return transcriptPath;
}

test('stop-reviewer-validate: forbidden block verdict', () => {
  withTmpCwd((cwd) => {
    const transcript = makeTranscript(cwd, 'sf-design-eng-reviewer', 'risk: high\n\n**Verdict: block**\n');
    const r = runHook('stop-reviewer-validate.js', {
      cwd,
      env: { CLAUDE_AGENT: 'sf-design-eng-reviewer' },
      stdin: JSON.stringify({ transcript_path: transcript }),
    });
    assert.equal(r.status, 0); // SubagentStop returns 0 + JSON
    assertJsonReasonBlock(r.stdout);
  });
});

test('stop-reviewer-validate: body over cap', () => {
  withTmpCwd((cwd) => {
    const longBody = Array(120).fill('line').join('\n');
    const transcript = makeTranscript(cwd, 'sf-design-eng-reviewer', longBody);
    const r = runHook('stop-reviewer-validate.js', {
      cwd,
      env: { CLAUDE_AGENT: 'sf-design-eng-reviewer' },
      stdin: JSON.stringify({ transcript_path: transcript }),
    });
    assert.equal(r.status, 0);
    assertJsonReasonBlock(r.stdout);
  });
});

test('stop-analyzer-validate: missing detail pointer', () => {
  withTmpCwd((cwd) => {
    const body = 'summary line 1\nsummary line 2\n(no detail pointer)';
    const transcript = makeTranscript(cwd, 'sf-context-explorer', body);
    const r = runHook('stop-analyzer-validate.js', {
      cwd,
      env: { CLAUDE_AGENT: 'sf-context-explorer' },
      stdin: JSON.stringify({ transcript_path: transcript }),
    });
    assert.equal(r.status, 0);
    assertJsonReasonBlock(r.stdout);
  });
});
