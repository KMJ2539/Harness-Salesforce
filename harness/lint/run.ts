import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { APEX_RULES } from "./apex/index.js";
import type { LintFinding } from "./types.js";

export function lintFixture(fixturePath: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const apexFiles = walk(fixturePath).filter((p) => p.endsWith(".cls"));
  for (const path of apexFiles) {
    const source = readFileSync(path, "utf8");
    const file = basename(path);
    for (const rule of APEX_RULES) {
      findings.push(...rule.apply({ file, source }));
    }
  }
  return findings;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
