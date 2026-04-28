#!/usr/bin/env node
// harness-sf — design.md schema + DAG validator.
//
// Called by /sf-feature before Step 4 (review entry) and before Step 6 (dispatch
// entry) so a malformed design.md never enters the review/dispatch pipeline.
//
// Usage:
//   node .claude/hooks/_lib/validate-design.js <design-md-path> [--check-resolution] [--check-library-verdict]
//
// Exit:
//   0 — valid; prints JSON {type, name, artifacts: [...], order: [...], resolution: {...}, library_verdict: {...}}
//   1 — invalid; prints diagnostics on stderr
//
// Checks (always):
//   - file exists, has YAML frontmatter
//   - frontmatter.type ∈ {apex, lwc, aura, sobject, field, feature}
//   - frontmatter.name present
//   - if type === 'feature':
//       * `## Artifacts` section parses into ≥1 artifacts
//       * each artifact has unique id and `[type: X]` tag with X in valid type set
//       * each `Depends on:` entry references a defined artifact id (or '-')
//       * dependency graph has no cycles (DAG); returns topological order
//       * if frontmatter has `artifacts: N`, must equal parsed count
//
// Checks (--check-resolution, gated on `## Reviews` existing):
//   - every `[H<n>]` (HIGH risk) ID found in `## Reviews` must have a resolution
//     entry under `## Review Resolution` matching `\bH<n>\b`.
//   - every `[M<n>]` (MEDIUM risk) ID must also have at least a 1-line response.
//   - resolution entries should have ≥ 8 chars of text after the ID (anti-rubber-stamp
//     heuristic). Empty / "ok" / "수용" 1단어는 R2 risk 로 fail.
//   - missing `## Review Resolution` section while `## Reviews` exists → fail.
//
// Checks (--check-library-verdict, gated on type === 'feature' and `## Reviews` existing):
//   - `## Library Verdict` section must exist under `## Reviews` (or as top-level).
//   - every artifact id from `## Artifacts` must appear with one of:
//       library-applied: <name>  |  library-recommended: <category>  |  library-not-applicable: <reason>
//   - missing artifact entries or unrecognized verdict tokens → fail.

'use strict';
const fs = require('fs');
const path = require('path');

const VALID_TYPES = new Set(['apex', 'lwc', 'aura', 'sobject', 'field', 'feature']);
const ARTIFACT_TYPES = new Set(['sobject', 'field', 'apex', 'lwc', 'aura', 'permission-set', 'flow']);

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/);
    if (kv) fm[kv[1].toLowerCase()] = kv[2];
  }
  return fm;
}

// Top-level section names known to design.md schema. Reviewer output may emit
// inner '## Verdict' / '## Risks' headers — those must NOT terminate a top-level section.
// Top-level section names recognized in design.md schema. Names that also appear
// inside reviewer output (e.g. '## Risks', '## Verdict', '## Tradeoffs',
// '## Missing Cases', '## Suggestions', '## Unknown Areas') are intentionally
// excluded — they should not terminate the parent '## Reviews' section.
const TOP_LEVEL_SECTIONS = new Set([
  'Why', 'Why (Business)', 'What', 'What (Scope)', 'How', 'How (Operations)',
  'Edge Cases', 'Non-goals', 'Decisions', 'Phasing', 'Dependencies',
  'Artifacts', 'Reviews', 'Review Resolution', 'Library Verdict', 'Dispatch Log',
  'Test Strategy', 'Test plan', 'Architecture',
]);

const VERDICT_TOKENS = new Set(['library-applied', 'library-recommended', 'library-not-applicable']);

// Returns text content of a top-level "## Section Name" section. Stops at the
// next heading whose name is in TOP_LEVEL_SECTIONS — inner '## Verdict' inside
// reviewer output is treated as part of the Reviews section.
function extractSection(text, name) {
  const startRe = new RegExp(`^##\\s+${name}\\s*$`, 'm');
  const startMatch = text.match(startRe);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIdx);
  const nextRe = /^##\s+([^\r\n]+?)\s*$/gm;
  let nextMatch;
  while ((nextMatch = nextRe.exec(rest)) !== null) {
    const sectionName = nextMatch[1].trim();
    if (TOP_LEVEL_SECTIONS.has(sectionName)) {
      return rest.slice(0, nextMatch.index);
    }
  }
  return rest;
}

