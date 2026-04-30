'use strict';
// harness-sf — shared state summary used by statusline.js and dispatch-state-cli `status`.
//
// Single source of truth for "what phase is the user in, which artifact is in
// flight, and is any approval about to expire?" — keeps the statusline and the
// CLI from drifting into two implementations.
//
// Returns a JSON-serializable summary; the renderer (statusline / cli) decides
// which tokens to show.
//
// Design (P1 — statusline observability):
//
//   summarize({ cwd? }) → {
//     hasDesign:   bool,
//     designSlug:  string | null,
//     designFile:  string | null,           // basename of newest design.md
//     phase:       'idle' | 'plan' | 'build' | 'validate' | 'done',
//     current:     string | null,           // first artifact with status==='in_progress'
//     total:       number,                  // 0 when no state.json
//     done:        number,
//     failed:      number,
//     approvalTtlMs: number | null,         // smallest remaining TTL across sentinel kinds; null if no sentinels
//     approvalKind:  string | null,         // which kind that closest-to-expiry sentinel belongs to
//     lastValidationAgeMs: number | null,   // .harness-sf/last-validation.json age
//   }
//
// Phase rule:
//   no design.md                              → idle
//   design.md only (no state.json)            → plan
//   state.json + ≥1 incomplete artifact       → build
//   state.json + all done + no last-validation→ validate
//   state.json + all done + last-validation   → done

const fs = require('fs');
const path = require('path');

// TTL per sentinel kind (must mirror the values enforced in pre-*-gate.js).
const SENTINEL_TTLS = {
  'design-approvals':  2 * 60 * 60 * 1000,
  'modify-approvals':  30 * 60 * 1000,
  'library-approvals': 30 * 60 * 1000,
};

function safe(fn, def) { try { return fn(); } catch { return def; } }

function newestDesign(designsDir) {
  if (!fs.existsSync(designsDir)) return null;
  const files = safe(() => fs.readdirSync(designsDir), [])
    .filter(f => f.endsWith('.md'))
    .map(f => ({ f, m: safe(() => fs.statSync(path.join(designsDir, f)).mtimeMs, 0) }))
    .sort((a, b) => b.m - a.m);
  return files[0] ? files[0].f : null;
}

function newestStateForSlug(stateDir, slug) {
  if (!fs.existsSync(stateDir)) return null;
  const escaped = slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^${escaped}__r(\\d+)\\.json$`);
  const matches = safe(() => fs.readdirSync(stateDir), [])
    .map(f => ({ f, m: f.match(re) }))
    .filter(x => x.m)
    .map(x => ({ f: x.f, rev: parseInt(x.m[1], 10) }))
    .sort((a, b) => b.rev - a.rev);
  if (!matches.length) return null;
  return safe(() => JSON.parse(fs.readFileSync(path.join(stateDir, matches[0].f), 'utf8')), null);
}

// Returns { kind, remainingMs } for the sentinel closest to expiry across all
// kinds, or null if no sentinels exist. Expired sentinels (remainingMs <= 0)
// are still returned (renderer can display 'expired') so the user notices.
function closestApproval(cacheDir, now) {
  let best = null;
  for (const kind of Object.keys(SENTINEL_TTLS)) {
    const dir = path.join(cacheDir, kind);
    if (!fs.existsSync(dir)) continue;
    const entries = safe(() => fs.readdirSync(dir), []);
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      const s = safe(() => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), null);
      if (!s || !s.issued_at) continue;
      const issued = new Date(s.issued_at).getTime();
      if (!Number.isFinite(issued)) continue;
      const remainingMs = (issued + SENTINEL_TTLS[kind]) - now;
      if (best === null || remainingMs < best.remainingMs) {
        best = { kind, remainingMs };
      }
    }
  }
  return best;
}

function summarize({ cwd } = {}) {
  cwd = cwd || process.cwd();
  const harnessDir = path.join(cwd, '.harness-sf');
  const designsDir = path.join(harnessDir, 'designs');
  const stateDir = path.join(harnessDir, 'state');
  const cacheDir = path.join(harnessDir, '.cache');

  const out = {
    hasDesign: false,
    designSlug: null,
    designFile: null,
    phase: 'idle',
    current: null,
    total: 0,
    done: 0,
    failed: 0,
    approvalTtlMs: null,
    approvalKind: null,
    lastValidationAgeMs: null,
  };

  const designFile = newestDesign(designsDir);
  if (!designFile) return finalizeApproval(out, cacheDir);

  out.hasDesign = true;
  out.designFile = designFile;
  out.designSlug = designFile.replace(/\.md$/, '');

  const state = newestStateForSlug(stateDir, out.designSlug);

  if (!state || !Array.isArray(state.artifacts)) {
    out.phase = 'plan';
    return finalizeApproval(finalizeValidationAge(out, harnessDir), cacheDir);
  }

  const arts = state.artifacts;
  out.total = arts.length;
  out.done = arts.filter(a => a.status === 'done').length;
  out.failed = arts.filter(a => a.status === 'failed').length;
  const inProgress = arts.find(a => a.status === 'in_progress');
  out.current = inProgress ? inProgress.id : null;

  const incomplete = arts.some(a => a.status !== 'done' && a.status !== 'skipped');
  if (incomplete) {
    out.phase = 'build';
  } else {
    finalizeValidationAge(out, harnessDir);
    out.phase = (out.lastValidationAgeMs !== null) ? 'done' : 'validate';
  }

  return finalizeApproval(finalizeValidationAge(out, harnessDir), cacheDir);
}

function finalizeValidationAge(out, harnessDir) {
  if (out.lastValidationAgeMs !== null) return out;
  const p = path.join(harnessDir, 'last-validation.json');
  if (!fs.existsSync(p)) return out;
  const data = safe(() => JSON.parse(fs.readFileSync(p, 'utf8')), null);
  if (!data || !data.validated_at) return out;
  const t = new Date(data.validated_at).getTime();
  if (!Number.isFinite(t)) return out;
  const age = Date.now() - t;
  if (age >= 0) out.lastValidationAgeMs = age;
  return out;
}

function finalizeApproval(out, cacheDir) {
  const best = closestApproval(cacheDir, Date.now());
  if (best) {
    out.approvalTtlMs = best.remainingMs;
    out.approvalKind = best.kind;
  }
  return out;
}

module.exports = { summarize, SENTINEL_TTLS };
