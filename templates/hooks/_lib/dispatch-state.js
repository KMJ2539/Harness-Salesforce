'use strict';
// harness-sf dispatch state — machine-readable record of /sf-feature Step 6 progress.
//
// Why this exists:
//   /sf-feature dispatches N artifact-level sub-skills in dependency order. If the
//   session ends mid-dispatch, or the model forgets to update design.md `## Dispatch
//   Log`, the orchestration state is lost. This file is the source of truth that
//   /sf-feature reads on resume and statusline.js renders progress from.
//
// Path: .harness-sf/.cache/dispatch-state/<feature-slug>.json
// Schema:
//   {
//     feature: string,                       // slug
//     design_path: string,                   // relative path to feature design.md
//     started_at: ISO8601,
//     current_index: number,                 // index into artifacts[], -1 if done
//     artifacts: [
//       {
//         id: string,                        // artifact ID from design.md
//         type: string,                      // sobject|field|apex|lwc|aura|...
//         sub_skill: string|null,            // /sf-apex etc., null for guidance-only
//         status: 'pending'|'in_progress'|'done'|'failed'|'skipped',
//         started_at: ISO8601|null,
//         completed_at: ISO8601|null,
//         error: string|null,
//       }, ...
//     ],
//   }
//
// Public API:
//   - statePath(slug) → absolute path
//   - readState(slug) → parsed JSON or null
//   - writeState(slug, data) → persists
//   - initState(slug, designPath, artifacts) → create new state file
//   - updateArtifact(slug, id, patch) → merge patch into matching artifact
//   - summary(state) → '{done}/{total}' string for statusline

const fs = require('fs');
const path = require('path');
const sentinelLib = require('./sentinel');

const KIND = 'dispatch-state';

function stateDir() {
  return path.join(sentinelLib.cwd(), '.harness-sf', '.cache', KIND);
}

function statePath(slug) {
  if (!slug || /[\\/]/.test(slug)) throw new Error(`invalid feature slug: ${slug}`);
  return path.join(stateDir(), `${slug}.json`);
}

function readState(slug) {
  const p = statePath(slug);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeState(slug, data) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(slug), JSON.stringify(data, null, 2) + '\n');
  return data;
}

function initState(slug, designPath, artifacts) {
  if (!Array.isArray(artifacts)) throw new Error('artifacts must be an array');
  const data = {
    feature: slug,
    design_path: designPath,
    started_at: new Date().toISOString(),
    current_index: 0,
    artifacts: artifacts.map(a => ({
      id: a.id,
      type: a.type,
      sub_skill: a.sub_skill || null,
      status: 'pending',
      started_at: null,
      completed_at: null,
      error: null,
    })),
  };
  return writeState(slug, data);
}

function updateArtifact(slug, id, patch) {
  const state = readState(slug);
  if (!state) throw new Error(`no dispatch state for feature '${slug}'`);
  const idx = state.artifacts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`artifact '${id}' not found in feature '${slug}'`);
  state.artifacts[idx] = { ...state.artifacts[idx], ...patch };

  // Maintain current_index: point at first non-terminal artifact, or -1 if all done.
  const terminal = new Set(['done', 'failed', 'skipped']);
  const next = state.artifacts.findIndex(a => !terminal.has(a.status));
  state.current_index = next;

  return writeState(slug, state);
}

function summary(state) {
  if (!state || !Array.isArray(state.artifacts)) return null;
  const done = state.artifacts.filter(a => a.status === 'done').length;
  const failed = state.artifacts.filter(a => a.status === 'failed').length;
  const total = state.artifacts.length;
  return { done, failed, total, label: `${done}/${total}${failed ? `!${failed}` : ''}` };
}

function listStates() {
  const dir = stateDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      slug: f.replace(/\.json$/, ''),
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

module.exports = {
  statePath,
  readState,
  writeState,
  initState,
  updateArtifact,
  summary,
  listStates,
};
