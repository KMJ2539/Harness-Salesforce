// Integration tests for templates/hooks/pre-create-design-link-gate.js — the
// design-first gate. Blocks creation of new force-app sources unless a fresh
// design-approval sentinel exists.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../templates/hooks/pre-create-design-link-gate.js");
const ISSUE = resolve(__dirname, "../../../templates/hooks/_lib/issue-design-approval.js");

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-cdg-"));
  mkdirSync(join(tmp, ".harness-sf", "designs"), { recursive: true });
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

function writePayload(file: string, tool = "Write"): Record<string, unknown> {
  return { tool_name: tool, tool_input: { file_path: file } };
}

function approveDesign(name: string, type = "apex"): void {
  const designRel = `.harness-sf/designs/${name}.md`;
  writeFileSync(join(tmp, designRel), `---\ntype: ${type}\nname: ${name}\n---\n`);
  const r = spawnSync(process.execPath, [ISSUE, designRel], {
    encoding: "utf8",
    cwd: tmp,
    env: { ...process.env, HARNESS_SF_SKIP_RESOLUTION_GATE: "1" },
  });
  if (r.status !== 0) throw new Error(`approve failed: ${r.stderr}`);
}

describe("pre-create-design-link-gate — gated paths", () => {
  it("denies CREATE under force-app/.../classes/ without sentinel", () => {
    const r = runHook(writePayload("force-app/main/default/classes/AccountHandler.cls"));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no fresh design approval sentinel found/);
    expect(r.stderr).toMatch(/issue-design-approval/);
  });

  it("allows CREATE after issuing a fresh design approval", () => {
    approveDesign("AccountHandler", "apex");
    const r = runHook(writePayload("force-app/main/default/classes/AccountHandler.cls"));
    expect(r.status).toBe(0);
  });

  it("allows CREATE under triggers/, lwc/, aura/, objects/ when sentinel exists", () => {
    approveDesign("AnyDesign", "apex");
    const paths = [
      "force-app/main/default/triggers/AccountTrigger.trigger",
      "force-app/main/default/lwc/myCmp/myCmp.js",
      "force-app/main/default/aura/MyComp/MyComp.cmp",
      "force-app/main/default/objects/Order__c/Order__c.object-meta.xml",
    ];
    for (const p of paths) {
      const r = runHook(writePayload(p));
      expect(r.status, `path ${p}`).toBe(0);
    }
  });
});

describe("pre-create-design-link-gate — non-gated paths", () => {
  it("allows write to .harness-sf/reports/ without sentinel", () => {
    const r = runHook(writePayload(".harness-sf/reports/x.md"));
    expect(r.status).toBe(0);
  });

  it("allows write to README.md without sentinel", () => {
    const r = runHook(writePayload("README.md"));
    expect(r.status).toBe(0);
  });

  it("allows write to force-app non-source dirs (labels, layouts, permissionsets)", () => {
    const r = runHook(writePayload("force-app/main/default/labels/CustomLabels.labels-meta.xml"));
    expect(r.status).toBe(0);
  });
});

describe("pre-create-design-link-gate — MODIFY mode is silent", () => {
  it("allows write when target file already exists (handed off to modify gate)", () => {
    const target = "force-app/main/default/classes/Existing.cls";
    mkdirSync(join(tmp, "force-app/main/default/classes"), { recursive: true });
    writeFileSync(join(tmp, target), "// existing content\n");
    const r = runHook(writePayload(target));
    expect(r.status).toBe(0);
  });
});

describe("pre-create-design-link-gate — escape hatch", () => {
  it("HARNESS_SF_SKIP_CREATE_GATE=1 bypasses the check", () => {
    const r = runHook(
      writePayload("force-app/main/default/classes/Bypass.cls"),
      { HARNESS_SF_SKIP_CREATE_GATE: "1" },
    );
    expect(r.status).toBe(0);
  });
});

describe("pre-create-design-link-gate — non-Write tools", () => {
  it("ignores tool_name other than Write/Edit/MultiEdit", () => {
    const r = runHook({ tool_name: "Bash", tool_input: { command: "ls" } });
    expect(r.status).toBe(0);
  });
});

describe("pre-create-design-link-gate — malformed input", () => {
  it("allows on malformed stdin (fail-open)", () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      cwd: tmp,
      input: "{ broken",
    });
    expect(r.status).toBe(0);
  });

  it("allows when file_path is missing", () => {
    const r = runHook({ tool_name: "Write", tool_input: {} });
    expect(r.status).toBe(0);
  });
});
