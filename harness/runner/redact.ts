const PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_\-]+/g, replacement: "<ANTHROPIC_KEY>" },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9._\-]+/gi, replacement: "<BEARER>" },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g, replacement: "<AWS_KEY>" },
  { name: "email", re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, replacement: "<EMAIL>" },
  // SF 15/18-char ID: 3-char prefix is letter+alphanumeric, total 15 or 18.
  // Use word boundaries to avoid matching inside longer tokens.
  { name: "sf-id-18", re: /\b[a-zA-Z0-9]{3}[A-Za-z0-9]{12}[A-Za-z0-9]{3}\b/g, replacement: "<SFID>" },
  { name: "sf-id-15", re: /\b[a-zA-Z0-9]{3}[A-Za-z0-9]{12}\b/g, replacement: "<SFID>" },
];

export interface RedactResult {
  text: string;
  hits: Record<string, number>;
}

export function redact(input: string, opts?: { workspaceRoot?: string }): RedactResult {
  let text = input;
  const hits: Record<string, number> = {};

  if (opts?.workspaceRoot) {
    const root = opts.workspaceRoot.replace(/\\/g, "/");
    const re = new RegExp(escapeRegex(root), "g");
    const beforeCount = (text.match(re) ?? []).length;
    if (beforeCount > 0) {
      text = text.replace(re, "<WORKSPACE>");
      hits["absolute-path"] = beforeCount;
    }
  }

  for (const { name, re, replacement } of PATTERNS) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      hits[name] = (hits[name] ?? 0) + matches.length;
      text = text.replace(re, replacement);
    }
  }

  return { text, hits };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
