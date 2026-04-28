import { describe, it, expect } from "vitest";
import { MockAgentRunner } from "./mock.js";
import { Meta } from "../contracts/run-log.js";

describe("MockAgentRunner", () => {
  it("returns mock_missing failure class when no preset matches", async () => {
    const runner = new MockAgentRunner();
    const result = await runner.invoke({
      skillOrAgent: "sf-trigger-auditor",
      fixturePath: "/nonexistent",
      modelId: "claude-opus-4-7",
    });
    expect(result.failureClass).toBe("mock_missing");
    expect(result.output).toBe("");
  });

  it("returns registered preset output", async () => {
    const runner = new MockAgentRunner();
    runner.register("sf-trigger-auditor::/fix/trigger-recursion", {
      output: "finding: trigger.recursion (high)",
    });
    const result = await runner.invoke({
      skillOrAgent: "sf-trigger-auditor",
      fixturePath: "/fix/trigger-recursion",
      modelId: "claude-opus-4-7",
    });
    expect(result.output).toContain("trigger.recursion");
    expect(result.failureClass).toBeUndefined();
  });

  it("emits a trace event", async () => {
    const runner = new MockAgentRunner();
    runner.register("a::/b", { output: "x" });
    const events: any[] = [];
    await runner.invoke({
      skillOrAgent: "a",
      fixturePath: "/b",
      modelId: "claude-opus-4-7",
      onTrace: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0].tool).toBe("mock");
  });

  it("produces meta that conforms to schema (strict)", async () => {
    const runner = new MockAgentRunner();
    runner.register("a::/b", { output: "x" });
    const result = await runner.invoke({
      skillOrAgent: "a",
      fixturePath: "/b",
      modelId: "claude-opus-4-7",
    });
    expect(() => Meta.parse(result.meta)).not.toThrow();
  });
});
