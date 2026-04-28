import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAllFixtures } from "./run-fixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "sfdx-projects");

describe("end-to-end fixture run", () => {
  const results = runAllFixtures(FIXTURES_ROOT);

  it("discovers all 3 starter fixtures", () => {
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["clean-baseline", "fls-missing-apex", "hardcoded-id"]);
  });

  it("clean-baseline has zero findings (false positive 0)", () => {
    const r = results.find((r) => r.name === "clean-baseline")!;
    expect(r.actualCount).toBe(0);
    expect(r.report.precision).toBe(1);
    expect(r.report.recall).toBe(1);
  });

  it("fls-missing-apex catches sharing_missing AND dynamic_soql_unsafe (recall = 1)", () => {
    const r = results.find((r) => r.name === "fls-missing-apex")!;
    expect(r.report.falseNegatives).toBe(0);
    expect(r.report.recall).toBe(1);
    const categories = r.report.matches.map((m) => m.expected.category).sort();
    expect(categories).toEqual(["apex.dynamic_soql_unsafe", "apex.sharing_missing"]);
  });

  it("hardcoded-id catches the literal (recall = 1)", () => {
    const r = results.find((r) => r.name === "hardcoded-id")!;
    expect(r.report.falseNegatives).toBe(0);
    expect(r.report.recall).toBe(1);
    expect(r.report.matches[0].expected.category).toBe("apex.hardcoded_id");
  });

  it("aggregate F1 across all fixtures > 0.9 (sanity bar)", () => {
    const avg =
      results.reduce((sum, r) => sum + r.report.f1, 0) / results.length;
    expect(avg).toBeGreaterThan(0.9);
  });
});
