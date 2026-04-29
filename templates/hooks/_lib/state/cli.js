'use strict';
// hsf state <subcommand> — wraps store.js for shell/skill use.
// Per .harness-sf/designs/2026-04-29-state-consolidation-v3.md (PR A).
//
// Subcommands (PR A — minimum viable set; more in PR B/C):
//   init <slug> <design-path> <design-revision> <design-body-hash> <artifacts-json>
//   read <slug> <design-revision>
//   set <slug> <design-revision> <key.path> <json-value>
//   advance-step <slug> <design-revision> <new-step>     [transition guard]
//   force-set <slug> <design-revision> <key.path> <json-value> --reason="..."
//
// Artifacts JSON: '[{"id":"A1","type":"sobject"},{"id":"A2","type":"apex","depends_on":["A1"]}]'

const store = require('./store');
const { validate } = require('./validator');

function fail(msg, code) {
  process.stderr.write(`hsf state: ${msg}\n`);
  process.exit(code || 1);
}

process.on('uncaughtException', (e) => {
  process.stderr.write(`hsf state: ${e.message}\n`);
  process.exit(1);
});

const TRANSITIONS = {
  '1': ['2', '8'],
  '2': ['3'],
  '3': ['4'],
  '4': ['5'],
  '5': ['6', '7', '3'],
  '6': ['7'],
  '7': ['7.deploy-validate'],
  '7.deploy-validate': ['7.code-fix', '7.design-fix', '8'],
  '7.code-fix': ['7.deploy-validate'],
  '7.design-fix': ['3'],
  '8': [],
};