// Parse "### N. <id>  [type: X] [status: Y] ..." artifact headers and their bodies.
function parseArtifacts(sectionText) {
  if (!sectionText) return [];
  const headerRe = /^###\s+\d+\.\s+([\w-]+)\s+(.+)$/gm;
  const headers = [];
  let m;
  while ((m = headerRe.exec(sectionText)) !== null) {
    headers.push({ id: m[1], tagsLine: m[2], headerStart: m.index, headerEnd: m.index + m[0].length });
  }
  // Slice body between consecutive headers.
  const artifacts = [];
  for (let i = 0; i < headers.length; i++) {
    const next = i + 1 < headers.length ? headers[i + 1].headerStart : sectionText.length;
    const body = sectionText.slice(headers[i].headerEnd, next);
    const typeMatch = headers[i].tagsLine.match(/\[type:\s*([\w-]+)\s*\]/i);
    const dependsMatch = body.match(/^[-*]\s*Depends on:\s*(.+)$/mi);
    let dependsOn = [];
    if (dependsMatch) {
      const v = dependsMatch[1].trim();
      if (v && v !== '-' && v.toLowerCase() !== 'none') {
        dependsOn = v.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    artifacts.push({
      id: headers[i].id,
      type: typeMatch ? typeMatch[1].toLowerCase() : null,
      depends_on: dependsOn,
    });
  }
  return artifacts;
}

// Topological sort (Kahn). Returns { order: [ids] } on success, { cycle: [ids] } on cycle.
function topoSort(artifacts) {
  const inDeg = new Map();
  const adj = new Map();
  const ids = new Set(artifacts.map(a => a.id));
  for (const a of artifacts) { inDeg.set(a.id, 0); adj.set(a.id, []); }
  for (const a of artifacts) {
    for (const dep of a.depends_on) {
      if (!ids.has(dep)) continue; // unknown ids are caught separately
      adj.get(dep).push(a.id);
      inDeg.set(a.id, inDeg.get(a.id) + 1);
    }
  }
  const queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adj.get(id) || []) {
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== artifacts.length) {
    const remaining = artifacts.map(a => a.id).filter(id => !order.includes(id));
    return { cycle: remaining };
  }
  return { order };
}

function fail(msgs) {
  for (const m of msgs) process.stderr.write(`validate-design: ${m}\n`);
  process.exit(1);
}

// Parse review risks: returns [{persona, severity: 'H'|'M'|'L', id_num, raw}, ...]
// Looks for "[H1]", "[HIGH][H1]", "[H1] <text>", or legacy "[HIGH] <text>" (no ID — flagged).
function parseReviewRisks(reviewsSection) {
  if (!reviewsSection) return { risks: [], legacyCount: 0 };
  const risks = [];
  let legacyCount = 0;
  // Split into sub-sections per reviewer (by '# ... Review:' headings)
  const personaRe = /^#+\s+([A-Za-z][\w/-]*)\s+Review:/gm;
  const personaPositions = [];
  let pm;
  while ((pm = personaRe.exec(reviewsSection)) !== null) {
    personaPositions.push({ persona: pm[1].toLowerCase(), start: pm.index });
  }
  if (personaPositions.length === 0) {
    personaPositions.push({ persona: 'unknown', start: 0 });
  }
  for (let i = 0; i < personaPositions.length; i++) {
    const start = personaPositions[i].start;
    const end = i + 1 < personaPositions.length ? personaPositions[i + 1].start : reviewsSection.length;
    const block = reviewsSection.slice(start, end);
    const persona = personaPositions[i].persona;
    // Match [H1], [M2], [L3] — single-letter severity + number
    const idRe = /\[([HMLhml])(\d+)\]/g;
    const seen = new Set();
    let m;
    while ((m = idRe.exec(block)) !== null) {
      const sev = m[1].toUpperCase();
      const num = parseInt(m[2], 10);
      const key = `${sev}${num}`;
      if (seen.has(key)) continue;
      seen.add(key);
      risks.push({ persona, severity: sev, id_num: num, full_id: key });
    }
    // Legacy unlabeled risks: lines starting with "[HIGH]" / "[MEDIUM]" without ID
    const legacyRe = /^\s*[-*]\s*\[(HIGH|MEDIUM)\](?!\s*\[)/gmi;
    let lm;
    while ((lm = legacyRe.exec(block)) !== null) {
      legacyCount += 1;
    }
  }
  return { risks, legacyCount };
}

// Parse resolution log: map full_id -> response text length
function parseResolution(resolutionSection) {
  if (!resolutionSection) return new Map();
  const out = new Map();
  // Match lines like "- H1: 어쩌고저쩌고" or "* M2: response text"
  const lineRe = /^\s*[-*]\s*([HMLhml])(\d+)\s*[:\-]\s*(.+?)\s*$/gm;
  let m;
  while ((m = lineRe.exec(resolutionSection)) !== null) {
    const id = `${m[1].toUpperCase()}${parseInt(m[2], 10)}`;
    const text = m[3].trim();
    out.set(id, text.length);
  }
  return out;
}

// Parse `## Library Verdict` (or inline subsection inside Reviews).
// Returns Map<artifact-id, {token, detail}>.
function parseLibraryVerdict(text) {
  const out = new Map();
  // Look for top-level '## Library Verdict' first; fall back to inline header inside Reviews.
  let section = extractSection(text, 'Library Verdict');
  if (!section) {
    const reviews = extractSection(text, 'Reviews');
    if (reviews) {
      const m = reviews.match(/^##\s+Library Verdict\s*$([\s\S]*?)(?=^##\s+|\Z)/m);
      if (m) section = m[1];
    }
  }
  if (!section) return { found: false, entries: out };
  // Match: "- <id>: library-applied|library-recommended|library-not-applicable: <detail>"
  const lineRe = /^\s*[-*]\s*([\w-]+)\s*:\s*(library-applied|library-recommended|library-not-applicable)\s*:\s*(.+?)\s*$/gm;
  let m;
  while ((m = lineRe.exec(section)) !== null) {
    out.set(m[1], { token: m[2], detail: m[3].trim() });
  }
  return { found: true, entries: out };
}

const args = process.argv.slice(2);
const arg = args.find((a) => !a.startsWith('--'));
const checkResolution = args.includes('--check-resolution');
const checkLibraryVerdict = args.includes('--check-library-verdict');
if (!arg) fail(['usage: validate-design.js <design-md-path> [--check-resolution] [--check-library-verdict]']);

const cwd = process.cwd();
const abs = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
const rel = path.relative(cwd, abs).split(path.sep).join('/');

const errors = [];
if (rel.startsWith('..')) errors.push(`'${arg}' is outside project root`);
if (!fs.existsSync(abs)) errors.push(`'${rel}' does not exist`);
if (errors.length) fail(errors);

const text = fs.readFileSync(abs, 'utf8');
const fm = parseFrontmatter(text);
if (!fm) fail([`'${rel}' has no YAML frontmatter`]);

const type = (fm.type || '').toLowerCase();
const name = fm.name || '';
if (!VALID_TYPES.has(type)) errors.push(`frontmatter.type must be ${[...VALID_TYPES].join('|')}, got '${type}'`);
if (!name) errors.push('frontmatter.name is required');

let artifacts = [];
let order = [];

if (type === 'feature') {
  const section = extractSection(text, 'Artifacts');
  if (!section) {
    errors.push("feature design.md must have a '## Artifacts' section");
  } else {
    artifacts = parseArtifacts(section);
    if (artifacts.length === 0) errors.push('## Artifacts section must contain at least one `### N. <id> [type: X]` entry');

    const ids = new Set();
    for (const a of artifacts) {
      if (ids.has(a.id)) errors.push(`duplicate artifact id: ${a.id}`);
      ids.add(a.id);
      if (!a.type) errors.push(`artifact '${a.id}' is missing [type: ...] tag`);
      else if (!ARTIFACT_TYPES.has(a.type)) errors.push(`artifact '${a.id}' has invalid type '${a.type}' (allowed: ${[...ARTIFACT_TYPES].join(', ')})`);
    }
    for (const a of artifacts) {
      for (const dep of a.depends_on) {
        if (!ids.has(dep)) errors.push(`artifact '${a.id}' depends on undefined id '${dep}'`);
      }
    }
    if (fm.artifacts !== undefined) {
      const declared = parseInt(fm.artifacts, 10);
      if (Number.isFinite(declared) && declared !== artifacts.length) {
        errors.push(`frontmatter.artifacts=${declared} but '## Artifacts' parses ${artifacts.length}`);
      }
    }
    if (errors.length === 0) {
      const r = topoSort(artifacts);
      if (r.cycle) errors.push(`dependency cycle detected among: ${r.cycle.join(', ')}`);
      else order = r.order;
    }
  }
}

if (errors.length) fail(errors);

const MIN_RESOLUTION_CHARS = 8;
const resolutionReport = { reviews_present: false, risks: [], unresolved_high: [], unresolved_medium: [], shallow: [], legacy_unlabeled: 0 };

if (checkResolution) {
  const reviewsSection = extractSection(text, 'Reviews');
  if (reviewsSection && reviewsSection.replace(/\s/g, '').length > 0) {
    resolutionReport.reviews_present = true;
    const { risks, legacyCount } = parseReviewRisks(reviewsSection);
    resolutionReport.risks = risks.map(r => `${r.persona}:${r.full_id}`);
    resolutionReport.legacy_unlabeled = legacyCount;

    const resolutionSection = extractSection(text, 'Review Resolution');
    if (!resolutionSection) {
      errors.push("'## Reviews' section exists but '## Review Resolution' is missing — every HIGH/MEDIUM risk needs a resolution line");
    } else {
      const resMap = parseResolution(resolutionSection);
      for (const r of risks) {
        const len = resMap.get(r.full_id);
        if (r.severity === 'H') {
          if (len === undefined) resolutionReport.unresolved_high.push(`${r.persona}:${r.full_id}`);
          else if (len < MIN_RESOLUTION_CHARS) resolutionReport.shallow.push(`${r.persona}:${r.full_id}`);
        } else if (r.severity === 'M') {
          if (len === undefined) resolutionReport.unresolved_medium.push(`${r.persona}:${r.full_id}`);
          else if (len < MIN_RESOLUTION_CHARS) resolutionReport.shallow.push(`${r.persona}:${r.full_id}`);
        }
      }
      if (resolutionReport.unresolved_high.length) {
        errors.push(`unresolved HIGH risks: ${resolutionReport.unresolved_high.join(', ')} — add a resolution line under '## Review Resolution'`);
      }
      if (resolutionReport.unresolved_medium.length) {
        errors.push(`unresolved MEDIUM risks: ${resolutionReport.unresolved_medium.join(', ')} — add at least a 1-line response`);
      }
      if (resolutionReport.shallow.length) {
        errors.push(`shallow resolutions (< ${MIN_RESOLUTION_CHARS} chars): ${resolutionReport.shallow.join(', ')} — write a real reason, not 1-word ack`);
      }
    }
    if (legacyCount > 0) {
      errors.push(`'## Reviews' has ${legacyCount} legacy [HIGH]/[MEDIUM] entries without [H#]/[M#] IDs — re-run review with risk-ID schema or manually add IDs`);
    }
  }
}

const libraryVerdictReport = { checked: false, found: false, missing_artifacts: [], unrecognized: [] };

if (checkLibraryVerdict && type === 'feature') {
  libraryVerdictReport.checked = true;
  const reviewsSection = extractSection(text, 'Reviews');
  if (reviewsSection && reviewsSection.replace(/\s/g, '').length > 0) {
    const { found, entries } = parseLibraryVerdict(text);
    libraryVerdictReport.found = found;
    if (!found) {
      errors.push("'## Reviews' present but '## Library Verdict' section is missing — sf-design-library-reviewer must classify every artifact (library-applied | library-recommended | library-not-applicable)");
    } else {
      for (const a of artifacts) {
        if (!entries.has(a.id)) libraryVerdictReport.missing_artifacts.push(a.id);
      }
      for (const [id, v] of entries.entries()) {
        if (!VERDICT_TOKENS.has(v.token)) libraryVerdictReport.unrecognized.push(`${id}:${v.token}`);
      }
      if (libraryVerdictReport.missing_artifacts.length) {
        errors.push(`'## Library Verdict' missing entries for: ${libraryVerdictReport.missing_artifacts.join(', ')} — every artifact needs one of library-applied/recommended/not-applicable`);
      }
      if (libraryVerdictReport.unrecognized.length) {
        errors.push(`'## Library Verdict' has unrecognized verdict tokens: ${libraryVerdictReport.unrecognized.join(', ')} — allowed: library-applied, library-recommended, library-not-applicable`);
      }
    }
  }
}

if (errors.length) fail(errors);

// Surface revision metadata so /sf-feature can drive targeted re-review (Phase 3).
const revision = parseInt(fm.revision || '1', 10) || 1;
const revisionBlockPersonas = (fm.revision_block_personas || '')
  .replace(/^\[|\]$/g, '')
  .split(',')
  .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean);

const out = {
  ok: true,
  design_path: rel,
  type,
  name,
  revision,
  revision_block_personas: revisionBlockPersonas,
  artifacts: artifacts.map(a => ({ id: a.id, type: a.type, depends_on: a.depends_on })),
  order,
  resolution: resolutionReport,
  library_verdict: libraryVerdictReport,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(0);
