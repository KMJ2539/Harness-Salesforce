import type { FindingCategory, Severity } from "../contracts/expected.js";

export interface LintFinding {
  category: FindingCategory;
  severity: Severity;
  file: string;
  symbol?: string;
  line?: number;
  message: string;
}

export interface LintRule {
  id: FindingCategory;
  apply(input: { file: string; source: string }): LintFinding[];
}
