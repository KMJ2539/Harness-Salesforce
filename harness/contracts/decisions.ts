import { z } from "zod";

export const DecisionResponse = z.object({
  skill: z.string(),
  questionId: z.string(),
  answer: z.union([z.string(), z.array(z.string())]),
  deviationFromRecommend: z.string().optional(),
});
export type DecisionResponse = z.infer<typeof DecisionResponse>;

export const DecisionsFile = z.object({
  version: z.literal(1),
  responses: z.array(DecisionResponse),
  onMissing: z.enum(["fail", "use_recommend"]),
});
export type DecisionsFile = z.infer<typeof DecisionsFile>;
