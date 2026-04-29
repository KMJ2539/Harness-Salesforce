// CLI integration tests for issue-design-approval.js — the entry point that
// stamps a sentinel after the user approves design.md. Verifies the gate
// rejects bad input and that a successful run produces a sentinel matching
// keyFromPath of the design.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const sentinel = require("../../../../templates/hooks/_lib/sentinel.js") as {
  keyFromPath: (p: string) => string;
  sentinelPath: (k: string, key: string) => string;
};

const SCRIPT = resolve(__dirname, "../../../../templates/hooks/_lib/issue-design-approval.js");

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-ida-"));
  mkdirSync(join(tmp, ".harness-sf", "designs"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: tmp,
    env: { ...process.env, ...env, HARNESS_SF_SKIP_RESOLUTION_GATE: env.HARNESS_SF_SKIP_RESOLUTION_GATE ?? "1" },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function writeDesign(name: string, body: string): { rel: string; abs: string } {
  const rel = `.harness-sf/designs/${name}`;
  const abs = join(tmp, rel);
  writeFileSync(abs, body);
  return { rel, abs };
}

describe("issue-design-approval — input validation", () => {
  it("fails with no arg", () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/usage/);
  });

  it("rejects design path outside .harness-sf/designs/", () => {
    writeFileSync(join(tmp, "elsewhere.md"), "---\ntype: apex\nname: x\n---\n");
    const r = run(["elsewhere.md"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/must live under \.harness-sf\/designs\//);
  });

  it("rejects non-existent design", () => {
    const r = run([".harness-sf/designs/ghost.md"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  it("rejects design without YAML frontmatter", () => {
    const { rel } = writeDesign("nofm.md", "# title only\n");
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no YAML frontmatter/);
  });

  it("rejects invalid frontmatter type", () => {
    const { rel } = writeDesign("bad.md", "---\ntype: gizmo\nname: x\n---\n");
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/'type' must be one of/);
  });

  it("rejects missing frontmatter name", () => {
    const { rel } = writeDesign("noname.md", "---\ntype: apex\n---\n");
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/'name' is required/);
  });
});

describe("issue-design-approval — sentinel emission", () => {
  it("writes a sentinel keyed by sha1(absDesignPath) on success", () => {
    const { rel, abs } = writeDesign(
      "ok.md",
      "---\ntype: apex\nname: AccountHandler\n---\n",
    );
    const r = run([rel]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/approved DESIGN.*type=apex.*name=AccountHandler/);

    const key = sentinel.keyFromPath(abs);
    const sentinelFile = sentinel.sentinelPath("design-approvals", key);
    expect(existsSync(sentinelFile)).toBe(true);
    const data = JSON.parse(readFileSync(sentinelFile, "utf8"));
    expect(data.design_path).toBe(rel);
    expect(data.type).toBe("apex");
    expect(data.name).toBe("AccountHandler");
    expect(typeof data.issued_at).toBe("string");
  });
});

describe("issue-design-approval — resolution gate", () => {
  it("fails when ## Reviews exists with unresolved HIGH risk and gate is on", () => {
    const { rel } = writeDesign(
      "needs-resolve.md",
      `---
type: apex
name: Foo
---

## Reviews

# Eng Review:

- [H1] missing FLS check on update

`,
    );
    // Force the resolution gate ON (override the suite's default skip).
    const r = run([rel], { HARNESS_SF_SKIP_RESOLUTION_GATE: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/fails review\/verdict gate/);
  });

  it("respects HARNESS_SF_SKIP_RESOLUTION_GATE=1 escape hatch", () => {
    const { rel } = writeDesign(
      "skip-gate.md",
      `---
type: apex
name: Foo
---

## Reviews

# Eng Review:

- [H1] missing FLS — but we are skipping the gate

`,
    );
    const r = run([rel], { HARNESS_SF_SKIP_RESOLUTION_GATE: "1" });
    expect(r.status).toBe(0);
  });
});
