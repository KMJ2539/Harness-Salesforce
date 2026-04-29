// Tests for templates/hooks/_lib/dispatch-state.js — feature dispatch state
// machine. Verifies init / update / summary / current_index maintenance and
// path-traversal guard on slug.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ds = require("../../../../templates/hooks/_lib/dispatch-state.js") as {
  statePath: (slug: string) => string;
  readState: (slug: string) => any;
  initState: (slug: string, designPath: string, artifacts: any[]) => any;
  updateArtifact: (slug: string, id: string, patch: Record<string, unknown>) => any;
  summary: (state: any) => { done: number; failed: number; total: number; label: string } | null;
  listStates: () => Array<{ slug: string; path: string; mtime: number }>;
};

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-ds-"));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

const sampleArtifacts = [
  { id: "obj-order", type: "sobject", sub_skill: "/sf-sobject" },
  { id: "fld-status", type: "field", sub_skill: "/sf-field" },
  { id: "apex-handler", type: "apex", sub_skill: "/sf-apex" },
];

describe("statePath safety", () => {
  it("rejects slugs containing path separators", () => {
    expect(() => ds.statePath("../escape")).toThrow(/invalid feature slug/);
    expect(() => ds.statePath("a/b")).toThrow();
    expect(() => ds.statePath("a\\b")).toThrow();
  });

  it("accepts valid slugs", () => {
    const p = ds.statePath("order-mgmt");
    expect(p).toMatch(/order-mgmt\.json$/);
  });
});

describe("initState + readState", () => {
  it("initializes all artifacts as pending with current_index=0", () => {
    const state = ds.initState("feat", ".harness-sf/designs/feat.md", sampleArtifacts);
    expect(state.feature).toBe("feat");
    expect(state.current_index).toBe(0);
    expect(state.artifacts).toHaveLength(3);
    for (const a of state.artifacts) {
      expect(a.status).toBe("pending");
      expect(a.started_at).toBeNull();
      expect(a.completed_at).toBeNull();
    }
  });

  it("readState returns null when not initialized", () => {
    expect(ds.readState("never-existed")).toBeNull();
  });

  it("readState returns the persisted state", () => {
    ds.initState("feat", "design.md", sampleArtifacts);
    const got = ds.readState("feat");
    expect(got.artifacts.map((a: any) => a.id)).toEqual([
      "obj-order",
      "fld-status",
      "apex-handler",
    ]);
  });

  it("rejects non-array artifacts", () => {
    expect(() => ds.initState("feat", "d.md", null as unknown as any[])).toThrow();
  });
});

describe("updateArtifact", () => {
  beforeEach(() => {
    ds.initState("feat", "design.md", sampleArtifacts);
  });

  it("merges patch into matching artifact", () => {
    ds.updateArtifact("feat", "obj-order", { status: "in_progress", started_at: "2026-04-29T10:00:00Z" });
    const s = ds.readState("feat");
    expect(s.artifacts[0].status).toBe("in_progress");
    expect(s.artifacts[0].started_at).toBe("2026-04-29T10:00:00Z");
  });

  it("advances current_index past terminal states", () => {
    ds.updateArtifact("feat", "obj-order", { status: "done" });
    let s = ds.readState("feat");
    expect(s.current_index).toBe(1);

    ds.updateArtifact("feat", "fld-status", { status: "skipped" });
    s = ds.readState("feat");
    expect(s.current_index).toBe(2);

    ds.updateArtifact("feat", "apex-handler", { status: "failed", error: "compile error" });
    s = ds.readState("feat");
    expect(s.current_index).toBe(-1);
    expect(s.artifacts[2].error).toBe("compile error");
  });

  it("throws when artifact id is unknown", () => {
    expect(() => ds.updateArtifact("feat", "ghost", { status: "done" })).toThrow(/not found/);
  });

  it("throws when state file does not exist", () => {
    expect(() => ds.updateArtifact("missing-feat", "x", {})).toThrow(/no dispatch state/);
  });
});

describe("summary", () => {
  it("returns null for falsy / malformed input", () => {
    expect(ds.summary(null)).toBeNull();
    expect(ds.summary({} as any)).toBeNull();
  });

  it("counts done/failed/total and formats label", () => {
    ds.initState("feat", "d.md", sampleArtifacts);
    ds.updateArtifact("feat", "obj-order", { status: "done" });
    ds.updateArtifact("feat", "fld-status", { status: "failed" });
    const s = ds.readState("feat");
    const sum = ds.summary(s);
    expect(sum).toEqual({ done: 1, failed: 1, total: 3, label: "1/3!1" });
  });

  it("omits failure suffix when no failures", () => {
    ds.initState("feat", "d.md", sampleArtifacts);
    ds.updateArtifact("feat", "obj-order", { status: "done" });
    const sum = ds.summary(ds.readState("feat"));
    expect(sum?.label).toBe("1/3");
  });
});

describe("listStates", () => {
  it("returns empty when state dir absent", () => {
    expect(ds.listStates()).toEqual([]);
  });

  it("lists initialized states sorted by mtime desc", async () => {
    ds.initState("first", "d.md", sampleArtifacts);
    await new Promise(r => setTimeout(r, 10));
    ds.initState("second", "d.md", sampleArtifacts);
    const all = ds.listStates();
    expect(all.map(s => s.slug)).toEqual(["second", "first"]);
  });
});
