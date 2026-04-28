import type { LintRule, LintFinding } from "../types.js";

const DATABASE_QUERY_CALL = /Database\.query\s*\(\s*(?<arg>[^)]+?)\)/g;

export const dynamicSoqlUnsafe: LintRule = {
  id: "apex.dynamic_soql_unsafe",
  apply({ file, source }): LintFinding[] {
    const findings: LintFinding[] = [];
    for (const m of source.matchAll(DATABASE_QUERY_CALL)) {
      const arg = m.groups?.arg ?? "";
      const lookback = expandToBuilderContext(source, m.index ?? 0);
      const argConcat = /\+/.test(arg);
      const builderConcat = /\+\s*[A-Za-z_][A-Za-z0-9_]*/.test(lookback);
      if (!argConcat && !builderConcat) continue;
      const escaped = /String\.escapeSingleQuotes\s*\(/.test(lookback);
      if (escaped) continue;
      findings.push({
        category: "apex.dynamic_soql_unsafe",
        severity: "high",
        file,
        symbol: enclosingMethod(source, m.index ?? 0),
        line: lineOf(source, m.index ?? 0),
        message: "Database.query() with string concatenation but no String.escapeSingleQuotes()",
      });
    }
    return findings;
  },
};

function expandToBuilderContext(source: string, queryIdx: number): string {
  const start = Math.max(0, queryIdx - 400);
  return source.slice(start, queryIdx + 200);
}

function enclosingMethod(source: string, idx: number): string | undefined {
  const before = source.slice(0, idx);
  const m = [...before.matchAll(/\b(?:public|private|protected|global)\s+(?:static\s+)?[A-Za-z<>,\s\[\]]+?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)];
  return m.length ? m[m.length - 1][1] : undefined;
}

function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split("\n").length;
}
