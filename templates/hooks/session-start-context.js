#!/usr/bin/env node
// harness-sf SessionStart hook.
// Outputs project conventions + sf org summary + most-recent design.md as additional context
// the model sees on session start. Non-fatal: any failure → silent (no context injected).
//
// Output protocol: write JSON to stdout, e.g.
//   { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const cwd = process.cwd();
const harnessDir = path.join(cwd, '.harness-sf');
const sections = [];

function readIfExists(p, max = 8000) {
  try {
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p, 'utf8');
    return buf.length > max ? buf.slice(0, max) + '\n... (truncated)' : buf;
  } catch { return null; }
}

// Compress bulky sections (≥15 non-blank lines OR contains a fenced codeblock)
// into a 1-line pointer so SessionStart context stays lean. Skills/agents that
// need the full content Read the file directly. Cuts ~50% on average PROJECT.md
// and scales: a 200-line YAML schema doesn't bloat sub-agent inheritance cost.
function compressMd(text, sourceRel) {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  // Pass header content (before first ##) through verbatim — it's usually a
  // short preamble / file purpose blurb.
  while (i < lines.length && !/^##\s+/.test(lines[i])) { out.push(lines[i]); i += 1; }
  while (i < lines.length) {
    const headerLine = lines[i];
    const headerMatch = headerLine.match(/^##\s+(.+?)\s*$/);
    if (!headerMatch) { out.push(headerLine); i += 1; continue; }
    // Collect this section's body until the next ## or EOF.
    const bodyStart = i + 1;
    let j = bodyStart;
    while (j < lines.length && !/^##\s+/.test(lines[j])) j += 1;
    const body = lines.slice(bodyStart, j);
    const nonBlank = body.filter(l => l.trim().length > 0).length;
    const hasFence = body.some(l => /^```/.test(l));
    if (nonBlank >= 15 || hasFence) {
      out.push(headerLine);
      out.push('');
      out.push(`_(section bulky — see ${sourceRel} for full content; ${nonBlank} lines${hasFence ? ', includes config block' : ''})_`);
      out.push('');
    } else {
      out.push(headerLine);
      for (const l of body) out.push(l);
    }
    i = j;
  }
  return out.join('\n');
}

// 1. Project conventions (PROJECT.md and local override) — compressed for
// session-start. Bulky sections collapse to 1-line pointers; the file itself
// is unchanged and consumers (check-logging.js etc.) keep reading it raw.
const projectMd = readIfExists(path.join(harnessDir, 'PROJECT.md'));
if (projectMd) sections.push(`## Project Conventions (.harness-sf/PROJECT.md)\n\n${compressMd(projectMd, '.harness-sf/PROJECT.md')}`);

const localMd = readIfExists(path.join(harnessDir, 'local.md'));
if (localMd) sections.push(`## Project Conventions (local override — .harness-sf/local.md)\n\n${compressMd(localMd, '.harness-sf/local.md')}`);

// 2. sf org summary (target-org only, single line). Cap at 4 seconds.
function runQuiet(cmd, args, timeoutMs) {
  try {
    const isWin = process.platform === 'win32';
    const r = isWin
      ? spawnSync([cmd].concat(args).map(a => /\s/.test(a) ? `"${a}"` : a).join(' '), { encoding: 'utf8', shell: true, timeout: timeoutMs })
      : spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
    return { ok: r.status === 0, stdout: r.stdout || '' };
  } catch { return { ok: false, stdout: '' }; }
}

const orgs = runQuiet('sf', ['org', 'list', '--json'], 4000);
if (orgs.ok) {
  try {
    const parsed = JSON.parse(orgs.stdout);
    const all = []
      .concat((parsed.result && parsed.result.nonScratchOrgs) || [])
      .concat((parsed.result && parsed.result.scratchOrgs) || [])
      .concat((parsed.result && parsed.result.devHubs) || [])
      .concat((parsed.result && parsed.result.sandboxes) || []);
    const def = all.find(o => o.isDefaultUsername || o.isDefaultDevHubUsername);
    if (def) {
      sections.push(`## Salesforce target-org\n\n- alias: ${def.alias || '(none)'}\n- username: ${def.username}\n- instance: ${def.instanceUrl || 'n/a'}`);
    }
  } catch {}
}

// 3. Most-recent design.md (mtime).
try {
  const designsDir = path.join(harnessDir, 'designs');
  if (fs.existsSync(designsDir)) {
    const md = fs.readdirSync(designsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ f, m: fs.statSync(path.join(designsDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (md.length) {
      sections.push(`## Active design.md\n\n- .harness-sf/designs/${md[0].f}\n- (most recently modified — likely the in-flight feature/skill design)`);
    }
  }
} catch {}

if (!sections.length) process.exit(0);

const additionalContext = sections.join('\n\n---\n\n');
const out = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
};
process.stdout.write(JSON.stringify(out));
process.exit(0);
