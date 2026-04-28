#!/usr/bin/env node
// harness-sf PreToolUse hook for Write/Edit/MultiEdit.
// Enforces path-prefix policy per subagent. main agent (no CLAUDE_AGENT) is unrestricted.
//
// Input (stdin, JSON):
//   { tool_name, tool_input: { file_path, ... }, ... }
// Env:
//   CLAUDE_AGENT — subagent name (matches agent frontmatter `name:`); empty for main agent.
// Exit:
//   0 = allow, 2 = deny (stderr message returned to model).

'use strict';
const fs = require('fs');
const path = require('path');

// Per-agent allowed path prefixes (project-relative). Reviewers are absent → Read-only.
const ALLOWED = {
  'sf-context-explorer':   ['.harness-sf/reports/'],
  'sf-flow-analyzer':      ['.harness-sf/reports/'],
  'sf-trigger-auditor':    ['.harness-sf/reports/'],
  'sf-lwc-auditor':        ['.harness-sf/reports/'],
  'sf-bug-investigator':   ['.harness-sf/reports/'],
  'sf-apex-test-author':   ['.harness-sf/reports/', 'force-app/', 'manifest/'],
  'sf-deploy-validator':   ['.harness-sf/reports/', '.harness-sf/last-validation.json', '.harness-sf/.cache/deploy-findings/', 'manifest/'],
};

// Reviewers — explicitly Write-forbidden. tools: frontmatter blocks them too; this is defense-in-depth.
const FORBIDDEN_AGENTS = new Set([
  'sf-design-ceo-reviewer',
  'sf-design-eng-reviewer',
  'sf-design-security-reviewer',
  'sf-design-qa-reviewer',
  'sf-design-library-reviewer',
  'sf-apex-code-reviewer',
]);

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function relativize(p) {
  if (!p) return '';
  const cwd = process.cwd();
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  let rel = path.relative(cwd, abs);
  rel = rel.split(path.sep).join('/');
  return rel;
}

function deny(msg) {
  process.stderr.write(`[harness-sf] ${msg}\n`);
  process.exit(2);
}

// Profile XML edits are forbidden for ALL agents (including main).
// Permission Sets are the harness-sf policy. Override only with HARNESS_SF_ALLOW_PROFILE_EDIT=1.
const PROFILE_PATH_RE = /(^|\/)force-app\/.+\/profiles\/.+\.profile-meta\.xml$/;

(function main() {
  const agent = (process.env.CLAUDE_AGENT || '').trim();

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }

  const filePath = payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path);

  if (filePath && PROFILE_PATH_RE.test(relativize(filePath))) {
    if (process.env.HARNESS_SF_ALLOW_PROFILE_EDIT !== '1') {
      deny(`Profile 편집 금지 — Permission Set으로 대체하세요. 우회: HARNESS_SF_ALLOW_PROFILE_EDIT=1. (path: ${filePath})`);
    }
  }

  if (!agent) process.exit(0); // main agent — orchestration, unrestricted (after global checks)
  if (!filePath) process.exit(0);

  if (FORBIDDEN_AGENTS.has(agent)) {
    deny(`agent '${agent}' is read-only (reviewer) — Write/Edit denied for ${filePath}`);
  }

  const prefixes = ALLOWED[agent];
  if (!prefixes) process.exit(0); // unknown agent — let it through (not our policy domain)

  const rel = relativize(filePath);
  const escapesRoot = rel.startsWith('..');
  if (escapesRoot) {
    deny(`agent '${agent}' attempted Write outside project root: ${filePath}`);
  }

  const ok = prefixes.some(pre => {
    if (pre.endsWith('/')) return rel === pre.slice(0, -1) || rel.startsWith(pre);
    return rel === pre;
  });
  if (!ok) {
    deny(`agent '${agent}' Write to '${rel}' violates path policy. Allowed prefixes: ${prefixes.join(', ')}`);
  }

  process.exit(0);
})();
