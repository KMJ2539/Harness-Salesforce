// CLI integration tests for templates/hooks/_lib/validate-design.js.
//
// We spawn the script with node and feed it real fixture markdown so we cover
// the actual contract: exit code + stdout JSON + stderr diagnostics. Pure
// parser functions are private to the script, which is intentional — testing
// at the CLI boundary keeps refactor freedom.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../../../templates/hooks/_lib/validate-design.js");

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-vd-"));
  mkdirSync(join(tmp, ".harness-sf", "designs"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

function writeDesign(name: string, body: string): string {
  const rel = `.harness-sf/designs/${name}`;
  writeFileSync(join(tmp, rel), body);
  return rel;
}

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: tmp });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("validate-design — frontmatter", () => {
  it("fails when file is missing", () => {
    const r = run([".harness-sf/designs/nope.md"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  it("fails when no frontmatter", () => {
    const rel = writeDesign("no-fm.md", "# just a title\n\nbody\n");
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no YAML frontmatter/);
  });

  it("fails when type is invalid", () => {
    const rel = writeDesign(
      "bad-type.md",
      "---\ntype: widget\nname: foo\n---\n\nbody\n",
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/frontmatter\.type must be/);
  });

  it("fails when name missing", () => {
    const rel = writeDesign("no-name.md", "---\ntype: apex\n---\n\nbody\n");
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/frontmatter\.name is required/);
  });

  it("passes a minimal apex design", () => {
    const rel = writeDesign(
      "ok.md",
      "---\ntype: apex\nname: AccountHandler\n---\n\nbody\n",
    );
    const r = run([rel]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.type).toBe("apex");
    expect(out.name).toBe("AccountHandler");
    expect(out.artifacts).toEqual([]);
  });
});

describe("validate-design — feature artifacts", () => {
  it("requires ## Artifacts section for type=feature", () => {
    const rel = writeDesign(
      "feat.md",
      "---\ntype: feature\nname: order-mgmt\n---\n\n## Why\nbecause.\n",
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/must have a '## Artifacts' section/);
  });

  it("parses artifacts and emits topological order", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: order-mgmt
---

## Artifacts

### 1. obj-order  [type: sobject] [status: pending]

- Depends on: -

### 2. fld-status  [type: field] [status: pending]

- Depends on: obj-order

### 3. apex-handler  [type: apex] [status: pending]

- Depends on: obj-order, fld-status
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.artifacts.map((a: any) => a.id)).toEqual(["obj-order", "fld-status", "apex-handler"]);
    expect(out.order).toEqual(["obj-order", "fld-status", "apex-handler"]);
  });

  it("rejects duplicate artifact ids", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: dup
---

## Artifacts

### 1. obj-x  [type: sobject]

- Depends on: -

### 2. obj-x  [type: sobject]

- Depends on: -
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/duplicate artifact id/);
  });

  it("rejects unknown dependency reference", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: dep-err
---

## Artifacts

### 1. apex-x  [type: apex]

- Depends on: missing-dep
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/depends on undefined id 'missing-dep'/);
  });

  it("detects dependency cycles", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: cyc
---

## Artifacts

### 1. a  [type: apex]

- Depends on: b

### 2. b  [type: apex]

- Depends on: a
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dependency cycle detected/);
  });

  it("rejects mismatched declared artifact count", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: cnt
artifacts: 5
---

## Artifacts

### 1. a  [type: apex]

- Depends on: -
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/frontmatter\.artifacts=5 but '## Artifacts' parses 1/);
  });

  it("rejects invalid artifact type", () => {
    const rel = writeDesign(
      "feat.md",
      `---
type: feature
name: badtype
---

## Artifacts

### 1. ws-thing  [type: websocket]

- Depends on: -
`,
    );
    const r = run([rel]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/invalid type 'websocket'/);
  });
});

describe("validate-design — --check-resolution", () => {
  function withReviews(body: string): string {
    return `---
type: apex
name: Foo
---

## Why

x.

## Reviews

# Eng Review:

- [H1] missing FLS check on update
- [M1] consider sharing model

${body}
`;
  }

  it("fails when '## Reviews' exists but '## Review Resolution' does not", () => {
    const rel = writeDesign("noresolve.md", withReviews(""));
    const r = run([rel, "--check-resolution"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/'## Review Resolution' is missing/);
  });

  it("fails when HIGH risk has no resolution entry", () => {
    const rel = writeDesign(
      "h-unresolved.md",
      withReviews("## Review Resolution\n\n- M1: will revisit in v2 once we have data\n"),
    );
    const r = run([rel, "--check-resolution"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unresolved HIGH risks.*H1/);
  });

  it("fails when resolution is shallow (< 8 chars)", () => {
    const rel = writeDesign(
      "shallow.md",
      withReviews("## Review Resolution\n\n- H1: ok\n- M1: yes\n"),
    );
    const r = run([rel, "--check-resolution"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/shallow resolutions/);
  });

  it("passes when every risk has a substantive response", () => {
    const rel = writeDesign(
      "good.md",
      withReviews(`## Review Resolution

- H1: added Schema.sObjectType.Account.fields.Name.isUpdateable() guard before update
- M1: keeping with sharing — confirmed default-private OWD covers this
`),
    );
    const r = run([rel, "--check-resolution"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.resolution.reviews_present).toBe(true);
    expect(out.resolution.unresolved_high).toEqual([]);
  });

  it("rejects legacy [HIGH] entries without [H#] IDs", () => {
    const body = `---
type: apex
name: Foo
---

## Reviews

# Eng Review:

- [HIGH] this is the old schema, no ID

## Review Resolution

- (nothing)
`;
    const rel = writeDesign("legacy.md", body);
    const r = run([rel, "--check-resolution"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/legacy \[HIGH\]\/\[MEDIUM\] entries/);
  });
});
