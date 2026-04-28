import { normalize } from "../runner/normalize.js";
import { redact } from "../runner/redact.js";

export function prepareSnapshot(raw: string, opts?: { workspaceRoot?: string }): string {
  const redacted = redact(raw, opts).text;
  return normalize(redacted);
}
