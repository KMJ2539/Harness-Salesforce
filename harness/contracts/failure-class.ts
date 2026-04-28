import { z } from "zod";

export const FailureClass = z.enum([
  "intent_insufficient",
  "review_loop_exhausted",
  "context_overflow",
  "tool_denied",
  "lint_failed",
  "deploy_failed",
  "user_abort",
  "runner_error",
  "mock_missing",
]);

export type FailureClass = z.infer<typeof FailureClass>;
