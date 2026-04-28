import type { LintRule, LintFinding } from "../types.js";

const SF_ID_LITERAL = /'(?<id>[a-zA-Z0-9]{3}[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)'/g;

const VALID_PREFIX = /^(00[0-9]|01[02tQI]|005|006|012|015|500|800|a[0-9A-Z]{2})/i;

export const hardcodedId: LintRule = {
  id: "apex.hardcoded_id",
  apply({ file, source }): LintFinding[] {
    const findings: LintFinding[] = [];
    const className = extractClassName(source);
    for (const m of source.matchAll(SF_ID_LITERAL)) {
      const id = m.groups?.id ?? "";
      if (id.length !== 15 && id.length !== 18) continue;
      if (!VALID_PREFIX.test(id)) continue;
      findings.push({
        category: "apex.hardcoded_id",
        severity: "high",
        file,
        symbol: className,
        line: lineOf(source, m.index ?? 0),
        message: `hardcoded SF ID literal '${id}' — use Custom Settings/Metadata or Schema lookup`,
      });
    }
    return findings;
  },
};

function extractClassName(source: string): string | undefined {
  const m = source.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1];
}

function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split("\n").length;
}
