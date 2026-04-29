#!/usr/bin/env node
// harness-sf — CLI for dispatch-state.js, called by /sf-feature Step 6.
//
// Usage:
//   init <slug> <design-path> <artifacts-json>
//     artifacts-json: '[{"id":"order-sobject","type":"sobject","sub_skill":"/sf-sobject"}, ...]'
//   start <slug> <artifact-id>
//   done <slug> <artifact-id>
//   fail <slug> <artifact-id> "<error-summary>"
//   skip <slug> <artifact-id> "<reason>"
//   status <slug>            → prints summary
//
// All commands write to .harness-sf/.cache/dispatch-state/<slug>.json

'use strict';
const fs = require('fs');
const path = require('path');
const ds = require('./dispatch-state');

// PR B — dual-write to new .harness-sf/state/<slug>__r<rev>.json when present.
// Best-effort: if state.json doesn't exist yet, legacy remains authoritative.
let store;
try { store = require('./state/store'); } catch { store = null; }

function findStateRevision(slug) {
  if (!store) return null;
  const dir = path.join(process.cwd(), '.harness-sf', 'state');
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir)
    .map(f => f.match(new RegExp(`^${slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}__r(\\d+)\\.json$`)))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => b - a);
  return matches[0] || null;
}

function dualUpdateArtifact(slug, id, patch) {
  const rev = findStateRevision(slug);
  if (!store || rev === null) return;
  try {
    store.writeState(slug, rev, (cur) => {
      if (!cur) return null;
      const next = JSON.parse(JSON.stringify(cur));
      const idx = next.artifacts.findIndex(a => a.id === id);
      if (idx === -1) return null;
      const target = next.artifacts[idx];
      if (patch.status) target.status = patch.status;
      if (patch.completed_at !== undefined) target.completed_at = patch.completed_at;
      // legacy 'error' field has no equivalent in canonical schema — silently dropped.
      return next;
    }, { operation: `dispatch-state:dual-update ${id}` });
  } catch {
    // dual-write best-effort. Legacy already succeeded above; do not propagate.
  }
}

const [, , cmd, ...rest] = process.argv;

function fail(msg) {
  process.stderr.write(`dispatch-state: ${msg}\n`);
  process.exit(1);
}

function nowIso() { return new Date().toISOString(); }

try {
  switch (cmd) {
    case 'init': {
      const [slug, designPath, artifactsJson] = rest;
      if (!slug || !designPath || !artifactsJson) fail('init requires <slug> <design-path> <artifacts-json>');
      let artifacts;
      try { artifacts = JSON.parse(artifactsJson); }
      catch (e) { fail(`artifacts-json parse error: ${e.message}`); }
      const state = ds.initState(slug, designPath, artifacts);
      process.stdout.write(`init dispatch ${slug}: ${state.artifacts.length} artifacts\n`);
      break;
    }
    case 'start': {
      const [slug, id] = rest;
      if (!slug || !id) fail('start requires <slug> <artifact-id>');
      ds.updateArtifact(slug, id, { status: 'in_progress', started_at: nowIso(), error: null });
      dualUpdateArtifact(slug, id, { status: 'in_progress' });
      process.stdout.write(`start ${slug}/${id}\n`);
      break;
    }
    case 'done': {
      const [slug, id] = rest;
      if (!slug || !id) fail('done requires <slug> <artifact-id>');
      const ts = nowIso();
      ds.updateArtifact(slug, id, { status: 'done', completed_at: ts, error: null });
      dualUpdateArtifact(slug, id, { status: 'done', completed_at: ts });
      process.stdout.write(`done ${slug}/${id}\n`);
      break;
    }
    case 'fail': {
      const [slug, id, ...errParts] = rest;
      if (!slug || !id) fail('fail requires <slug> <artifact-id> <error-summary>');
      const err = errParts.join(' ').trim() || 'unspecified failure';
      const ts = nowIso();
      ds.updateArtifact(slug, id, { status: 'failed', completed_at: ts, error: err });
      dualUpdateArtifact(slug, id, { status: 'failed', completed_at: ts });
      process.stdout.write(`fail ${slug}/${id}: ${err}\n`);
      break;
    }
    case 'skip': {
      const [slug, id, ...reasonParts] = rest;
      if (!slug || !id) fail('skip requires <slug> <artifact-id> <reason>');
      const reason = reasonParts.join(' ').trim() || 'skipped';
      const ts = nowIso();
      ds.updateArtifact(slug, id, { status: 'skipped', completed_at: ts, error: reason });
      dualUpdateArtifact(slug, id, { status: 'skipped', completed_at: ts });
      process.stdout.write(`skip ${slug}/${id}: ${reason}\n`);
      break;
    }
    case 'status': {
      const [slug] = rest;
      if (!slug) fail('status requires <slug>');
      const state = ds.readState(slug);
      if (!state) fail(`no state for ${slug}`);
      const s = ds.summary(state);
      process.stdout.write(`${slug}: ${s.label} (current_index=${state.current_index})\n`);
      for (const a of state.artifacts) {
        process.stdout.write(`  [${a.status}] ${a.id} (${a.type})${a.error ? ` — ${a.error}` : ''}\n`);
      }
      break;
    }
    default:
      fail(`unknown command '${cmd || ''}' — use init|start|done|fail|skip|status`);
  }
  process.exit(0);
} catch (e) {
  fail(e.message);
}
