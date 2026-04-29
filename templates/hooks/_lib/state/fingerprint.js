'use strict';
// Repo fingerprint abstraction — git → tree-hash → timestamp fallback.
// Per non-git-fingerprint v3 (with state-schema canonical resolution).
//
// API:
//   fingerprint() → { mode: 'git'|'tree-hash'|'timestamp', value: string }
//   compare(a, b) → boolean — true iff mode AND value both match.
//
// PR C1 scope: ship the abstraction so sentinel.js can persist
// fingerprint{mode,value} alongside head_sha. PR C2/C3 wires gates and
// drops head_sha. tree-hash content normalization (CRLF → LF, BOM strip)
// is implemented; tree-hash scope defaults to force-app/ + .harness-sf/PROJECT.md.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TEXT_EXT = new Set([
  '.cls', '.trigger', '.js', '.ts', '.html', '.css', '.xml',
  '.json', '.yaml', '.yml', '.md', '.page', '.component',
]);

const DEFAULT_EXCLUDE = [
  /[\\/]node_modules[\\/]/,
  /[\\/]\.sfdx[\\/]/,
  /[\\/]\.sf[\\/]/,
  /\.log$/,
];

function gitHeadSha() {
  try {
    const isWin = process.platform === 'win32';
    const r = isWin
      ? spawnSync('git rev-parse HEAD', { encoding: 'utf8', shell: true, timeout: 1500 })
      : spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 1500 });
    if (r.status !== 0) return null;
    const out = (r.stdout || '').trim();
    return /^[0-9a-f]{40}$/i.test(out) ? out : null;
  } catch { return null; }
}

function isExcluded(rel) {
  return DEFAULT_EXCLUDE.some(re => re.test(rel));
}

function walk(rootAbs, accumPaths) {
  let entries;
  try { entries = fs.readdirSync(rootAbs, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    const abs = path.join(rootAbs, ent.name);
    if (isExcluded(abs)) continue;
    if (ent.isDirectory()) walk(abs, accumPaths);
    else if (ent.isFile()) accumPaths.push(abs);
  }
}

function normalize(buf, ext) {
  if (TEXT_EXT.has(ext)) {
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return Buffer.from(text, 'utf8');
  }
  return buf;
}

function treeHash(cwd) {
  const candidates = ['force-app', 'src'];
  let scope = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(cwd, c))) { scope = c; break; }
  }
  if (!scope) return null;

  const paths = [];
  walk(path.join(cwd, scope), paths);

  // Include PROJECT.md if present (gate-relevant per codex H2).
  const projectMd = path.join(cwd, '.harness-sf', 'PROJECT.md');
  if (fs.existsSync(projectMd)) paths.push(projectMd);

  paths.sort();

  const lines = [];
  for (const abs of paths) {
    let raw;
    try { raw = fs.readFileSync(abs); } catch { continue; }
    const norm = normalize(raw, path.extname(abs).toLowerCase());
    const fileHash = crypto.createHash('sha256').update(norm).digest('hex');
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    lines.push(`${rel}:${fileHash}`);
  }
  const combined = crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
  return `sha256:${combined}`;
}

function fingerprint() {
  const cwd = process.cwd();
  const sha = gitHeadSha();
  if (sha) return { mode: 'git', value: sha };
  const th = treeHash(cwd);
  if (th) return { mode: 'tree-hash', value: th };
  // Timestamp fallback — caller should warn weak-trust.
  return { mode: 'timestamp', value: `ts:${Date.now()}` };
}

function compare(a, b) {
  if (!a || !b) return false;
  return a.mode === b.mode && a.value === b.value;
}

module.exports = { fingerprint, compare, gitHeadSha };