function setNested(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

function parseInteger(s, name) {
  const n = parseInt(s, 10);
  if (!Number.isInteger(n) || n < 1) fail(`${name} must be positive integer`);
  return n;
}

if (cmd === 'init') {
  const [, slug, designPath, designRevisionStr, designBodyHash, artifactsJson] = argv;
  if (!slug || !designPath || !designRevisionStr || !designBodyHash || !artifactsJson) {
    fail('init requires: <slug> <design-path> <design-revision> <design-body-hash> <artifacts-json>');
  }
  const designRevision = parseInteger(designRevisionStr, 'design-revision');
  let artifacts;
  try { artifacts = JSON.parse(artifactsJson); } catch (e) { fail(`artifacts json parse: ${e.message}`); }
  if (!Array.isArray(artifacts)) fail('artifacts must be JSON array');
  const initial = {
    schema_version: 1,
    version: 1,
    slug,
    design_path: designPath,
    design_revision: designRevision,
    design_body_hash: designBodyHash,
    lock: null,
    current_step: '1',
    entered_via: 'full',
    artifacts: artifacts.map(a => ({
      id: a.id,
      type: a.type,
      status: 'pending',
      completed_at: null,
      depends_on: a.depends_on || [],
    })),
    deploy: { last_validation: null, findings: [] },
    loop: { iteration: 0, last_error_class: null },
    override_active_session: null,
    override_history: [],
  };
  const v = validate(initial);
  if (!v.ok) fail('initial state failed validation:\n  - ' + v.errors.join('\n  - '));
  store.writeState(slug, designRevision, () => initial, { operation: 'state:init' });
  process.stdout.write(`init state: ${store.stateFilePath(slug, designRevision)} (artifacts=${artifacts.length})\n`);
  process.exit(0);
}

if (cmd === 'read') {
  const [, slug, designRevisionStr] = argv;
  if (!slug || !designRevisionStr) fail('read requires: <slug> <design-revision>');
  const designRevision = parseInteger(designRevisionStr, 'design-revision');
  const cur = store.readState(slug, designRevision);
  if (!cur) fail(`no state for ${slug}__r${designRevision}`, 2);
  process.stdout.write(JSON.stringify(cur.state, null, 2) + '\n');
  process.exit(0);
}

if (cmd === 'set' || cmd === 'force-set') {
  const [, slug, designRevisionStr, keyPath, jsonValue, ...rest] = argv;
  if (!slug || !designRevisionStr || !keyPath || jsonValue === undefined) {
    fail(`${cmd} requires: <slug> <design-revision> <key.path> <json-value>`);
  }
  const designRevision = parseInteger(designRevisionStr, 'design-revision');
  let value;
  try { value = JSON.parse(jsonValue); } catch (e) { fail(`json-value parse: ${e.message}`); }

  if (cmd === 'force-set') {
    const reasonArg = rest.find(s => s.startsWith('--reason='));
    if (!reasonArg) fail('force-set requires --reason="..." (>= 8 non-whitespace chars)');
    const reason = reasonArg.slice('--reason='.length);
    if (reason.replace(/\s/g, '').length < 8) fail('reason must have >= 8 non-whitespace chars');
  }

  const next = store.writeState(slug, designRevision, (cur) => {
    if (!cur) {
      process.stderr.write(`hsf state: no state for ${slug}__r${designRevision} — run 'hsf state init' first\n`);
      return null;
    }
    const copy = JSON.parse(JSON.stringify(cur));
    setNested(copy, keyPath, value);
    return copy;
  }, { operation: `state:${cmd} ${keyPath}` });
  if (!next) process.exit(1);
  process.stdout.write(`${cmd}: ${slug}__r${designRevision}.${keyPath} = ${JSON.stringify(value)} (version=${next.version})\n`);
  process.exit(0);
}

if (cmd === 'migrate-from-v1') {
  const { migrateFeature } = require('./migrate');
  const slug = argv[1];
  if (!slug) fail('migrate-from-v1 requires: <slug> [--design-path <path>] [--dry-run]');
  const designPathArg = argv.find(a => a.startsWith('--design-path='));
  const designPath = designPathArg ? designPathArg.slice('--design-path='.length) : null;
  const dryRun = argv.includes('--dry-run');

  const result = migrateFeature({ slug, designPath, dryRun });
  for (const w of result.warnings || []) process.stderr.write(`  warning: ${w}\n`);
  for (const e of result.errors || []) process.stderr.write(`  error: ${e}\n`);
  if (!result.ok) process.exit(2);
  if (dryRun) {
    process.stdout.write(`migrate (dry-run) → ${result.statePath}\n`);
    process.stdout.write(JSON.stringify(result.dryRunState, null, 2) + '\n');
  } else {
    process.stdout.write(`migrate-from-v1: ${result.statePath} written\n`);
  }
  process.exit(0);
}

if (cmd === 'advance-step') {
  const [, slug, designRevisionStr, newStep] = argv;
  if (!slug || !designRevisionStr || !newStep) fail('advance-step requires: <slug> <design-revision> <new-step>');
  const designRevision = parseInteger(designRevisionStr, 'design-revision');

  const next = store.writeState(slug, designRevision, (cur) => {
    if (!cur) {
      process.stderr.write(`hsf state: no state for ${slug}__r${designRevision}\n`);
      return null;
    }
    const allowed = TRANSITIONS[cur.current_step];
    if (!allowed) {
      process.stderr.write(`hsf state: unknown current_step '${cur.current_step}'\n`);
      return null;
    }
    if (!allowed.includes(newStep)) {
      process.stderr.write(`hsf state: transition from '${cur.current_step}' to '${newStep}' not allowed. Valid next: [${allowed.join(', ')}]. Use 'hsf state force-set current_step ... --reason=...' if needed.\n`);
      return null;
    }
    const copy = JSON.parse(JSON.stringify(cur));
    copy.current_step = newStep;
    return copy;
  }, { operation: `state:advance-step ${newStep}` });
  if (!next) process.exit(2);
  process.stdout.write(`advance-step: ${slug}__r${designRevision} -> ${newStep} (version=${next.version})\n`);
  process.exit(0);
}

fail(`unknown subcommand: ${cmd || '(none)'}. Supported: init | read | set | force-set | advance-step | migrate-from-v1`, 2);
