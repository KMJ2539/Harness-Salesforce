import { describe, it, expect } from "vitest";
import { prepareSnapshot } from "./snapshot.js";

describe("prepareSnapshot", () => {
  it("redacts then normalizes (composition order)", () => {
    const raw = "user mjkang2539@gmail.com at 2026-04-28T14:22:01Z key=sk-ant-XYZ";
    const out = prepareSnapshot(raw);
    expect(out).toBe("user <EMAIL> at <TS> key=<ANTHROPIC_KEY>");
  });

  it("masks workspace root", () => {
    const raw = "file at C:/prj/harness-sf/foo.cls modified";
    const out = prepareSnapshot(raw, { workspaceRoot: "C:\\prj\\harness-sf" });
    expect(out).toContain("<WORKSPACE>");
    expect(out).not.toContain("harness-sf/foo");
  });

  it("is idempotent", () => {
    const raw = "id=550e8400-e29b-41d4-a716-446655440000 at 2026-04-28T00:00:00Z";
    expect(prepareSnapshot(prepareSnapshot(raw))).toBe(prepareSnapshot(raw));
  });
});
