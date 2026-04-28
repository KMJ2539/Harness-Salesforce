import { z } from "zod";

export const Severity = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum([
  "trigger.recursion",
  "trigger.bulkification",
  "trigger.mixed_dml",
  "flow.trigger_conflict",
  "apex.sharing_missing",
  "apex.fls_missing",
  "apex.crud_missing",
  "apex.dynamic_soql_unsafe",
  "apex.hardcoded_id",
  "lwc.wire_n_plus_one",
  "lwc.api_breaking_change",
  "library.already_installed",
  "library.recommend",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const ExpectedFinding = z.object({
  category: FindingCategory,
  severity: Severity,
  locator: z
    .object({
      file: z.string(),
      symbol: z.string().optional(),
    })
    .optional(),
});
export type ExpectedFinding = z.infer<typeof ExpectedFinding>;

export const Expected = z.object({
  intentionallyVulnerable: z.boolean().optional(),
  findings: z.array(ExpectedFinding),
});
export type Expected = z.infer<typeof Expected>;
