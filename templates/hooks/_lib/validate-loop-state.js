#!/usr/bin/env node
// harness-sf — iteration cap tracking for /sf-feature Step 7.5 deploy-validate
// auto-loop. Prevents infinite fix loops and bounds total cost.
//
// PR (post-E) — canonical-only. Reads/writes state.loop.{iteration,
// last_error_class} in .harness-sf/state/<slug>__r<rev>.json. Legacy
// .harness-sf/.cache/validate-loop/ is no longer written. Per-kind counts
// (code-fix vs design-fix) are no longer persisted across calls — the
// canonical schema tracks total iteration only (cap = 4).
//
// Usage:
//   node validate-loop-state.js init <slug>
//   node validate-loop-state.js incr <slug> <kind: code-fix|design-fix> [--note "..."]
//   node validate-loop-state.js get <slug>
//   node validate-loop-state.js reset <slug>

'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./state/store');

const TOTAL_CAP = 4;
const VALID_KINDS = new Set(['code-fix', 'design-fix']);
const KIND_TO_ERROR_CLASS = {
  'code-fix': 'mechanical',
  'design-fix': 'logical',
};

function fail(msg, code) {
  process.stderr.write(`validate-loop-state: ${msg}\n`);
  process.exit(code || 1);
}

function findRevision(slug) {
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

function init(slug) {
  const rev = findRevision(slug);
  if (rev === null) fail(`no canonical state for slug '${slug}'`, 2);
  store.writeState(slug, rev, (cur) => {
    if (!cur) return null;
    const copy = JSON.parse(JSON.stringify(cur));
    copy.loop = { iteration: 0, last_error_class: null };
    return copy;
  }, { operation: 'loop:init' });
  return { slug, iteration: 0, last_error_class: null };
}

function incr(slug, kind /* , note */) {
  if (!VALID_KINDS.has(kind)) fail(`invalid kind '${kind}' — allowed: ${[...VALID_KINDS].join('|')}`);
  const rev = findRevision(slug);
  if (rev === null) fail(`no canonical state for slug '${slug}'`, 2);

  let result = null;
  store.writeState(slug, rev, (cur) => {
    if (!cur) return null;
    const copy = JSON.parse(JSON.stringify(cur));
    copy.loop = copy.loop || { iteration: 0, last_error_class: null };
    const next = copy.loop.iteration + 1;
    if (next > TOTAL_CAP) {
      // Don't mutate — caller decides via stderr + exit code.
      result = { capped: true, iteration: copy.loop.iteration, kind };
      return null; // abort write
    }
    copy.loop.iteration = next;
    copy.loop.last_error_class = KIND_TO_ERROR_CLASS[kind];
    result = { capped: false, iteration: next, kind, last_error_class: copy.loop.last_error_class };
    return copy;
  }, { operation: `loop:incr ${kind}` });

  if (result && result.capped) {
    process.stderr.write(`validate-loop-state: cap exceeded (would be ${result.iteration + 1} > ${TOTAL_CAP}) — abort auto-loop, hand to user\n`);
    process.exit(1);
  }
  return result;
}

function get(slug) {
  const rev = findRevision(slug);
  if (rev === null) fail(`no canonical state for slug '${slug}'`, 2);
  const cur = store.readState(slug, rev);
  if (!cur) fail(`state vanished between read and read`, 2);
  return {
    slug,
    iteration: cur.state.loop ? cur.state.loop.iteration : 0,
    last_error_class: cur.state.loop ? cur.state.loop.last_error_class : null,
  };
}

function reset(slug) {
  init(slug);
  return { slug, reset: true };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const slug = args[1];
  if (!cmd || !slug) fail('usage: <init|incr|get|reset> <slug> [kind] [--note "..."]');
  try {
    let result;
    if (cmd === 'init') result = init(slug);
    else if (cmd === 'incr') {
      const kind = args[2];
      result = incr(slug, kind);
    } else if (cmd === 'get') result = get(slug);
    else if (cmd === 'reset') result = reset(slug);
    else fail(`unknown command '${cmd}'`);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (e) {
    fail(e.message);
  }
}

main();
