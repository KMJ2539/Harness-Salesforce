#!/usr/bin/env node
// harness-sf — verify a proposed mechanical auto-fix against design.md as oracle.
//
// Called by /sf-feature Step 7.5 between "fix proposal" and "Edit apply" — if
// the proposed change pulls reality back to design (additive consistent), it is
// safe to auto-apply. Otherwise the orchestrator branches to a 3-way prompt
// (code-fix anyway / design-fix / hold).
//
// Usage:
//   node .claude/hooks/_lib/verify-fix-against-design.js \
//     --design <design-md-path> \
//     --proposal <fix-proposal-json-path-or-inline-via-stdin>
//
// Proposal schema (JSON):
//   {
//     "action": "add" | "remove" | "modify",
//     "kind":   "field" | "fls" | "class-access" | "cmt-record" | "field-typo",
//     "target": "<identifier>",         // e.g. "KakaoNotification__c.Recipient__c" or "Recipient__c"
//     "artifact_hint": "<artifact-id>", // optional — narrows search
//     "file_path": "force-app/...",     // file the fix would write to
//     "from": "<old-value>",            // for modify/typo
//     "to":   "<new-value>"             // for modify/typo
//   }
//
// Exit:
//   0 — verification ran (consistent or not — see JSON.consistent)
//   1 — input malformed / design.md missing
//
// Decision rules:
//   action=add + target declared in design  → consistent (PS catching up to design)
//   action=add + target NOT declared        → inconsistent (would drift design)
//   action=remove + target declared         → inconsistent (design says it should exist)
//   action=remove + target NOT declared     → consistent (cleanup of stale ref)
//   action=modify/typo:
//     - "to" matches design declaration     → consistent
//     - "to" does not match                 → inconsistent
//   File path scope check: file_path must live under the dispatch output area
//   for the matched artifact (force-app/main/default/{classes,objects,permissionsets,...}).

'use strict';
const fs = require('fs');
const path = require('path');

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

const TOP_LEVEL_SECTIONS = new Set([
  'Why', 'Why (Business)', 'What', 'What (Scope)', 'How', 'How (Operations)',
  'Edge Cases', 'Non-goals', 'Decisions', 'Phasing', 'Dependencies',
  'Artifacts', 'Reviews', 'Review Resolution', 'Library Verdict', 'Dispatch Log',
  'Test Strategy', 'Test plan', 'Architecture',
]);

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

function parseArtifacts(sectionText) {
  if (!sectionText) return [];
  const headerRe = /^###\s+\d+\.\s+([\w-]+)\s+(.+)$/gm;
  const headers = [];
  let m;
  while ((m = headerRe.exec(sectionText)) !== null) {
    headers.push({ id: m[1], tagsLine: m[2], headerStart: m.index, headerEnd: m.index + m[0].length });
  }
  const artifacts = [];
  for (let i = 0; i < headers.length; i++) {
    const next = i + 1 < headers.length ? headers[i + 1].headerStart : sectionText.length;
    const body = sectionText.slice(headers[i].headerEnd, next);
    const typeMatch = headers[i].tagsLine.match(/\[type:\s*([\w-]+)\s*\]/i);
    artifacts.push({
      id: headers[i].id,
      type: typeMatch ? typeMatch[1].toLowerCase() : null,
      body,
    });
  }
  return artifacts;
}

