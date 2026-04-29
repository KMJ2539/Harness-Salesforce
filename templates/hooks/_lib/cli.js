#!/usr/bin/env node
// harness-sf unified CLI — single entrypoint for all _lib/* commands.
//
// Per design 2026-04-29-state-consolidation.md (revision 2):
//   PR 1 — this file + commands/* skeleton, single-script shims forward here.
//   PR 2 — frontmatter state schema + state/* modules.
//   PR 3 — gates read from frontmatter, deprecate .harness-sf/.cache/* state.
//   PR 4 — SKILL.md call sites switch to ${HSF_CLI}.
//   PR 5 — remove forward shims.
//
// Usage:
//   node cli.js <namespace> <command> [args...]
//
// Namespaces (skeleton — most are forward-only in PR 1):
//   design     validate | approve | revoke
//   dispatch   init | start | done | fail | skip | status
//   modify     issue | check
//   delegated  issue | check
//   deploy     classify | verify-fix
//   loop       state
//   score      <design-path>
//   context    <slug>
//   audit      verify
//
// Zero-dep — Node 18+ stdlib only.

'use strict';

const path = require('path');

function fail(msg, code) {
  process.stderr.write(`hsf: ${msg}\n`);
  process.exit(code || 1);
}

const ROUTES = {
  // namespace → command → forward target (relative to _lib/)
  design: {
    validate: './validate-design.js',
    approve:  './issue-design-approval.js',
    revoke:   null, // PR 2: implement design-revoke
  },
  dispatch: {
    init:    './dispatch-state-cli.js',
    start:   './dispatch-state-cli.js',
    done:    './dispatch-state-cli.js',
    fail:    './dispatch-state-cli.js',
    skip:    './dispatch-state-cli.js',
    status:  './dispatch-state-cli.js',
  },
  modify: {
    issue: './issue-modify-approval.js',
    check: null, // existing pre-modify-approval-gate.js is hook-shaped, not CLI
  },
  delegated: {
    issue: './issue-delegated-token.js',
    check: './check-delegated-token.js',
  },
  deploy: {
    classify:    './classify-deploy-error.js',
    'verify-fix': './verify-fix-against-design.js',
  },
  loop: {
    state: './validate-loop-state.js',
  },
  score:   { _direct: './score-cli.js' },
  context: { _direct: './check-feature-context.js' },
  audit: {
    verify: './audit-cli.js',
    tail:   './audit-cli.js',
    append: './audit-cli.js',
  },
  // PR A — state-consolidation v3 foundation.
  state: {
    init:              './state/cli.js',
    read:              './state/cli.js',
    set:               './state/cli.js',
    'force-set':       './state/cli.js',
    'advance-step':    './state/cli.js',
    'migrate-from-v1': './state/cli.js',
  },
  doctor: { _direct: './state/doctor.js' },
};

function showHelp() {
  process.stdout.write([
    'hsf — harness-sf unified CLI',
    '',
    'Usage:',
    '  node cli.js <namespace> <command> [args...]',
    '  node cli.js <namespace> [args...]    (for direct namespaces: score, context)',
    '',
    'Namespaces:',
    ...Object.keys(ROUTES).map(n => '  ' + n),
    '',
    'See .harness-sf/designs/2026-04-29-state-consolidation.md for the full plan.',
    '',
  ].join('\n'));
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  showHelp();
  process.exit(0);
}

const ns = argv[0];
const route = ROUTES[ns];
if (!route) fail(`unknown namespace: ${ns}. Run with --help.`, 2);

let target;
let forwardArgs;

if (route._direct) {
  // Direct namespace — first arg goes straight to the target.
  target = route._direct;
  forwardArgs = argv.slice(1);
} else {
  const cmd = argv[1];
  if (!cmd) fail(`namespace ${ns} requires a command. Available: ${Object.keys(route).join(', ')}`, 2);
  if (!(cmd in route)) fail(`unknown command: ${ns} ${cmd}`, 2);
  target = route[cmd];
  if (!target) fail(`${ns} ${cmd} is not implemented yet (planned in a later PR).`, 3);
  // For dispatch / state / audit namespaces the underlying CLI expects subcommand as first arg.
  if (ns === 'dispatch' || ns === 'state' || ns === 'audit') {
    forwardArgs = [cmd, ...argv.slice(2)];
  } else {
    forwardArgs = argv.slice(2);
  }
}

// Forward via require — keeps single process, preserves exit codes when targets call process.exit.
const targetPath = path.join(__dirname, target);
process.argv = [process.argv[0], targetPath, ...forwardArgs];
require(targetPath);
