// Drift guard: templates/hooks/README.md hook table must list exactly the *.js
// files present under templates/hooks/ (excluding _lib/). Catches the case where
// someone adds/removes a hook script without updating the README — which would
// silently desync the documented contract from the shipped behavior.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = join(__dirname, "..", "..", "templates", "hooks");

function listHookScripts(): string[] {
  return readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.replace(/\.js$/, ""))
    .sort();
}

function listDocumentedHooks(): string[] {
  const md = readFileSync(join(HOOKS_DIR, "README.md"), "utf8");
  const rowRe = /^\|\s*`([a-z0-9-]+)\.js`\s*\|/gm;
  const names = new Set<string>();
  for (const m of md.matchAll(rowRe)) names.add(m[1]);
  return [...names].sort();
}

describe("hooks README drift guard", () => {
  it("README hook table lists every *.js under templates/hooks/", () => {
    const scripts = listHookScripts();
    const documented = listDocumentedHooks();
    expect(documented).toEqual(scripts);
  });
});
