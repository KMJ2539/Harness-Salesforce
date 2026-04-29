// Integration tests for templates/hooks/stop-reviewer-validate.js — SubagentStop
// hook that enforces (1) no 'block' verdict and (2) ≤80-line body for design
// reviewers. The script writes a JSON decision to stdout (not exit 2) so
// Claude Code's SubagentStop contract can read it; we verify the JSON.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../templates/hooks/stop-reviewer-validate.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-rev-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeTranscript(text: string): string {
  const path = join(tmp, "transcript.jsonl");
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    }),
  );
  return path;
}

function runHook(
  agent: string,
  transcript_path: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [HOOK], {
    encoding: "utf8",
    input: JSON.stringify({ transcript_path }),
    env: { ...process.env, CLAUDE_AGENT: agent },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("stop-reviewer-validate — agent scope", () => {
  it("ignores non-reviewer agents (no decision emitted)", () => {
    const tp = makeTranscript("a".repeat(100));
    const r = runHook("sf-context-explorer", tp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it.each([
    "sf-design-ceo-reviewer",
    "sf-design-eng-reviewer",
    "sf-design-security-reviewer",
    "sf-design-qa-reviewer",
    "sf-design-library-reviewer",
  ])("applies to reviewer %s", (agent) => {
    const tp = makeTranscript("# Verdict\n\nrisk: medium\n");
    const r = runHook(agent, tp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("stop-reviewer-validate — block verdict ban", () => {
  it("blocks output containing 'block' as a verdict", () => {
    const tp = makeTranscript("verdict: block\n\nthis design is bad");
    const r = runHook("sf-design-eng-reviewer", tp);
    expect(r.status).toBe(0);
    const decision = JSON.parse(r.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toMatch(/forbidden from emitting 'block' verdicts/);
  });

  it("is case-insensitive", () => {
    const tp = makeTranscript("VERDICT: BLOCK");
    const r = runHook("sf-design-eng-reviewer", tp);
    const decision = JSON.parse(r.stdout);
    expect(decision.decision).toBe("block");
  });

  it("only matches whole-word 'block' (not 'blocking', 'blocked')", () => {
    // \b boundaries don't match between letters, so "blocking" would still
    // hit. Test the inverse: "blockchain" should hit since 'block' is a prefix
    // followed by 'chain' across a word boundary in regex terms? Actually
    // \bblock\b will NOT match "blocking" because the 'k' is followed by 'i'
    // (word char). Confirm.
    const tp = makeTranscript("the blocking issue is...");
    const r = runHook("sf-design-eng-reviewer", tp);
    expect(r.stdout).toBe("");
  });
});

describe("stop-reviewer-validate — line cap", () => {
  it("blocks bodies over 80 lines", () => {
    const tp = makeTranscript(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"));
    const r = runHook("sf-design-eng-reviewer", tp);
    const decision = JSON.parse(r.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toMatch(/100 lines.*max 80/);
  });

  it("allows bodies at the 80-line cap", () => {
    const tp = makeTranscript(Array.from({ length: 80 }, (_, i) => `l${i}`).join("\n"));
    const r = runHook("sf-design-eng-reviewer", tp);
    expect(r.stdout).toBe("");
  });
});

describe("stop-reviewer-validate — missing transcript", () => {
  it("exits 0 silently when transcript_path is absent", () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      input: JSON.stringify({}),
      env: { ...process.env, CLAUDE_AGENT: "sf-design-eng-reviewer" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
