// Shared helpers for SubagentStop hooks (reviewer / analyzer caps).
// Zero-dep, Node >= 18.
'use strict';
const fs = require('fs');

function readStdinJson() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return {}; }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// Extract the last assistant text block from a JSONL transcript file.
// Returns '' on any failure (caller should treat as "nothing to validate").
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry && entry.type === 'assistant' && entry.message && Array.isArray(entry.message.content)) {
      const textBlocks = entry.message.content.filter(c => c && c.type === 'text').map(c => c.text || '');
      if (textBlocks.length) return textBlocks.join('\n');
    }
  }
  return '';
}

function lineCount(text) { return text ? text.split(/\r?\n/).length : 0; }

// Emit a SubagentStop block decision and exit 0 (Claude Code reads the JSON, not the exit code).
function blockWith(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

module.exports = { readStdinJson, lastAssistantText, lineCount, blockWith };
