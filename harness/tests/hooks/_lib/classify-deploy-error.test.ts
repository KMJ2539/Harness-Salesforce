// CLI integration tests for classify-deploy-error.js — pattern-matches deploy
// errors as 'mechanical' (auto-fixable candidate) or 'logical' (requires human
// judgment). The classifier feeds /sf-feature Step 7.5; misclassifying a
// logical error as mechanical would let the orchestrator auto-patch real bugs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../../../templates/hooks/_lib/classify-deploy-error.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-cde-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function classifyJson(input: unknown): { status: number | null; stdout: string; stderr: string } {
  const file = join(tmp, "in.json");
  writeFileSync(file, JSON.stringify(input));
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("classify-deploy-error — input shapes", () => {
  it("fails on missing input file", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "no-such.json"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  it("fails on malformed JSON", () => {
    const file = join(tmp, "bad.json");
    writeFileSync(file, "{ not json");
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not valid JSON/);
  });

  it("accepts {errors:[...]} shape", () => {
    const r = classifyJson({ errors: [{ message: "INVALID_CROSS_REFERENCE_KEY: Status__c" }] });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("mechanical");
  });

  it("accepts sf CLI {result.details.componentFailures} shape", () => {
    const r = classifyJson({
      result: {
        details: {
          componentFailures: [
            { problem: "No such column 'Status__c' on entity 'Account'", fileName: "Foo.cls" },
          ],
        },
      },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].file).toBe("Foo.cls");
  });
});

describe("classify-deploy-error — mechanical patterns", () => {
  it("classifies field-not-found as mechanical", () => {
    const r = classifyJson({ errors: [{ message: "No such column 'Status__c' on entity 'Account'" }] });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("mechanical");
    expect(out.errors[0].category).toBe("field-not-found");
    expect(out.errors[0].target).toBe("Status__c");
  });

  it("classifies CMT-record-missing as mechanical", () => {
    const r = classifyJson({
      errors: [{ message: "Custom Metadata Type 'FeatureFlag__mdt' has no records" }],
    });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("mechanical");
    expect(out.errors[0].category).toBe("cmt-record-missing");
  });
});

describe("classify-deploy-error — logical hard patterns (NEVER auto-fix)", () => {
  it("classifies AssertException as logical", () => {
    const r = classifyJson({ errors: [{ message: "System.AssertException: Assertion Failed: Expected 5 but got 3" }] });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("logical");
    expect(out.errors[0].category).toBe("hard-logical");
  });

  it("classifies governor limit as logical", () => {
    const r = classifyJson({ errors: [{ message: "System.LimitException: Too many SOQL queries: 101" }] });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("logical");
  });

  it("classifies UNABLE_TO_LOCK_ROW as logical", () => {
    const r = classifyJson({ errors: [{ message: "UNABLE_TO_LOCK_ROW: row was locked" }] });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("logical");
  });

  it("classifies missing-method compile as logical (not mechanical)", () => {
    const r = classifyJson({
      errors: [{ message: "Method does not exist or incorrect signature: AccountService.foo()" }],
    });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("logical");
  });

  it("classifies unmatched messages as logical/unmatched", () => {
    const r = classifyJson({ errors: [{ message: "weird unexpected error from platform" }] });
    const out = JSON.parse(r.stdout);
    expect(out.errors[0].type).toBe("logical");
    expect(out.errors[0].category).toBe("unmatched");
  });
});

describe("classify-deploy-error — summary + auto_fix_eligible flag", () => {
  it("handles empty errors array gracefully", () => {
    const r = classifyJson({ errors: [] });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.errors).toEqual([]);
    expect(out.summary.total).toBe(0);
    expect(out.auto_fix_eligible).toBe(false);
  });

  it("auto_fix_eligible is true only when all errors are mechanical", () => {
    const r1 = classifyJson({
      errors: [
        { message: "No such column 'A__c'" },
        { message: "Custom Metadata Type 'B__mdt' has no records" },
      ],
    });
    const out1 = JSON.parse(r1.stdout);
    expect(out1.auto_fix_eligible).toBe(true);
    expect(out1.summary.mechanical).toBe(2);
    expect(out1.summary.logical).toBe(0);

    const r2 = classifyJson({
      errors: [
        { message: "No such column 'A__c'" },
        { message: "System.AssertException: failed" },
      ],
    });
    const out2 = JSON.parse(r2.stdout);
    expect(out2.auto_fix_eligible).toBe(false);
  });
});
