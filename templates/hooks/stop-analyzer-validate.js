#!/usr/bin/env node
// harness-sf SubagentStop hook. Validates output of analyzer agents:
//   - sf-context-explorer, sf-flow-analyzer, sf-trigger-auditor, sf-lwc-auditor, sf-bug-investigator
// Rules:
//   - body must NOT exceed 80 lines (output budget invariant).
//   - body's last non-empty line must reference a detail dump path: 'detail: .harness-sf/reports/...'
//     (analyzers Write full detail to .harness-sf/reports/{agent}/...; the body is the summary.)
'use strict';
const cap = require('./_lib/output-cap');
const { formatBlock } = require('./_lib/gate-output');

const ANALYZER_AGENTS = new Set([
  'sf-context-explorer',
  'sf-flow-analyzer',
  'sf-trigger-auditor',
  'sf-lwc-auditor',
  'sf-bug-investigator',
]);
const BODY_MAX_LINES = 80;
// Match 'detail' / 'details' followed by a colon and a .harness-sf/reports/ path.
const DETAIL_LINE_RE = /(detail|details)\s*[:：]\s*\.?\/?\.?\.?\/?\s*\.harness-sf\/reports\//i;

(function main() {
  const agent = (process.env.CLAUDE_AGENT || '').trim();
  if (!ANALYZER_AGENTS.has(agent)) process.exit(0);

  const payload = cap.readStdinJson();
  const text = cap.lastAssistantText(payload.transcript_path);
  if (!text) process.exit(0);

  const lines = cap.lineCount(text);
  if (lines > BODY_MAX_LINES) {
    cap.blockWith(formatBlock({
      reason: `analyzer '${agent}' body is ${lines} lines (cap ${BODY_MAX_LINES})`,
      why: 'output budget keeps the orchestrator from context explosion — analyzers must emit a summary, not the full detail',
      fix: `move detail under .harness-sf/reports/${agent}/ and re-emit a summary ending with 'detail: <that path>'`,
      file: `.harness-sf/reports/${agent}/`,
      override: 'N/A — fix the underlying issue',
    }));
  }

  // Last non-empty line must declare the detail dump path.
  const nonEmpty = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const tail = nonEmpty.slice(-3).join('\n'); // tolerate a closing fence or signature line
  if (!DETAIL_LINE_RE.test(tail)) {
    cap.blockWith(formatBlock({
      reason: `analyzer '${agent}' missing detail-dump pointer at end of body`,
      why: 'invariant: analyzer body ends with `detail: .harness-sf/reports/<agent>/<file>.md` so the orchestrator can locate the full report',
      fix: `Write the full report to .harness-sf/reports/${agent}/{slug}-{YYYYMMDD-HHMMSS}.md, then re-emit a body whose last line is 'detail: <that path>'`,
      file: `.harness-sf/reports/${agent}/`,
      override: 'N/A — fix the underlying issue',
    }));
  }

  process.exit(0);
})();
