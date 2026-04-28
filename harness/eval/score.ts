import type { ExpectedFinding, Expected } from "../contracts/expected.js";
import type { LintFinding } from "../lint/types.js";

export interface ScoreReport {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  partialCredit: number;
  precision: number;
  recall: number;
  f1: number;
  matches: Array<{
    expected: ExpectedFinding;
    actual?: LintFinding;
    credit: number;
    severityMatch: boolean;
    fileMatch: boolean;
    symbolMatch: boolean;
  }>;
  unexpected: LintFinding[];
}

export function score(expected: Expected, actual: LintFinding[]): ScoreReport {
  const matches: ScoreReport["matches"] = [];
  const usedActualIdx = new Set<number>();
  let truePositives = 0;
  let partialCredit = 0;

  for (const exp of expected.findings) {
    let bestIdx = -1;
    let bestCredit = 0;
    let bestDetail = { severityMatch: false, fileMatch: false, symbolMatch: false };

    actual.forEach((act, idx) => {
      if (usedActualIdx.has(idx)) return;
      if (act.category !== exp.category) return;
      const severityMatch = act.severity === exp.severity;
      const fileMatch = exp.locator?.file === act.file;
      const symbolMatch = !!exp.locator?.symbol && exp.locator.symbol === act.symbol;
      const credit =
        (severityMatch ? 1 : 0.5) +
        (fileMatch ? 0.25 : 0) +
        (symbolMatch ? 0.25 : 0);
      if (credit > bestCredit) {
        bestCredit = credit;
        bestIdx = idx;
        bestDetail = { severityMatch, fileMatch, symbolMatch };
      }
    });

    if (bestIdx >= 0) {
      usedActualIdx.add(bestIdx);
      matches.push({
        expected: exp,
        actual: actual[bestIdx],
        credit: bestCredit,
        ...bestDetail,
      });
      if (bestDetail.severityMatch) truePositives += 1;
      else partialCredit += 0.5;
    } else {
      matches.push({
        expected: exp,
        credit: 0,
        severityMatch: false,
        fileMatch: false,
        symbolMatch: false,
      });
    }
  }

  const unexpected = actual.filter((_, idx) => !usedActualIdx.has(idx));
  const falsePositives = unexpected.length;
  const falseNegatives = matches.filter((m) => !m.actual).length;

  const tpEffective = truePositives + partialCredit;
  const precision = tpEffective + falsePositives === 0
    ? 1
    : tpEffective / (tpEffective + falsePositives);
  const recall = expected.findings.length === 0
    ? 1
    : tpEffective / expected.findings.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    partialCredit,
    precision,
    recall,
    f1,
    matches,
    unexpected,
  };
}
