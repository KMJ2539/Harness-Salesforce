'use strict';
// One-shot migration: legacy .harness-sf/.cache/* → new .harness-sf/state/<slug>__r<rev>.json.
//
// Sources:
//   .harness-sf/.cache/dispatch-state/<slug>.json    (artifacts, started_at)
//   .harness-sf/.cache/validate-loop/<slug>.json     (loop iteration + last error class)
//   .harness-sf/.cache/deploy-findings/<slug>.json   (deploy.findings)
//   <design-path>                                     (revision + body_hash + entered_via fallback)
//
// Output: validated state.json via store.writeState.
//
// API:
//   migrateFeature({ slug, designPath?, dryRun? }) → result object
//     result: { ok, statePath, written, warnings: [], errors: [] }

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { bodyHash } = require('./body-hash');

function readJSONIfExists(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function readDesign(designPath) {
  if (!fs.existsSync(designPath)) return null;
  const text = fs.readFileSync(designPath, 'utf8');
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return { text, fm };
}

function findDesignForSlug(cwd, slug) {
  const dir = path.join(cwd, '.harness-sf', 'designs');
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f.includes(slug))
    .map(f => path.join(dir, f));
  if (!candidates.length) return null;
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

const TYPE_REMAP = {
  // dispatch-state used arbitrary type strings; map to canonical state-schema enum.
  'sobject': 'sobject',
  'field': 'field',
  'apex': 'apex',
  'lwc': 'lwc',
  'aura': 'aura',
  'permission-set': 'permission-set',
  'permissionset': 'permission-set',
  'flow': 'flow',
};

function mapArtifactType(t, warnings) {
  const m = TYPE_REMAP[t];
  if (!m) {
    warnings.push(`unknown legacy artifact type '${t}' — defaulting to 'apex'`);
    return 'apex';
  }
  return m;
}

const STATUS_REMAP = {
  'pending': 'pending',
  'in_progress': 'in_progress',
  'done': 'done',
  'skipped': 'skipped',
  'failed': 'failed',
};

function migrateFeature({ slug, designPath, dryRun = false } = {}) {
  if (!slug) throw new Error('slug required');
  const cwd = process.cwd();
  const warnings = [];
  const errors = [];

  const dispatchPath = path.join(cwd, '.harness-sf', '.cache', 'dispatch-state', `${slug}.json`);
  const loopPath     = path.join(cwd, '.harness-sf', '.cache', 'validate-loop', `${slug}.json`);
  const findingsPath = path.join(cwd, '.harness-sf', '.cache', 'deploy-findings', `${slug}.json`);

  const dispatch = readJSONIfExists(dispatchPath);
  const loop = readJSONIfExists(loopPath);
  const findings = readJSONIfExists(findingsPath);

  if (!dispatch && !loop && !findings) {
    return { ok: false, errors: [`no legacy cache files found for slug '${slug}'`], warnings };
  }

  // Resolve design path / revision / body hash.
  const resolvedDesignPath = designPath
    || (dispatch && dispatch.design_path)
    || findDesignForSlug(cwd, slug);
  if (!resolvedDesignPath) {
    return { ok: false, errors: [`could not locate design.md for slug '${slug}' — pass --design-path`], warnings };
  }
  const designAbs = path.isAbsolute(resolvedDesignPath) ? resolvedDesignPath : path.join(cwd, resolvedDesignPath);
  const design = readDesign(designAbs);
  if (!design) {
    return { ok: false, errors: [`design file not readable: ${resolvedDesignPath}`], warnings };
  }

  const designRevision = parseInt(design.fm.revision || '1', 10) || 1;
  const designBodyHash = bodyHash(design.text);
  const designRel = path.relative(cwd, designAbs).split(path.sep).join('/');

  // Compose state.
  const artifacts = dispatch && Array.isArray(dispatch.artifacts)
    ? dispatch.artifacts.map(a => ({
        id: a.id,
        type: mapArtifactType(a.type, warnings),
        status: STATUS_REMAP[a.status] || (warnings.push(`unknown legacy status '${a.status}' for ${a.id} — defaulting to pending`), 'pending'),
        completed_at: a.completed_at || null,
        depends_on: a.depends_on || [],
      }))
    : [];

  const state = {
    schema_version: 1,
    version: 1,
    slug,
    design_path: designRel,
    design_revision: designRevision,
    design_body_hash: designBodyHash,
    lock: null,
    current_step: artifacts.length && artifacts.every(a => a.status === 'done') ? '8' : '7',
    entered_via: 'full',
    artifacts,
    deploy: {
      last_validation: null,
      findings: (findings && Array.isArray(findings.findings)) ? findings.findings : [],
    },
    loop: {
      iteration: (loop && Number.isInteger(loop.iteration)) ? loop.iteration : 0,
      last_error_class: (loop && loop.last_error_class) || null,
    },
    override_active_session: null,
    override_history: [],
  };

  if (dryRun) {
    return { ok: true, statePath: store.stateFilePath(slug, designRevision), written: false, dryRunState: state, warnings, errors };
  }

  const existing = store.readState(slug, designRevision);
  if (existing) {
    return { ok: false, errors: [`state already exists at ${store.stateFilePath(slug, designRevision)} (version ${existing.version}). Refusing to overwrite — use 'hsf doctor --repair' or remove manually.`], warnings };
  }

  store.writeState(slug, designRevision, () => state, { operation: 'state:migrate-from-v1' });

  return { ok: true, statePath: store.stateFilePath(slug, designRevision), written: true, warnings, errors };
}

module.exports = { migrateFeature };
