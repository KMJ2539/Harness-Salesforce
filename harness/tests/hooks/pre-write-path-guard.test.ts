// Integration tests for templates/hooks/pre-write-path-guard.js — PreToolUse
// hook that enforces (1) path-prefix policy per CLAUDE_AGENT and (2) global
// profile-XML write ban. Verifies allow/deny via exit code + stderr messages.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../templates/hooks/pre-write-path-guard.js");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-pwg-"));
});

afterEach(() => {
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

function writePayload(file: string): Record<string, unknown> {
  return { tool_name: "Write", tool_input: { file_path: file } };
}

describe("pre-write-path-guard — main agent (no CLAUDE_AGENT)", () => {
  it("allows arbitrary writes (orchestration trust)", () => {
    const r = runHook(writePayload("force-app/main/default/classes/Foo.cls"), {
      CLAUDE_AGENT: "",
    });
    expect(r.status).toBe(0);
  });

  it("still blocks profile XML edits even for main agent", () => {
    const r = runHook(writePayload("force-app/main/default/profiles/Admin.profile-meta.xml"), {
      CLAUDE_AGENT: "",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Profile edits are forbidden/);
    expect(r.stderr).toMatch(/Permission Set/);
  });

  it("respects HARNESS_SF_ALLOW_PROFILE_EDIT=1 escape hatch", () => {
    const r = runHook(writePayload("force-app/main/default/profiles/Admin.profile-meta.xml"), {
      CLAUDE_AGENT: "",
      HARNESS_SF_ALLOW_PROFILE_EDIT: "1",
    });
    expect(r.status).toBe(0);
  });
});

describe("pre-write-path-guard — reviewer agents (read-only)", () => {
  it.each([
    "sf-design-ceo-reviewer",
    "sf-design-eng-reviewer",
    "sf-design-security-reviewer",
    "sf-design-qa-reviewer",
    "sf-design-library-reviewer",
    "sf-apex-code-reviewer",
  ])("denies all writes for %s", (agent) => {
    const r = runHook(writePayload(".harness-sf/reports/foo.md"), { CLAUDE_AGENT: agent });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/read-only \(reviewer\)/);
  });
});

describe("pre-write-path-guard — analyzer agents", () => {
  it("allows sf-context-explorer to write under .harness-sf/reports/", () => {
    const r = runHook(writePayload(".harness-sf/reports/sf-context-explorer/account.md"), {
      CLAUDE_AGENT: "sf-context-explorer",
    });
    expect(r.status).toBe(0);
  });

  it("denies sf-context-explorer writing to force-app/", () => {
    const r = runHook(writePayload("force-app/main/default/classes/Foo.cls"), {
      CLAUDE_AGENT: "sf-context-explorer",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/violates path policy/);
    expect(r.stderr).toMatch(/Allowed prefixes/);
  });
});

describe("pre-write-path-guard — writer agents", () => {
  it("allows sf-apex-test-author to write under force-app/ and reports/", () => {
    const r1 = runHook(writePayload("force-app/main/default/classes/AccountHandlerTest.cls"), {
      CLAUDE_AGENT: "sf-apex-test-author",
    });
    expect(r1.status).toBe(0);

    const r2 = runHook(writePayload(".harness-sf/reports/sf-apex-test-author/foo.md"), {
      CLAUDE_AGENT: "sf-apex-test-author",
    });
    expect(r2.status).toBe(0);
  });

  it("denies sf-apex-test-author writing outside its allowed prefixes", () => {
    const r = runHook(writePayload("README.md"), {
      CLAUDE_AGENT: "sf-apex-test-author",
    });
    expect(r.status).toBe(2);
  });

  it("allows sf-deploy-validator exact-path write to .harness-sf/last-validation.json", () => {
    const r = runHook(writePayload(".harness-sf/last-validation.json"), {
      CLAUDE_AGENT: "sf-deploy-validator",
    });
    expect(r.status).toBe(0);
  });
});

describe("pre-write-path-guard — unknown agent", () => {
  it("lets unknown agents through (not in policy domain)", () => {
    const r = runHook(writePayload("anywhere.txt"), { CLAUDE_AGENT: "totally-new-agent" });
    expect(r.status).toBe(0);
  });
});

describe("pre-write-path-guard — malformed input", () => {
  it("exits 0 (allow) on malformed JSON stdin", () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: "utf8",
      cwd: tmp,
      input: "{ not json",
      env: { ...process.env, CLAUDE_AGENT: "sf-context-explorer" },
    });
    expect(r.status).toBe(0);
  });

  it("exits 0 (allow) when file_path is missing", () => {
    const r = runHook({ tool_name: "Write", tool_input: {} }, { CLAUDE_AGENT: "sf-context-explorer" });
    expect(r.status).toBe(0);
  });
});
