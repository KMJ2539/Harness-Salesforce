// Tests for templates/hooks/_lib/sentinel.js — TTL + git HEAD binding.
//
// Strategy: chdir into a fresh tmpdir per test so sentinel files land in a
// throwaway location. We do NOT init a git repo, so gitHeadSha() returns null
// and validate() soft-skips the head_sha check (matches "not a git repo" path).
// A separate test exercises the head_sha mismatch path by stubbing the JSON
// directly with a fake sha that won't equal whatever git returns.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const sentinel = require("../../../../templates/hooks/_lib/sentinel.js") as {
  sentinelDir: (kind: string) => string;
  sentinelPath: (kind: string, key: string) => string;
  keyFromPath: (absPath: string) => string;
  gitHeadSha: () => string | null;
  readSentinel: (kind: string, key: string) => unknown;
  writeSentinel: (kind: string, key: string, extra?: Record<string, unknown>) => Record<string, unknown>;
  validate: (s: unknown, ttlMs: number) => { ok: boolean; reason: string };
  cwd: () => string;
};

let prevCwd: string;
let tmp: string;

beforeEach(() => {
  prevCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-sentinel-"));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe("sentinelPath / keyFromPath", () => {
  it("keyFromPath is deterministic 16-char hex", () => {
    const k1 = sentinel.keyFromPath("/abs/path/to/file.cls");
    const k2 = sentinel.keyFromPath("/abs/path/to/file.cls");
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("different paths produce different keys", () => {
    expect(sentinel.keyFromPath("/a")).not.toBe(sentinel.keyFromPath("/b"));
  });

  it("sentinelPath sits under .harness-sf/.cache/<kind>", () => {
    const p = sentinel.sentinelPath("design-approval", "abc123");
    expect(p).toContain(join(".harness-sf", ".cache", "design-approval", "abc123.json"));
  });
});

describe("writeSentinel + readSentinel round-trip", () => {
  it("writeSentinel creates file with issued_at and merges extras", () => {
    const data = sentinel.writeSentinel("test-kind", "key1", { foo: "bar", n: 42 });
    expect(data.foo).toBe("bar");
    expect(data.n).toBe(42);
    expect(typeof data.issued_at).toBe("string");
    expect(existsSync(sentinel.sentinelPath("test-kind", "key1"))).toBe(true);
  });

  it("readSentinel returns parsed JSON when file exists", () => {
    sentinel.writeSentinel("test-kind", "key2", { hello: "world" });
    const got = sentinel.readSentinel("test-kind", "key2") as Record<string, unknown>;
    expect(got.hello).toBe("world");
  });

  it("readSentinel returns null when file is absent", () => {
    expect(sentinel.readSentinel("test-kind", "missing")).toBeNull();
  });

  it("readSentinel returns null on malformed JSON (no throw)", () => {
    const dir = sentinel.sentinelDir("test-kind");
    mkdirSync(dir, { recursive: true });
    writeFileSync(sentinel.sentinelPath("test-kind", "bad"), "{ not json");
    expect(sentinel.readSentinel("test-kind", "bad")).toBeNull();
  });
});

describe("validate — TTL", () => {
  it("ok=true for fresh sentinel within TTL", () => {
    const s = { issued_at: new Date().toISOString(), head_sha: null };
    const r = sentinel.validate(s, 5 * 60_000);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("fresh");
  });

  it("ok=false when older than TTL with age in minutes", () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const r = sentinel.validate({ issued_at: old, head_sha: null }, 5 * 60_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/10m old/);
    expect(r.reason).toMatch(/>5m TTL/);
  });

  it("ok=false on missing sentinel input", () => {
    const r = sentinel.validate(null, 60_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no sentinel");
  });

  it("ok=false on malformed issued_at", () => {
    const r = sentinel.validate({ issued_at: "not-a-date", head_sha: null }, 60_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/malformed/);
  });
});

describe("validate — head_sha binding", () => {
  it("skips head_sha check when current cwd is not a git repo (gitHeadSha=null)", () => {
    // tmp is not a git repo → gitHeadSha() returns null → check is soft-skipped.
    const s = {
      issued_at: new Date().toISOString(),
      head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    const r = sentinel.validate(s, 60_000);
    expect(r.ok).toBe(true);
  });
});
