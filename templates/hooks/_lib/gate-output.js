'use strict';
// harness-sf — standardized gate-block output (P2).
//
// Every blocking gate hook emits the same 5-field block on stderr so the user
// always sees: what was blocked, why, the concrete next action, where to look,
// and whether/how an override is possible.
//
// Format:
//   Blocked: <one-line reason>
//   Why:     <root cause / referenced rule>
//   Fix:     <concrete next command or edit>
//   File:    <path:line or sentinel path>
//   Override: <command/env or 'N/A — fix the underlying issue'>
//
// Multi-line `fix` is allowed: subsequent lines are indented under `Fix:`.
//
// Usage:
//   const { formatBlock, emitBlock } = require('./gate-output');
//   emitBlock({
//     reason: 'deploy fingerprint missing or expired',
//     why:    'pre-deploy-gate requires a fresh validate-only fingerprint',
//     fix:    'run sf-deploy-validator (validate-only) then retry the deploy',
//     file:   '.harness-sf/last-validation.json',
//     override: 'HARNESS_OVERRIDE=deploy with audit reason',
//   });
//   process.exit(2);

const REQUIRED = ['reason', 'why', 'fix', 'file', 'override'];

function assertField(name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`gate-output: '${name}' is required (non-empty string)`);
  }
}

function formatBlock(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('gate-output: fields object is required');
  }
  for (const k of REQUIRED) assertField(k, fields[k]);

  const fixLines = String(fields.fix).split(/\r?\n/);
  const fixHead = fixLines[0];
  const fixTail = fixLines.slice(1).map(l => `         ${l}`); // 9-space indent under "Fix:     "

  const out = [
    `Blocked: ${fields.reason}`,
    `Why:     ${fields.why}`,
    `Fix:     ${fixHead}`,
    ...fixTail,
    `File:    ${fields.file}`,
    `Override: ${fields.override}`,
  ];
  return out.join('\n') + '\n';
}

function emitBlock(fields, stream) {
  const s = stream || process.stderr;
  s.write(formatBlock(fields));
}

module.exports = { formatBlock, emitBlock };
