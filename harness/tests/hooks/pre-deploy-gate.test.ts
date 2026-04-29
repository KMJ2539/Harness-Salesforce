// Integration tests for templates/hooks/pre-deploy-gate.js — blocks
// `sf project deploy start` unless .harness-sf/last-validation.json proves a
// recent validate-only run with Succeeded result and coverage ≥ target.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../templates/hooks/pre-deploy-gate.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-pdg-"));
  mkdirSync(join(tmp, ".harness-sf"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runHook(
  cmd: string,
  env: Record<string, string> = {},
): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [HOOK], {
    encoding: "utf8",
    cwd: tmp,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }),
    env: { ...process.env, ...env },
  });
  return { status: r.status, stderr: r.stderr || "" };
}

function writeValidation(extra: Record<string, unknown> = {}): void {
  const data = {
    validation_result: "Succeeded",
    validated_at: new Date().toISOString(),
    head_sha: null, // skip head-sha check (no git in tmp)
    coverage_overall: 80,
    ...extra,
  };
  writeFileSync(join(tmp, ".harness-sf", "last-validation.json"), JSON.stringify(data));
}

describe("pre-deploy-gate — command matching", () => {
  it("ignores non-deploy Bash commands", () => {
    const r = runHook("ls -la");
    expect(r.status).toBe(0);
  });

  it("ignores non-Bash tools", () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      cwd: tmp,
      input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" } }),
    });
    expect(r.status).toBe(0);
  });

  it("matches `sf project deploy start`", () => {
    const r = runHook("sf project deploy start --target-org dev");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no \.harness-sf\/last-validation\.json/);
  });

  it("matches legacy `sfdx force:source:deploy`", () => {
    const r = runHook("sfdx force:source:deploy -p force-app");
    expect(r.status).toBe(2);
  });
});

describe("pre-deploy-gate — validation file", () => {
  it("denies when validation_result is not Succeeded", () => {
    writeValidation({ validation_result: "Failed" });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/last validation_result='Failed'/);
  });

  it("denies on stale validation (>30 min old)", () => {
    writeValidation({ validated_at: new Date(Date.now() - 31 * 60_000).toISOString() });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/sentinel is \d+m old/);
  });

  it("denies when last-validation.json is malformed", () => {
    writeFileSync(join(tmp, ".harness-sf", "last-validation.json"), "{ bad json");
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unreadable/);
  });
});

describe("pre-deploy-gate — coverage gate", () => {
  it("denies when coverage_overall is missing", () => {
    writeValidation({ coverage_overall: undefined });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/coverage_overall missing/);
  });

  it("denies when coverage is below default 75% target", () => {
    writeValidation({ coverage_overall: 70 });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/coverage 70% < target 75%/);
  });

  it("respects HARNESS_SF_COVERAGE_TARGET env override", () => {
    writeValidation({ coverage_overall: 80 });
    const r = runHook("sf project deploy start", { HARNESS_SF_COVERAGE_TARGET: "85" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/coverage 80% < target 85%/);
  });

  it("respects PROJECT.md coverage_target_percent override", () => {
    writeFileSync(
      join(tmp, ".harness-sf", "PROJECT.md"),
      "# Project\ncoverage_target_percent: 90\n",
    );
    writeValidation({ coverage_overall: 85 });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/target 90%/);
  });

  it("allows when fresh + Succeeded + coverage ≥ target", () => {
    writeValidation({ coverage_overall: 80 });
    const r = runHook("sf project deploy start");
    expect(r.status).toBe(0);
  });
});

describe("pre-deploy-gate — escape hatch", () => {
  it("HARNESS_SF_SKIP_DEPLOY_GATE=1 bypasses everything", () => {
    // No validation file, no coverage — would normally fail.
    const r = runHook("sf project deploy start", { HARNESS_SF_SKIP_DEPLOY_GATE: "1" });
    expect(r.status).toBe(0);
  });
});
