'use strict';
// Append-only audit log with hash chain — gate-hardening v3 PR gate-4.
//
// Path: .harness-sf/audit.log (gitignore)
// Line format:
//   <ISO-ts>  <gate>  <slug>  <scope>  <reason>  prev=<sha8>  sha=<sha8>
// Each sha is sha256(prev_sha + ts + gate + slug + scope + reason)[0..16].
// First line uses prev=000000000000000000.
//
// API:
//   append({ gate, slug?, scope, reason, session_id? }) → line
//   verify() → { ok, broken_at?, total }
//   tail(n) → last N lines as objects
//
// Stays zero-dep (sha256 via Node's crypto).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIT_PATH = path.join(process.cwd(), '.harness-sf', 'audit.log');
const ZERO = '000000000000000000';

function ensureDir() {
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
}

// Field separator: TAB. Reasons may contain spaces but never tabs.
const SEP = '\t';

function escapeField(v) {
  if (v == null) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

function chainHash(prev, ts, gate, slug, scope, reason) {
  const h = crypto.createHash('sha256');
  h.update(`${prev}|${ts}|${gate}|${slug}|${scope}|${reason}`);
  return h.digest('hex').slice(0, 18);
}

function readLines() {
  if (!fs.existsSync(AUDIT_PATH)) return [];
  const raw = fs.readFileSync(AUDIT_PATH, 'utf8');
  return raw.split(/\r?\n/).filter(l => l.length > 0);
}

function parseLine(line) {
  const parts = line.split(SEP);
  if (parts.length !== 7) return null;
  const [ts, gate, slug, scope, reason, prevField, shaField] = parts;
  if (!prevField.startsWith('prev=') || !shaField.startsWith('sha=')) return null;
  return {
    ts,
    gate,
    slug,
    scope,
    reason,
    prev: prevField.slice('prev='.length),
    sha: shaField.slice('sha='.length),
  };
}

function lastSha() {
  const lines = readLines();
  if (!lines.length) return ZERO;
  const parsed = parseLine(lines[lines.length - 1]);
  return parsed && parsed.sha ? parsed.sha : ZERO;
}

function append({ gate, slug = '', scope, reason, session_id = '' }) {
  if (!gate) throw new Error('audit.append: gate is required');
  if (!scope) throw new Error('audit.append: scope is required');
  if (!reason || reason.replace(/\s/g, '').length < 8) {
    throw new Error('audit.append: reason must have >= 8 non-whitespace chars');
  }

  ensureDir();
  const ts = new Date().toISOString();
  const safeGate = escapeField(gate);
  const safeSlug = escapeField(slug);
  const safeScope = escapeField(scope);
  const safeReason = escapeField(reason);
  const prev = lastSha();
  const sha = chainHash(prev, ts, safeGate, safeSlug, safeScope, safeReason);

  const line = [
    ts,
    safeGate,
    safeSlug,
    safeScope,
    safeReason,
    `prev=${prev}`,
    `sha=${sha}`,
  ].join(SEP) + '\n';

  fs.appendFileSync(AUDIT_PATH, line);
  return { ts, gate, slug, scope, reason, session_id, prev, sha };
}

function verify() {
  const lines = readLines();
  if (!lines.length) return { ok: true, total: 0 };

  let prev = ZERO;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    if (!parsed) {
      return { ok: false, broken_at: i + 1, total: lines.length, reason: 'malformed line' };
    }
    if (parsed.prev !== prev) {
      return {
        ok: false,
        broken_at: i + 1,
        total: lines.length,
        reason: `prev mismatch (line claims prev=${parsed.prev}, expected ${prev})`,
      };
    }
    const expected = chainHash(parsed.prev, parsed.ts, parsed.gate, parsed.slug, parsed.scope, parsed.reason);
    if (parsed.sha !== expected) {
      return {
        ok: false,
        broken_at: i + 1,
        total: lines.length,
        reason: `sha mismatch (line claims sha=${parsed.sha}, recomputed ${expected})`,
      };
    }
    prev = parsed.sha;
  }
  return { ok: true, total: lines.length };
}

function tail(n) {
  const lines = readLines();
  const start = Math.max(0, lines.length - (n || 20));
  return lines.slice(start).map(parseLine).filter(Boolean);
}

module.exports = { append, verify, tail, AUDIT_PATH };
