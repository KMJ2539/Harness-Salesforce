#!/usr/bin/env node
// harness-sf — classify deploy validate errors as mechanical (auto-fixable
// candidate) or logical (user judgment required).
//
// Called by /sf-feature Step 7.5 after sf-deploy-validator emits findings JSON
// to .harness-sf/.cache/deploy-findings/{slug}.json. The classifier reads that
// file (or stdin), pattern-matches against a mechanical whitelist, and writes
// a classified result to .harness-sf/.cache/deploy-classify/{slug}.json.
//
// Usage:
//   node .claude/hooks/_lib/classify-deploy-error.js <findings-json-path> [--out <path>]
//   cat findings.json | node classify-deploy-error.js - [--out <path>]
//
// Exit:
//   0 — classified successfully (always; even all-logical or empty errors)
//   1 — input malformed / file missing
//
// Mechanical whitelist (regex patterns; everything else → logical):
//   - INVALID_CROSS_REFERENCE_KEY mentioning a field/class identifier
//   - "Field <X> does not exist" / "does not exist or is not visible"
//   - "No CRUD access" / "FLS missing" / "field-level security" mentioning a field
//   - "Class <X> not visible" / "PermissionSet ... missing classAccess"
//   - "Custom Metadata Type <X> has no records"
//   - "Field <X>.<Y>__c is required but missing" in PS XML
//
// Logical (NEVER auto-fix):
//   - System.AssertException / assertion failures (test bodies)
//   - Compile errors with missing methods or wrong signatures
//   - Governor limit exceptions
//   - Sharing / CRUD violations at runtime
//   - UNABLE_TO_LOCK_ROW / mixed DML / async timing
//   - Anything not matching mechanical whitelist

'use strict';
const fs = require('fs');
const path = require('path');

const MECHANICAL_PATTERNS = [
  {
    category: 'field-not-found',
    re: /(?:INVALID_CROSS_REFERENCE_KEY|No such column|does not exist or is not visible|Variable does not exist):?\s*['"]?([\w]+__c|[\w]+)['"]?/i,
    target_kind: 'field',
  },
  {
    category: 'fls-missing-in-ps',
    re: /(?:Field|fieldPermissions)\s+([\w]+\.[\w]+__c|[\w]+\.[\w]+)\s+(?:requires|missing)\s+field-level\s+security|FLS.*?([\w]+\.[\w]+__c)/i,
    target_kind: 'fls',
  },
  {
    category: 'class-access-missing-in-ps',
    re: /(?:Class|Apex class)\s+['"]?([\w]+)['"]?\s+(?:not visible|missing|requires).*?(?:permission|access)|classAccess.*?missing.*?([\w]+)/i,
    target_kind: 'class-access',
  },
  {
    category: 'cmt-record-missing',
    re: /Custom Metadata (?:Type|record)\s+['"]?([\w]+(?:\.[\w]+)?(?:__mdt)?)['"]?\s+(?:has no records|not found|does not exist)/i,
    target_kind: 'cmt-record',
  },
  {
    category: 'ps-field-reference-stale',
    re: /Field reference\s+['"]?([\w]+\.[\w]+__c)['"]?\s+(?:no longer exists|is invalid)/i,
    target_kind: 'fls',
  },
];

const LOGICAL_HARD_PATTERNS = [
  /System\.AssertException/i,
  /Assert(?:ion)?\s+(?:Failed|Equals)/i,
  /System\.LimitException/i,
  /Too many (?:SOQL|DML|query rows|callouts)/i,
  /UNABLE_TO_LOCK_ROW/i,
  /MIXED_DML_OPERATION/i,
  /CIRCULAR_DEPENDENCY/i,
  /System\.NoAccessException/i,
  /INSUFFICIENT_ACCESS/i,
  /Method does not exist or incorrect signature/i,
  /Variable does not exist:\s*[\w]+\s*\(/i,
];

function classifyOne(err) {
  const msg = err.message || err.problem || err.stackTrace || JSON.stringify(err);

  for (const p of LOGICAL_HARD_PATTERNS) {
    if (p.test(msg)) {
      return {
        type: 'logical',
        category: 'hard-logical',
        target_kind: null,
        target: null,
        file: err.fileName || err.filePath || null,
        line: err.lineNumber || null,
        raw: msg.slice(0, 500),
      };
    }
  }

  for (const p of MECHANICAL_PATTERNS) {
    const m = msg.match(p.re);
    if (m) {
      const target = m[1] || m[2] || null;
      return {
        type: 'mechanical',
        category: p.category,
        target_kind: p.target_kind,
        target,
        file: err.fileName || err.filePath || null,
        line: err.lineNumber || null,
        raw: msg.slice(0, 500),
      };
    }
  }

  return {
    type: 'logical',
    category: 'unmatched',
    target_kind: null,
    target: null,
    file: err.fileName || err.filePath || null,
    line: err.lineNumber || null,
    raw: msg.slice(0, 500),
  };
}

function main() {
  const args = process.argv.slice(2);
  const inputArg = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  if (!inputArg) {
    process.stderr.write('classify-deploy-error: usage: <findings-json-path> | - [--out <path>]\n');
    process.exit(1);
  }

  let raw;
  if (inputArg === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    const abs = path.isAbsolute(inputArg) ? inputArg : path.resolve(process.cwd(), inputArg);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`classify-deploy-error: '${inputArg}' does not exist\n`);
      process.exit(1);
    }
    raw = fs.readFileSync(abs, 'utf8');
  }

  let findings;
  try {
    findings = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`classify-deploy-error: input is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }

  // Accept either {componentFailures, runTestResult: {failures}} (sf CLI shape)
  // or {errors: [...]} (pre-normalized).
  const errors = [];
  if (Array.isArray(findings.errors)) {
    errors.push(...findings.errors);
  }
  if (Array.isArray(findings.componentFailures)) {
    errors.push(...findings.componentFailures);
  }
  if (findings.runTestResult && Array.isArray(findings.runTestResult.failures)) {
    errors.push(...findings.runTestResult.failures);
  }
  if (findings.result && findings.result.details) {
    const d = findings.result.details;
    if (Array.isArray(d.componentFailures)) errors.push(...d.componentFailures);
    if (d.runTestResult && Array.isArray(d.runTestResult.failures)) errors.push(...d.runTestResult.failures);
  }

  const classified = errors.map(classifyOne);
  const summary = {
    total: classified.length,
    mechanical: classified.filter((c) => c.type === 'mechanical').length,
    logical: classified.filter((c) => c.type === 'logical').length,
    by_category: {},
  };
  for (const c of classified) {
    summary.by_category[c.category] = (summary.by_category[c.category] || 0) + 1;
  }

  const result = {
    classified_at: new Date().toISOString(),
    summary,
    errors: classified,
    auto_fix_eligible: summary.mechanical > 0 && summary.logical === 0,
  };

  const json = JSON.stringify(result, null, 2);
  if (outPath) {
    const outAbs = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, json);
    process.stderr.write(`wrote: ${path.relative(process.cwd(), outAbs).split(path.sep).join('/')}\n`);
  }
  process.stdout.write(json + '\n');
  process.exit(0);
}

main();
