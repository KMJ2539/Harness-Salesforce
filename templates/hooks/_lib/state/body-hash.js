'use strict';
// Computes the canonical design.md body hash used as sentinel payload.
//
// Per state-consolidation-v3: body = file content with `state:` frontmatter
// block (legacy v1/v2 may not have one), `## Reviews` section, and
// `## Resolution` / `## Review Resolution` section removed. This makes the
// hash stable against ongoing review/resolution edits while still binding
// substantive design changes to the sentinel.
//
// API:
//   bodyHash(text) → "sha256:<hex>"
//   stripped(text) → the canonical body string (debug helper)

const crypto = require('crypto');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FRONTMATTER_STATE_BLOCK_RE = /^state:\s*$([\s\S]*?)(?=^[A-Za-z][A-Za-z0-9_-]*:|\Z)/m;
const SECTION_HEADERS_TO_STRIP = ['Reviews', 'Resolution', 'Review Resolution'];

function stripStateFromFrontmatter(fmText) {
  return fmText.replace(FRONTMATTER_STATE_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n');
}

function stripSection(text, header) {
  const re = new RegExp(`(^|\\n)## +${header}\\b[\\s\\S]*?(?=\\n## +[^\\n]|$)`, 'i');
  return text.replace(re, '\n');
}

function stripped(text) {
  let out = text;
  const fmMatch = out.match(FRONTMATTER_RE);
  if (fmMatch) {
    const cleanedFm = stripStateFromFrontmatter(fmMatch[1]);
    out = `---\n${cleanedFm}\n---\n` + out.slice(fmMatch[0].length);
  }
  for (const header of SECTION_HEADERS_TO_STRIP) {
    out = stripSection(out, header);
  }
  out = out.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return out;
}

function bodyHash(text) {
  const h = crypto.createHash('sha256').update(stripped(text), 'utf8').digest('hex');
  return `sha256:${h}`;
}

module.exports = { bodyHash, stripped };
