#!/usr/bin/env node
// Static logging-convention check for Apex entry points.
// Per gate-hardening v3 PR gate-5 — replaces LLM-only judgment with a
// deterministic regex pass; LLM is invoked only when the static check fails.
//
// Configuration (PROJECT.md):
//   logging:
//     entry_pattern: ["Logger.log(", "LogService.info("]   # literal substrings
//     entry_pattern_regex: ["App\\.log\\(.*\\)"]            # optional, regex
//     scan_lines: 10                                        # default 10
//     exclude: ["**/test/**/*.cls"]                         # default
//
// Usage:
//   node check-logging.js <file.cls> [<file2.cls> ...]
//   node check-logging.js --scan force-app/  (recurses to all .cls + .trigger)
//
// Exit:
//   0 — all entry points have logging (or no entry points)
//   1 — at least one entry-point method MISS
//   2 — bad arguments / config
//
// Output: JSON array of { file, method, line, status: 'pass'|'miss' }.

'use strict';

const fs = require('fs');
const path = require('path');

const ENTRY_RE = /(?:@AuraEnabled[^\n]*|@InvocableMethod[^\n]*|@HttpGet|@HttpPost|@HttpPut|@HttpDelete|@HttpPatch|webservice\s+static|global\s+static)\s+[^{]*\{/g;

function loadProjectConfig() {
  const cwd = process.cwd();
  const p = path.join(cwd, '.harness-sf', 'PROJECT.md');
  const out = {
    entry_patterns: ['Logger.log('],
    entry_regexes: [],
    scan_lines: 10,
    exclude: [/[\\/]test[\\/].*\.cls$/, /[\\/]test[\\/].*\.trigger$/],
  };
  if (!fs.existsSync(p)) return out;
  const text = fs.readFileSync(p, 'utf8');

  // Naive YAML-ish read — single-line scalars in a `logging:` block.
  const m = text.match(/logging:\s*\n([\s\S]*?)(?=\n[A-Za-z]|\n##|\n$)/);
  if (!m) return out;
  const block = m[1];

  const patterns = [];
  const list = block.match(/entry_pattern:\s*\[([^\]]*)\]/);
  if (list) {
    for (const item of list[1].split(',')) {
      const v = item.trim().replace(/^['"]|['"]$/g, '');
      if (v) patterns.push(v);
    }
  }
  if (patterns.length) out.entry_patterns = patterns;

  const regexes = [];
  const rlist = block.match(/entry_pattern_regex:\s*\[([^\]]*)\]/);
  if (rlist) {
    for (const item of rlist[1].split(',')) {
      const v = item.trim().replace(/^['"]|['"]$/g, '');
      if (v) {
        try { regexes.push(new RegExp(v)); }
        catch { process.stderr.write(`check-logging: bad entry_pattern_regex '${v}' — skipped\n`); }
      }
    }
  }
  out.entry_regexes = regexes;

  const sl = block.match(/scan_lines:\s*(\d+)/);
  if (sl) out.scan_lines = parseInt(sl[1], 10);

  return out;
}

function scanFile(filePath, cfg) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const findings = [];

  let m;
  // Reset lastIndex per file.
  ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(text)) !== null) {
    // Find line number of the opening brace.
    const upTo = text.slice(0, m.index + m[0].length);
    const lineNum = upTo.split('\n').length;
    // Method name — best-effort match before '('.
    const methodMatch = m[0].match(/(\w+)\s*\([^)]*\)\s*\{$/);
    const method = methodMatch ? methodMatch[1] : '<unknown>';

    // Scan next N lines after the opening brace for a logger call.
    const fromLine = lineNum;
    const toLine = Math.min(lines.length, fromLine + cfg.scan_lines);
    const body = lines.slice(fromLine - 1, toLine).join('\n');

    let pass = false;
    for (const lit of cfg.entry_patterns) {
      if (body.includes(lit)) { pass = true; break; }
    }
    if (!pass) {
      for (const re of cfg.entry_regexes) {
        if (re.test(body)) { pass = true; break; }
      }
    }

    findings.push({
      file: path.relative(process.cwd(), filePath).split(path.sep).join('/'),
      method,
      line: lineNum,
      status: pass ? 'pass' : 'miss',
    });
  }
  return findings;
}

function isExcluded(p, cfg) {
  return cfg.exclude.some(re => re.test(p));
}

function walkApex(rootAbs, accum) {
  let entries;
  try { entries = fs.readdirSync(rootAbs, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const abs = path.join(rootAbs, ent.name);
    if (ent.isDirectory()) walkApex(abs, accum);
    else if (ent.isFile() && (ent.name.endsWith('.cls') || ent.name.endsWith('.trigger'))) {
      accum.push(abs);
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    process.stderr.write('check-logging: usage: <file.cls> [...] | --scan <dir>\n');
    process.exit(2);
  }

  const cfg = loadProjectConfig();
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scan') {
      const dir = argv[++i];
      if (!dir) { process.stderr.write('check-logging: --scan requires a directory\n'); process.exit(2); }
      walkApex(path.resolve(process.cwd(), dir), files);
    } else {
      files.push(path.resolve(process.cwd(), argv[i]));
    }
  }

  const findings = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    if (isExcluded(f, cfg)) continue;
    findings.push(...scanFile(f, cfg));
  }

  process.stdout.write(JSON.stringify(findings, null, 2) + '\n');

  const missCount = findings.filter(x => x.status === 'miss').length;
  process.exit(missCount > 0 ? 1 : 0);
}

main();
