'use strict';
// hsf audit <subcommand> — append-only log inspection.
// Per gate-hardening v3.
//
// Subcommands:
//   verify                            → check hash chain, exit 1 on tamper
//   tail [n]                          → print last N entries (default 20)
//   append <gate> <scope> <reason> [--slug <s>] [--session-id <id>]
//                                     → append a line manually (used by hook
//                                       integrations once override scope is wired)

const audit = require('./audit');

function fail(msg, code) {
  process.stderr.write(`hsf audit: ${msg}\n`);
  process.exit(code || 1);
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  process.stdout.write('hsf audit verify | tail [n] | append <gate> <scope> <reason> [--slug <s>]\n');
  process.exit(0);
}

if (cmd === 'verify') {
  const r = audit.verify();
  if (r.ok) {
    process.stdout.write(`audit verify: ok (${r.total} lines)\n`);
    process.exit(0);
  } else {
    process.stderr.write(`audit verify: TAMPERED at line ${r.broken_at}/${r.total} — ${r.reason}\n`);
    process.exit(1);
  }
}

if (cmd === 'tail') {
  const n = argv[1] ? parseInt(argv[1], 10) : 20;
  if (!Number.isFinite(n) || n < 1) fail('tail count must be positive integer');
  const lines = audit.tail(n);
  if (!lines.length) {
    process.stdout.write('audit log is empty\n');
    process.exit(0);
  }
  for (const l of lines) {
    process.stdout.write(`${l.ts}  ${l.gate.padEnd(16)}  ${(l.slug || '-').padEnd(16)}  ${l.scope.padEnd(8)}  ${l.reason}\n`);
  }
  process.exit(0);
}

if (cmd === 'append') {
  const [, gate, scope, ...rest] = argv;
  if (!gate || !scope) fail('append requires: <gate> <scope> <reason> [--slug <s>] [--session-id <id>]');
  const slugIdx = rest.indexOf('--slug');
  const sessionIdx = rest.indexOf('--session-id');
  const flagPositions = new Set();
  if (slugIdx !== -1) { flagPositions.add(slugIdx); flagPositions.add(slugIdx + 1); }
  if (sessionIdx !== -1) { flagPositions.add(sessionIdx); flagPositions.add(sessionIdx + 1); }
  const slug = slugIdx !== -1 ? rest[slugIdx + 1] : '';
  const sessionId = sessionIdx !== -1 ? rest[sessionIdx + 1] : '';
  const reasonParts = rest.filter((_, i) => !flagPositions.has(i));
  const reason = reasonParts.join(' ').trim();
  if (!reason) fail('reason is required');
  try {
    const entry = audit.append({ gate, slug, scope, reason, session_id: sessionId });
    process.stdout.write(`audit append: ${entry.gate}/${entry.scope} sha=${entry.sha.slice(0, 12)}…\n`);
    process.exit(0);
  } catch (e) {
    fail(e.message);
  }
}

fail(`unknown subcommand: ${cmd}. Try --help.`, 2);
