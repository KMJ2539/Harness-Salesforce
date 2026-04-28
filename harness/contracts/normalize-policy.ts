export const NORMALIZE_POLICY = {
  mode: "exact-match" as const,
  patterns: [
    "iso-timestamp",
    "uuid-v4",
    "absolute-path",
    "token-cost-numbers",
    "sf-id-15-18",
    "email",
    "anthropic-key",
    "bearer-token",
    "trailing-whitespace",
    "consecutive-blank-lines",
    "markdown-table-padding",
  ] as const,
  exclude: ["korean-particle-variation", "synonym", "list-numbering"] as const,
} as const;

export type NormalizePolicy = typeof NORMALIZE_POLICY;
