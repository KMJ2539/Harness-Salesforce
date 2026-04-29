// Tests for templates/hooks/_lib/output-cap.js — pure helpers (no stdout/exit
// paths exercised here; blockWith is verified via hook integration tests).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const cap = require("../../../../templates/hooks/_lib/output-cap.js") as {
  lastAssistantText: (transcriptPath: string) => string;
  lineCount: (text: string) => number;
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "harness-sf-cap-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("lineCount", () => {
  it("returns 0 for empty / falsy", () => {
    expect(cap.lineCount("")).toBe(0);
    expect(cap.lineCount(undefined as unknown as string)).toBe(0);
  });

  it("counts LF and CRLF the same", () => {
    expect(cap.lineCount("a\nb\nc")).toBe(3);
    expect(cap.lineCount("a\r\nb\r\nc")).toBe(3);
  });

  it("trailing newline counts as an extra (empty) line", () => {
    expect(cap.lineCount("a\nb\n")).toBe(3);
  });
});

describe("lastAssistantText", () => {
  it("returns '' when transcript path missing or empty", () => {
    expect(cap.lastAssistantText("")).toBe("");
    expect(cap.lastAssistantText(join(tmp, "nope.jsonl"))).toBe("");
  });

  it("extracts text from the most recent assistant entry", () => {
    const path = join(tmp, "transcript.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "ignore me" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "first reply" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "second reply" }, { type: "text", text: "more" }] },
      }),
    ].join("\n");
    writeFileSync(path, lines);
    expect(cap.lastAssistantText(path)).toBe("second reply\nmore");
  });

  it("skips malformed JSON lines without throwing", () => {
    const path = join(tmp, "transcript.jsonl");
    const lines = [
      "{ not json",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "good reply" }] },
      }),
    ].join("\n");
    writeFileSync(path, lines);
    expect(cap.lastAssistantText(path)).toBe("good reply");
  });

  it("returns '' when no assistant entry exists", () => {
    const path = join(tmp, "transcript.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ type: "user", message: { content: "hi" } }),
    );
    expect(cap.lastAssistantText(path)).toBe("");
  });

  it("handles tool_use blocks (non-text) by returning only joined text blocks", () => {
    const path = join(tmp, "transcript.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: {} },
            { type: "text", text: "narration" },
          ],
        },
      }),
    );
    expect(cap.lastAssistantText(path)).toBe("narration");
  });
});
