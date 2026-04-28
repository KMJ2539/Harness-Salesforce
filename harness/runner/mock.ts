import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner, RunInput, RunResult } from "../contracts/agent-runner.js";
import type { Meta } from "../contracts/run-log.js";
import { Meta as MetaSchema } from "../contracts/run-log.js";

export interface MockFixtureOutput {
  output: string;
  failureClass?: RunResult["failureClass"];
  diff?: string;
}

export class MockAgentRunner implements AgentRunner {
  constructor(private readonly fixtureOutputs: Map<string, MockFixtureOutput> = new Map()) {}

  static fromFixtureDir(): MockAgentRunner {
    return new MockAgentRunner();
  }

  register(key: string, output: MockFixtureOutput): void {
    this.fixtureOutputs.set(key, output);
  }

  async invoke(input: RunInput): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const key = `${input.skillOrAgent}::${input.fixturePath}`;
    let preset = this.fixtureOutputs.get(key);

    if (!preset) {
      const presetPath = join(input.fixturePath, "_mock", `${input.skillOrAgent}.txt`);
      if (existsSync(presetPath)) {
        preset = { output: readFileSync(presetPath, "utf8") };
      }
    }

    if (!preset) {
      const meta: Meta = MetaSchema.parse({
        schemaVersion: 1,
        skill: input.skillOrAgent,
        modelId: input.modelId,
        sdkVersion: "mock-0.0.0",
        startedAt,
        finishedAt: new Date().toISOString(),
        tokens: { input: 0, output: 0, cache_read: 0 },
        costUsd: 0,
        failureClass: "mock_missing",
        fixturePath: input.fixturePath,
      });
      return { output: "", meta, failureClass: "mock_missing" };
    }

    input.onTrace?.({
      turn: 0,
      tool: "mock",
      inputHash: hash(input.fixturePath + input.skillOrAgent),
      outputHash: hash(preset.output),
    });

    const meta: Meta = MetaSchema.parse({
      schemaVersion: 1,
      skill: input.skillOrAgent,
      modelId: input.modelId,
      sdkVersion: "mock-0.0.0",
      startedAt,
      finishedAt: new Date().toISOString(),
      tokens: { input: 100, output: 200, cache_read: 0 },
      costUsd: 0,
      failureClass: preset.failureClass,
      fixturePath: input.fixturePath,
    });

    return {
      output: preset.output,
      meta,
      failureClass: preset.failureClass,
      diff: preset.diff,
    };
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}