// Search artifacts' bodies for an identifier (field name, class name, etc).
// Returns array of {artifact_id, type, evidence_line}.
function findIdentifierInArtifacts(artifacts, identifier) {
  if (!identifier) return [];
  const hits = [];
  // Strip object prefix if present: "KakaoNotification__c.Recipient__c" → also try "Recipient__c"
  const candidates = [identifier];
  if (identifier.includes('.')) candidates.push(identifier.split('.').pop());
  // Word-boundary match to avoid false positives (e.g. "Status" matching "StatusBar")
  const reList = candidates.map((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  for (const a of artifacts) {
    for (const re of reList) {
      const lineMatch = a.body.split(/\r?\n/).find((l) => re.test(l));
      if (lineMatch) {
        hits.push({ artifact_id: a.id, type: a.type, evidence_line: lineMatch.trim() });
        break;
      }
    }
  }
  return hits;
}

function readJsonFromArgOrStdin(argVal) {
  if (!argVal || argVal === '-') {
    const raw = fs.readFileSync(0, 'utf8');
    return JSON.parse(raw);
  }
  const abs = path.isAbsolute(argVal) ? argVal : path.resolve(process.cwd(), argVal);
  if (!fs.existsSync(abs)) throw new Error(`proposal file '${argVal}' does not exist`);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function decide(action, hits, proposal) {
  const declared = hits.length > 0;
  if (action === 'add') {
    if (declared) return { consistent: true, reason: `target '${proposal.target}' declared in design — fix brings reality in line` };
    return { consistent: false, reason: `target '${proposal.target}' NOT declared in design — auto-add would drift design` };
  }
  if (action === 'remove') {
    if (declared) return { consistent: false, reason: `target '${proposal.target}' declared in design — auto-remove would contradict design` };
    return { consistent: true, reason: `target '${proposal.target}' NOT in design — removal is cleanup of stale reference` };
  }
  if (action === 'modify' || action === 'typo') {
    if (!proposal.to) return { consistent: false, reason: `modify/typo proposal missing 'to' field — cannot verify against design` };
    const toHits = findIdentifierInArtifacts(hits.length > 0 ? [] : [], proposal.to);
    // Re-check against full design with the proposed new identifier
    return null; // sentinel — caller re-runs with proposal.to
  }
  return { consistent: false, reason: `unknown action '${action}'` };
}

function main() {
  const args = process.argv.slice(2);
  const designIdx = args.indexOf('--design');
  const proposalIdx = args.indexOf('--proposal');
  if (designIdx < 0 || proposalIdx < 0) {
    process.stderr.write('verify-fix-against-design: usage: --design <path> --proposal <path|->\n');
    process.exit(1);
  }
  const designArg = args[designIdx + 1];
  const proposalArg = args[proposalIdx + 1];

  const designAbs = path.isAbsolute(designArg) ? designArg : path.resolve(process.cwd(), designArg);
  if (!fs.existsSync(designAbs)) {
    process.stderr.write(`verify-fix-against-design: design '${designArg}' does not exist\n`);
    process.exit(1);
  }

  let proposal;
  try {
    proposal = readJsonFromArgOrStdin(proposalArg);
  } catch (e) {
    process.stderr.write(`verify-fix-against-design: proposal parse: ${e.message}\n`);
    process.exit(1);
  }

  const designText = fs.readFileSync(designAbs, 'utf8');
  const fm = parseFrontmatter(designText);
  if (!fm) {
    process.stderr.write(`verify-fix-against-design: design has no YAML frontmatter\n`);
    process.exit(1);
  }

  const artifactsSection = extractSection(designText, 'Artifacts');
  const artifacts = parseArtifacts(artifactsSection);

  // Resolve identifier hits in design.
  let hits = findIdentifierInArtifacts(artifacts, proposal.target);

  // For modify/typo, decision rule is: does proposal.to match design? (proposal.from might or might not).
  let decision;
  if (proposal.action === 'modify' || proposal.action === 'typo') {
    const toHits = findIdentifierInArtifacts(artifacts, proposal.to);
    if (toHits.length > 0) {
      decision = { consistent: true, reason: `proposed value '${proposal.to}' matches design (${toHits[0].artifact_id})` };
    } else {
      decision = { consistent: false, reason: `proposed value '${proposal.to}' NOT in design — would drift` };
    }
    hits = toHits;
  } else {
    decision = decide(proposal.action, hits, proposal);
  }

  // Scope check: file_path should live under force-app/ (or .harness-sf/ for design itself).
  // Soft check — informational; doesn't override consistency decision.
  const scopeOk = !proposal.file_path || /^(force-app|\.harness-sf)\//.test(proposal.file_path);

  const out = {
    verified_at: new Date().toISOString(),
    design_path: path.relative(process.cwd(), designAbs).split(path.sep).join('/'),
    proposal,
    consistent: decision.consistent,
    reason: decision.reason,
    evidence: hits,
    scope_ok: scopeOk,
    recommendation: decision.consistent
      ? 'auto-apply (design-consistent)'
      : 'route to user 3-way: [1] code-fix anyway / [2] design-fix / [3] hold',
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

main();
