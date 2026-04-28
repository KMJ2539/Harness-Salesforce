import { describe, it, expect } from "vitest";
import {
  FailureClass,
  Expected,
  DecisionsFile,
  Meta,
  TraceEvent,
} from "./index.js";

describe("contracts", () => {
  it("FailureClass accepts all defined enum values", () => {
    for (const v of FailureClass.options) {
      expect(() => FailureClass.parse(v)).not.toThrow();
    }
  });

  it("FailureClass rejects unknown value", () => {
    expect(() => FailureClass.parse("ok")).toThrow();
  });

  it("Expected validates a fixture finding", () => {
    const ok = Expected.parse({
      intentionallyVulnerable: true,
      findings: [
        { category: "apex.fls_missing", severity: "high", locator: { file: "AccountSvc.cls" } },
      ],
    });
    expect(ok.findings).toHaveLength(1);
  });

  it("Expected rejects an unknown finding category", () => {
    expect(() =>
      Expected.parse({ findings: [{ category: "made.up", severity: "high" }] }),
    ).toThrow();
  });

  it("DecisionsFile validates a typical mock", () => {
    const file = DecisionsFile.parse({
      version: 1,
      onMissing: "fail",
      responses: [
        { skill: "sf-apex", questionId: "sharing-model", answer: "with sharing" },
      ],
    });
    expect(file.responses).toHaveLength(1);
  });

  it("Meta is strict — extra fields are rejected (no env dump)", () => {
    expect(() =>
      Meta.parse({
        schemaVersion: 1,
        skill: "sf-apex",
        modelId: "claude-opus-4-7",
        sdkVersion: "1.0.0",
        startedAt: "t",
        finishedAt: "t",
        tokens: { input: 0, output: 0, cache_read: 0 },
        costUsd: 0,
        env: { ANTHROPIC_API_KEY: "sk-ant-x" },
      }),
    ).toThrow();
  });

  it("TraceEvent is strict — headers field rejected", () => {
    expect(() =>
      TraceEvent.parse({
        turn: 0,
        tool: "mock",
        inputHash: "0",
        outputHash: "0",
        headers: { authorization: "Bearer x" },
      }),
    ).toThrow();
  });
});
