#!/usr/bin/env node
// harness-sf — dispatch lifecycle CLI for /sf-feature.
//
// PR (post-E) — canonical-only rewrite. Reads/writes
// .harness-sf/state/<slug>__r<rev>.json via _lib/state/store. The legacy
// .harness-sf/.cache/dispatch-state/ path was removed; dispatch-state.js is
// no longer required and has been deleted.
//
// Usage:
//   init <slug> <design-path> <artifacts-json>
//     artifacts-json: '[{"id":"A1","type":"sobject","sub_skill":"/sf-sobject"}, ...]'
//     (sub_skill is recorded for skill-side use but not stored in canonical
//      state — sub-skills resolve their own command from artifact.type.)
//   start  <slug> <artifact-id>
//   done   <slug> <artifact-id>
//   fail   <slug> <artifact-id> "<error-summary>"
//   skip   <slug> <artifact-id> "<reason>"
//   status <slug>            → prints summary
//   reset  <slug> <artifact-id> [...]   → mark each as 'pending' again

'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./state/store');
const { bodyHash } = require('./state/body-hash');

function fail(msg, code) {
  process.stderr.write(`dispatch-state: ${msg}\n`);
  process.exit(code || 1);
}

function nowIso() { return new Date().toISOString(); }

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return fm;
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

function patchArtifact(slug, id, patch) {
  const rev = findRevision(slug);
  if (rev === null) fail(`no canonical state for slug '${slug}' — run 'init' first`, 2);
  const next = store.writeState(slug, rev, (cur) => {
    if (!cur) return null;
    const copy = JSON.parse(JSON.stringify(cur));
    const idx = copy.artifacts.findIndex(a => a.id === id);
    if (idx === -1) {
      process.stderr.write(`dispatch-state: artifact '${id}' not found in slug '${slug}'\n`);
      return null;
    }
    Object.assign(copy.artifacts[idx], patch);
    return copy;
  }, { operation: `dispatch:${patch.status || 'patch'} ${id}` });
  if (!next) process.exit(2);
  return next;
}

const [, , cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'init': {
      const [slug, designPath, artifactsJson] = rest;
      if (!slug || !designPath || !artifactsJson) fail('init requires <slug> <design-path> <artifacts-json>');
      let inputArtifacts;
      try { inputArtifacts = JSON.parse(artifactsJson); }
      catch (e) { fail(`artifacts-json parse: ${e.message}`); }
      if (!Array.isArray(inputArtifacts)) fail('artifacts-json must be array');

      const designAbs = path.isAbsolute(designPath) ? designPath : path.resolve(process.cwd(), designPath);
      if (!fs.existsSync(designAbs)) fail(`design.md not found: ${designPath}`);
      const designText = fs.readFileSync(designAbs, 'utf8');
      const fm = parseFrontmatter(designText);
      const designRevision = parseInt(fm.revision || '1', 10) || 1;
      const designBodyHash = bodyHash(designText);
      const designRel = path.relative(process.cwd(), designAbs).split(path.sep).join('/');

      if (store.readState(slug, designRevision)) {
        fail(`state already exists for ${slug}__r${designRevision} — use 'reset' or remove the file manually`, 3);
      }

      const initial = {
        schema_version: 1,
        version: 1,
        slug,
        design_path: designRel,
        design_revision: designRevision,
        design_body_hash: designBodyHash,
        lock: null,
        current_step: '7',
        entered_via: 'full',
        artifacts: inputArtifacts.map(a => ({
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
      store.writeState(slug, designRevision, () => initial, { operation: 'dispatch:init' });
      process.stdout.write(`init dispatch ${slug}__r${designRevision}: ${initial.artifacts.length} artifacts\n`);
      break;
    }
    case 'start': {
      const [slug, id] = rest;
      if (!slug || !id) fail('start requires <slug> <artifact-id>');
      patchArtifact(slug, id, { status: 'in_progress' });
      process.stdout.write(`start ${slug}/${id}\n`);
      break;
    }
    case 'done': {
      const [slug, id] = rest;
      if (!slug || !id) fail('done requires <slug> <artifact-id>');
      patchArtifact(slug, id, { status: 'done', completed_at: nowIso() });
      process.stdout.write(`done ${slug}/${id}\n`);
      break;
    }
    case 'fail': {
      const [slug, id, ...errParts] = rest;
      if (!slug || !id) fail('fail requires <slug> <artifact-id> <error-summary>');
      const _err = errParts.join(' ').trim() || 'unspecified failure';
      // Note: canonical schema does not store an 'error' string; the failure
      // is the 'failed' status. /sf-feature is expected to record the error
      // text separately in design.md '## Dispatch Log'.
      patchArtifact(slug, id, { status: 'failed', completed_at: nowIso() });
      process.stdout.write(`fail ${slug}/${id}: ${_err}\n`);
      break;
    }
    case 'skip': {
      const [slug, id, ...reasonParts] = rest;
      if (!slug || !id) fail('skip requires <slug> <artifact-id> <reason>');
      const _reason = reasonParts.join(' ').trim() || 'skipped';
      patchArtifact(slug, id, { status: 'skipped', completed_at: nowIso() });
      process.stdout.write(`skip ${slug}/${id}: ${_reason}\n`);
      break;
    }
    case 'reset': {
      const [slug, ...ids] = rest;
      if (!slug || !ids.length) fail('reset requires <slug> <artifact-id> [...]');
      const rev = findRevision(slug);
      if (rev === null) fail(`no canonical state for slug '${slug}'`, 2);
      store.writeState(slug, rev, (cur) => {
        if (!cur) return null;
        const copy = JSON.parse(JSON.stringify(cur));
        for (const id of ids) {
          const idx = copy.artifacts.findIndex(a => a.id === id);
          if (idx === -1) {
            process.stderr.write(`dispatch-state: artifact '${id}' not found — skipped\n`);
            continue;
          }
          copy.artifacts[idx].status = 'pending';
          copy.artifacts[idx].completed_at = null;
        }
        return copy;
      }, { operation: `dispatch:reset ${ids.join(',')}` });
      process.stdout.write(`reset ${slug}: ${ids.join(', ')}\n`);
      break;
    }
    case 'status': {
      const [slug] = rest;
      if (!slug) fail('status requires <slug>');
      const rev = findRevision(slug);
      if (rev === null) fail(`no canonical state for slug '${slug}'`, 2);
      const cur = store.readState(slug, rev);
      const total = cur.state.artifacts.length;
      const done = cur.state.artifacts.filter(a => a.status === 'done').length;
      const failed = cur.state.artifacts.filter(a => a.status === 'failed').length;
      process.stdout.write(`${slug}__r${rev}: ${done}/${total}${failed ? `!${failed}` : ''} (step=${cur.state.current_step}, version=${cur.version})\n`);
      for (const a of cur.state.artifacts) {
        process.stdout.write(`  [${a.status}] ${a.id} (${a.type})\n`);
      }
      break;
    }
    default:
      fail(`unknown command '${cmd || ''}' — use init|start|done|fail|skip|status|reset`);
  }
  process.exit(0);
} catch (e) {
  fail(e.message);
}
