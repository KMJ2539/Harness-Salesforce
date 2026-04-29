#!/usr/bin/env node
// harness-sf — iteration cap tracking for /sf-feature Step 7.5 deploy-validate
// auto-loop. Prevents infinite fix loops and bounds total cost.
//
// State file: .harness-sf/.cache/validate-loop/{slug}.json
//   {
//     slug, started_at, last_at,
//     code_fix_count, design_fix_count, total,
//     last_decision: "code-fix" | "design-fix" | "hold" | null,
//     history: [{ ts, kind, summary }]
//   }
//
// Caps (hard):
//   code-fix:   max 2 per loop
//   design-fix: max 2 per loop
//   total:      max 4 per loop
//
// Usage:
//   node validate-loop-state.js init <slug>
//   node validate-loop-state.js incr <slug> <kind: code-fix|design-fix> [--note "..."]
//   node validate-loop-state.js get <slug>
//   node validate-loop-state.js reset <slug>
//
// Exit:
//   0 — operation succeeded; stdout is JSON state
//   1 — bad args / cap exceeded (stderr explains)

'use strict';
const fs = require('fs');
const path = require('path');

// PR B — best-effort dual-write to .harness-sf/state/<slug>__r<rev>.json.
// Only loop.iteration syncs (legacy total). loop.last_error_class is left
// to deploy-classify/gate-side updates.
let store;
try { store = require('./state/store'); } catch { store = null; }

function findStateRevision(slug) {
  if (!store) return null;
  const dir = path.join(process.cwd(), '.harness-sf', 'state');
  if (!fs.existsSync(dir)) return null;
  const escaped = slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^${escaped}__r(\\d+)\\.json$`);
  const matches = fs.readdirSync(dir)
    .map(f => f.match(re))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => b - a);
  return matches[0] || null;
}

function dualSyncLoop(slug, iteration) {
  const rev = findStateRevision(slug);
  if (!store || rev === null) return;
  if (typeof iteration !== 'number' || iteration < 0 || iteration > 4) return;
  try {
    store.writeState(slug, rev, (cur) => {
      if (!cur) return null;
      const next = JSON.parse(JSON.stringify(cur));
      next.loop = next.loop || { iteration: 0, last_error_class: null };
      next.loop.iteration = iteration;
      return next;
    }, { operation: `validate-loop:dual-sync iter=${iteration}` });
  } catch {
    // best-effort
  }
}

const CAPS = { 'code-fix': 2, 'design-fix': 2, total: 4 };
const VALID_KINDS = new Set(['code-fix', 'design-fix']);

function statePath(slug) {
  if (!/^[\w.-]+$/.test(slug)) throw new Error(`invalid slug '${slug}' — only [A-Za-z0-9_.-] allowed`);
  return path.resolve(process.cwd(), '.harness-sf', '.cache', 'validate-loop', `${slug}.json`);
}

function load(slug) {
  const p = statePath(slug);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function save(slug, state) {
  const p = statePath(slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
  return state;
}

function init(slug) {
  const now = new Date().toISOString();
  const state = {
    slug,
    started_at: now,
    last_at: now,
    code_fix_count: 0,
    design_fix_count: 0,
    total: 0,
    last_decision: null,
    history: [],
  };
  save(slug, state);
  dualSyncLoop(slug, 0);
  return state;
}

function incr(slug, kind, note) {
  if (!VALID_KINDS.has(kind)) throw new Error(`invalid kind '${kind}' — allowed: ${[...VALID_KINDS].join('|')}`);
  let state = load(slug);
  if (!state) state = init(slug);
  const projected = {
    'code-fix': state.code_fix_count + (kind === 'code-fix' ? 1 : 0),
    'design-fix': state.design_fix_count + (kind === 'design-fix' ? 1 : 0),
    total: state.total + 1,
  };
  if (projected[kind] > CAPS[kind]) {
    process.stderr.write(`validate-loop-state: cap exceeded for '${kind}' (${projected[kind]} > ${CAPS[kind]}) — abort auto-loop, hand to user\n`);
    process.stderr.write(JSON.stringify(state, null, 2) + '\n');
    process.exit(1);
  }
  if (projected.total > CAPS.total) {
    process.stderr.write(`validate-loop-state: total cap exceeded (${projected.total} > ${CAPS.total}) — abort auto-loop, hand to user\n`);
    process.stderr.write(JSON.stringify(state, null, 2) + '\n');
    process.exit(1);
  }
  state.code_fix_count = projected['code-fix'];
  state.design_fix_count = projected['design-fix'];
  state.total = projected.total;
  state.last_decision = kind;
  state.last_at = new Date().toISOString();
  state.history.push({ ts: state.last_at, kind, summary: note || '' });
  save(slug, state);
  dualSyncLoop(slug, state.total);
  return state;
}

function get(slug) {
  const state = load(slug);
  if (!state) {
    process.stderr.write(`validate-loop-state: no state for '${slug}' — call 'init' first\n`);
    process.exit(1);
  }
  return state;
}

function reset(slug) {
  const p = statePath(slug);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  dualSyncLoop(slug, 0);
  return { slug, reset: true };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const slug = args[1];
  if (!cmd || !slug) {
    process.stderr.write('validate-loop-state: usage: <init|incr|get|reset> <slug> [kind] [--note "..."]\n');
    process.exit(1);
  }
  try {
    let result;
    if (cmd === 'init') result = init(slug);
    else if (cmd === 'incr') {
      const kind = args[2];
      const noteIdx = args.indexOf('--note');
      const note = noteIdx >= 0 ? args[noteIdx + 1] : null;
      result = incr(slug, kind, note);
    } else if (cmd === 'get') result = get(slug);
    else if (cmd === 'reset') result = reset(slug);
    else {
      process.stderr.write(`validate-loop-state: unknown command '${cmd}'\n`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write(`validate-loop-state: ${e.message}\n`);
    process.exit(1);
  }
}

main();
