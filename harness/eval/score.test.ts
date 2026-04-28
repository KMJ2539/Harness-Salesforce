import { describe, it, expect } from "vitest";
import { score } from "./score.js";
import type { Expected } from "../contracts/expected.js";
import type { LintFinding } from "../lint/types.js";

describe("score", () => {
  it("perfect match — precision/recall/f1 = 1", () => {
    const expected: Expected = {
      findings: [
        {
          category: "apex.sharing_missing",
          severity: "high",
          locator: { file: "Foo.cls", symbol: "Foo" },
        },
      ],
    };
    const actual: LintFinding[] = [
      { category: "apex.sharing_missing", severity: "high", file: "Foo.cls", symbol: "Foo", message: "" },
    ];
    const r = score(expected, actual);
    expect(r.truePositives).toBe(1);
    expect(r.falsePositives).toBe(0);
    expect(r.falseNegatives).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it("severity mismatch yields partial credit 0.5", () => {
    const expected: Expected = {
      findings: [{ category: "apex.sharing_missing", severity: "high" }],
    };
    const actual: LintFinding[] = [
      { category: "apex.sharing_missing", severity: "low", file: "F.cls", message: "" },
    ];
    const r = score(expected, actual);
    expect(r.partialCredit).toBeCloseTo(0.5);
    expect(r.truePositives).toBe(0);
  });

  it("clean baseline: empty expected + empty actual = perfect", () => {
    const r = score({ findings: [] }, []);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
  });

  it("false positive lowers precision", () => {
    const expected: Expected = { findings: [] };
    const actual: LintFinding[] = [
      { category: "apex.hardcoded_id", severity: "high", file: "X.cls", message: "" },
    ];
    const r = score(expected, actual);
    expect(r.falsePositives).toBe(1);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(1);
  });

  it("missing finding lowers recall", () => {
    const expected: Expected = {
      findings: [{ category: "apex.sharing_missing", severity: "high" }],
    };
    const r = score(expected, []);
    expect(r.falseNegatives).toBe(1);
    expect(r.recall).toBe(0);
  });

  it("file/symbol locator partial credit", () => {
    const expected: Expected = {
      findings: [
        {
          category: "apex.hardcoded_id",
          severity: "high",
          locator: { file: "RT.cls", symbol: "RT" },
        },
      ],
    };
    const actual: LintFinding[] = [
      { category: "apex.hardcoded_id", severity: "high", file: "RT.cls", message: "" },
    ];
    const r = score(expected, actual);
    expect(r.matches[0].fileMatch).toBe(true);
    expect(r.matches[0].symbolMatch).toBe(false);
    expect(r.matches[0].credit).toBeCloseTo(1.25);
  });
});
