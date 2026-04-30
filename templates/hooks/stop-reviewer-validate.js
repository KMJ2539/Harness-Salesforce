#!/usr/bin/env node
// harness-sf SubagentStop hook. Validates output of design reviewers:
//   - sf-design-{ceo,eng,security,qa,library}-reviewer
// Rules:
//   - body must NOT contain a "block" verdict (case-insensitive token match).
//   - body must NOT exceed 80 lines (output budget invariant).
'use strict';
const cap = require('./_lib/output-cap');
const { formatBlock } = require('./_lib/gate-output');

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
    cap.blockWith(formatBlock({
      reason: `reviewer '${agent}' emitted a 'block' verdict (forbidden)`,
      why: "reviewers present tradeoffs only — the user decides; 'block' subverts that contract",
      fix: "rewrite the verdict using 'risk: high|medium|low' and present options",
      file: `agent body (assistant transcript) — see templates/agents/${agent}.md`,
      override: 'N/A — fix the underlying issue',
    }));
  }

  const lines = cap.lineCount(text);
  if (lines > BODY_MAX_LINES) {
    cap.blockWith(formatBlock({
      reason: `reviewer '${agent}' body is ${lines} lines (cap ${BODY_MAX_LINES})`,
      why: 'output budget keeps the orchestrator from context explosion; full review is persisted by the parent skill',
      fix: `drop lower-priority items until body ≤ ${BODY_MAX_LINES} lines; full detail goes to design.md '## Reviews'`,
      file: `agent body (assistant transcript) — see templates/agents/${agent}.md`,
      override: 'N/A — fix the underlying issue',
    }));
  }

  process.exit(0);
})();
