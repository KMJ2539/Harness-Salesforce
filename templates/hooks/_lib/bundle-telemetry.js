#!/usr/bin/env node
// harness-sf — bundle decision telemetry recorder.
//
// Records per-bundle approval decisions during /sf-feature Step 5.0.5 (Pass 2).
// Storage: .harness-sf/.cache/scores/bundle-decisions.jsonl (append-only).
// Each line: {ts, slug, action, category, item_count}
//
// Purpose: 1-week dogfooding signal for tiered-risk-approval policy —
// if Select per-item rate >= 50%, the category bundling rules need revisiting.
//
// Commands:
//   record <slug> <category> <action> <item_count>
//   summary [--since <iso-date>]   — aggregate counts by action/category
//
// Iron Law: telemetry is observational. This recorder MUST NOT block.

'use strict';
const fs = require('fs');
const path = require('path');

const VALID_ACTIONS = new Set(['apply_all', 'select', 'defer_all']);

function logPath() {
  const dir = path.join(process.cwd(), '.harness-sf', '.cache', 'scores');
  return { dir, file: path.join(dir, 'bundle-decisions.jsonl') };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function record(slug, category, action, itemCount) {
  if (!slug || !category || !action) {
    process.stderr.write('bundle-telemetry: usage: record <slug> <category> <action> <item_count>\n');
    process.exit(2);
  }
  if (!VALID_ACTIONS.has(action)) {
    process.stderr.write(`bundle-telemetry: invalid action '${action}' — allowed: apply_all, select, defer_all\n`);
    process.exit(2);
  }
  const n = parseInt(itemCount, 10);
  if (!Number.isFinite(n) || n < 1) {
    process.stderr.write(`bundle-telemetry: invalid item_count '${itemCount}'\n`);
    process.exit(2);
  }
  const { dir, file } = logPath();
  ensureDir(dir);
  const entry = { ts: new Date().toISOString(), slug, action, category, item_count: n };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  process.stdout.write(`recorded: ${slug} ${category} ${action} (${n} items)\n`);
}

function summary(sinceIso) {
  const { file } = logPath();
  if (!fs.existsSync(file)) {
    process.stdout.write(JSON.stringify({ total: 0, by_action: {}, by_category: {} }, null, 2) + '\n');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  let total = 0;
  const byAction = {};
  const byCategory = {};
  for (const ln of lines) {
    let e;
    try { e = JSON.parse(ln); } catch { continue; }
    if (since && Date.parse(e.ts) < since) continue;
    total += 1;
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  const selectRate = total ? ((byAction.select || 0) / total) : 0;
  process.stdout.write(JSON.stringify({
    total,
    by_action: byAction,
    by_category: byCategory,
    select_rate: Number(selectRate.toFixed(3)),
  }, null, 2) + '\n');
}

const [, , cmd, ...rest] = process.argv;
if (cmd === 'record') {
  record(rest[0], rest[1], rest[2], rest[3]);
} else if (cmd === 'summary') {
  const sinceIdx = rest.indexOf('--since');
  const since = sinceIdx >= 0 ? rest[sinceIdx + 1] : null;
  summary(since);
} else {
  process.stderr.write('bundle-telemetry: usage:\n  record <slug> <category> <action> <item_count>\n  summary [--since <iso-date>]\n');
  process.exit(2);
}
