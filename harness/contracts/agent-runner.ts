import type { DecisionsFile } from "./decisions.js";
import type { Meta, TraceEvent } from "./run-log.js";
import type { FailureClass } from "./failure-class.js";

export interface RunInput {
  skillOrAgent: string;
  fixturePath: string;
  modelId: string;
  decisions?: DecisionsFile;
  onTrace?: (e: TraceEvent) => void;
}

export interface RunResult {
  output: string;
  meta: Meta;
  failureClass?: FailureClass;
  diff?: string;
}

export interface AgentRunner {
  invoke(input: RunInput): Promise<RunResult>;
}
