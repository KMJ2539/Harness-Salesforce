import type { LintRule, LintFinding } from "../types.js";

const CLASS_DECL =
  /(?<modifiers>(?:^|\n)\s*(?:global|public|private|protected)\s+(?:abstract\s+|virtual\s+|with\s+sharing\s+|without\s+sharing\s+|inherited\s+sharing\s+)*\s*class\s+(?<name>[A-Za-z_][A-Za-z0-9_]*))/g;

const SHARING_MODIFIER = /(?:with\s+sharing|without\s+sharing|inherited\s+sharing)/;

const TEST_OR_NESTED_HINT = /@isTest|@IsTest/;

export const sharingMissing: LintRule = {
  id: "apex.sharing_missing",
  apply({ file, source }): LintFinding[] {
    if (TEST_OR_NESTED_HINT.test(source)) return [];
    const findings: LintFinding[] = [];
    let topLevelChecked = false;
    for (const m of source.matchAll(CLASS_DECL)) {
      if (topLevelChecked) break;
      topLevelChecked = true;
      const decl = m.groups?.modifiers ?? "";
      const name = m.groups?.name;
      if (!SHARING_MODIFIER.test(decl)) {
        findings.push({
          category: "apex.sharing_missing",
          severity: "high",
          file,
          symbol: name,
          line: lineOf(source, m.index ?? 0),
          message: `class ${name} declared without sharing modifier`,
        });
      }
    }
    return findings;
  },
};

function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split("\n").length;
}
