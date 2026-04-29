// Integration tests for templates/hooks/pre-modify-approval-gate.js — blocks
// edits to existing force-app/ files unless a fresh modify-approval sentinel
// exists. Pairs with _lib/issue-modify-approval.js (TTL 30m).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../templates/hooks/pre-modify-approval-gate.js");
const ISSUE = resolve(__dirname, "../../../templates/hooks/_lib/issue-modify-approval.js");

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-mga-"));
  mkdirSync(join(tmp, "force-app/main/default/classes"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [HOOK], {
    encoding: "utf8",
    cwd: tmp,
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
  });
  return { status: r.status, stderr: r.stderr || "" };
}

function writePayload(file: string, tool = "Edit"): Record<string, unknown> {
  return { tool_name: tool, tool_input: { file_path: file } };
}

function approveModify(rel: string): void {
  const r = spawnSync(process.execPath, [ISSUE, rel], { encoding: "utf8", cwd: tmp });
  if (r.status !== 0) throw new Error(`issue-modify-approval failed: ${r.stderr}`);
}

function ensureExisting(rel: string, body = "// existing\n"): void {
  writeFileSync(join(tmp, rel), body);
}

describe("pre-modify-approval-gate — gating logic", () => {
  it("allows CREATE (file does not yet exist)", () => {
    const r = runHook(writePayload("force-app/main/default/classes/New.cls"));
    expect(r.status).toBe(0);
  });

  it("denies MODIFY (file exists) without sentinel", () => {
    const rel = "force-app/main/default/classes/Existing.cls";
    ensureExisting(rel);
    const r = runHook(writePayload(rel));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no approval sentinel found/);
    expect(r.stderr).toMatch(/issue-modify-approval/);
  });

  it("allows MODIFY after approval was issued", () => {
    const rel = "force-app/main/default/classes/Existing.cls";
    ensureExisting(rel);
    approveModify(rel);
    const r = runHook(writePayload(rel));
    expect(r.status).toBe(0);
  });
});

describe("pre-modify-approval-gate — out-of-scope paths", () => {
  it("ignores paths outside force-app/", () => {
    const rel = "src/foo.ts";
    mkdirSync(join(tmp, "src"), { recursive: true });
    ensureExisting(rel);
    const r = runHook(writePayload(rel));
    expect(r.status).toBe(0);
  });

  it("ignores non-Write tool calls", () => {
    const r = runHook({ tool_name: "Read", tool_input: { file_path: "anything" } });
    expect(r.status).toBe(0);
  });
});

describe("pre-modify-approval-gate — escape hatch", () => {
  it("HARNESS_SF_SKIP_MODIFY_GATE=1 bypasses the check", () => {
    const rel = "force-app/main/default/classes/Existing.cls";
    ensureExisting(rel);
    const r = runHook(writePayload(rel), { HARNESS_SF_SKIP_MODIFY_GATE: "1" });
    expect(r.status).toBe(0);
  });
});

describe("issue-modify-approval — input validation", () => {
  it("fails without args", () => {
    const r = spawnSync(process.execPath, [ISSUE], { encoding: "utf8", cwd: tmp });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no path provided/);
  });

  it("skips paths outside force-app/", () => {
    const rel = "src/x.ts";
    mkdirSync(join(tmp, "src"), { recursive: true });
    ensureExisting(rel);
    const r = spawnSync(process.execPath, [ISSUE, rel], { encoding: "utf8", cwd: tmp });
    expect(r.status).toBe(1); // 0 issued
    expect(r.stderr).toMatch(/outside force-app\/ — skipped/);
  });

  it("skips non-existent paths (CREATE mode does not need approval)", () => {
    const rel = "force-app/main/default/classes/Ghost.cls";
    const r = spawnSync(process.execPath, [ISSUE, rel], { encoding: "utf8", cwd: tmp });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/CREATE mode does not need approval/);
  });
});
