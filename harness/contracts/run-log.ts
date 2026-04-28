import { z } from "zod";
import { FailureClass } from "./failure-class.js";

export const Tokens = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cache_read: z.number().int().nonnegative(),
});
export type Tokens = z.infer<typeof Tokens>;

export const Meta = z
  .object({
    schemaVersion: z.literal(1),
    skill: z.string(),
    modelId: z.string(),
    resolvedModelId: z.string().optional(),
    sdkVersion: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
    tokens: Tokens,
    costUsd: z.number().nonnegative(),
    failureClass: FailureClass.optional(),
    fixturePath: z.string().optional(),
  })
  .strict();
export type Meta = z.infer<typeof Meta>;

export const TraceEvent = z
  .object({
    turn: z.number().int().nonnegative(),
    tool: z.string(),
    inputHash: z.string(),
    outputHash: z.string(),
    tokens: Tokens.partial().optional(),
  })
  .strict();
export type TraceEvent = z.infer<typeof TraceEvent>;
