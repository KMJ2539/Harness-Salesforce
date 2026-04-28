#!/usr/bin/env node
// harness-sf SubagentStop hook. Validates output of design reviewers:
//   - sf-design-{ceo,eng,security,qa,library}-reviewer
// Rules:
//   - body must NOT contain a "block" verdict (case-insensitive token match).
//   - body must NOT exceed 80 lines (output budget invariant).
'use strict';
const cap = require('./_lib/output-cap');

const REVIEWER_PATTERN = /^sf-design-(ceo|eng|security|qa|library)-reviewer$/;
const BODY_MAX_LINES = 80;
const BLOCK_VERDICT_RE = /\bblock\b/i;

(function main() {
  const agent = (process.env.CLAUDE_AGENT || '').trim();
  if (!REVIEWER_PATTERN.test(agent)) process.exit(0);

  const payload = cap.readStdinJson();
  const text = cap.lastAssistantText(payload.transcript_path);
  if (!text) process.exit(0);

  if (BLOCK_VERDICT_RE.test(text)) {
    cap.blockWith(`[harness-sf] reviewer '${agent}' is forbidden from emitting 'block' verdicts. Use 'risk: high|medium|low' and present tradeoffs only — the user decides. Revise the report.`);
  }

  const lines = cap.lineCount(text);
  if (lines > BODY_MAX_LINES) {
    cap.blockWith(`[harness-sf] reviewer '${agent}' body is ${lines} lines (max ${BODY_MAX_LINES}). Drop lower-priority items and re-emit. Full review is preserved by the parent skill via design.md '## Reviews'.`);
  }

  process.exit(0);
})();
