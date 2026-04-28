import { describe, it, expect } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("masks anthropic api key", () => {
    const { text, hits } = redact("token=sk-ant-abc_DEF-123");
    expect(text).toBe("token=<ANTHROPIC_KEY>");
    expect(hits["anthropic-key"]).toBe(1);
  });

  it("masks bearer token", () => {
    const { text } = redact("Authorization: Bearer abc.DEF-123_xyz");
    expect(text).toContain("<BEARER>");
    expect(text).not.toContain("abc.DEF");
  });

  it("masks aws access key", () => {
    const { text, hits } = redact("AKIAIOSFODNN7EXAMPLE in config");
    expect(text).toContain("<AWS_KEY>");
    expect(hits["aws-access-key"]).toBe(1);
  });

  it("masks email", () => {
    const { text, hits } = redact("contact mjkang2539@gmail.com soon");
    expect(text).toBe("contact <EMAIL> soon");
    expect(hits["email"]).toBe(1);
  });

  it("masks 15-char and 18-char SF IDs", () => {
    const { text } = redact("ids: 001000000000001 and 001000000000001AAA");
    expect(text).toContain("<SFID>");
    expect(text).not.toMatch(/001000000000001AAA/);
  });

  it("masks workspace absolute path", () => {
    const { text, hits } = redact("file at C:/prj/harness-sf/foo/bar.cls", {
      workspaceRoot: "C:\\prj\\harness-sf",
    });
    expect(text).toBe("file at <WORKSPACE>/foo/bar.cls");
    expect(hits["absolute-path"]).toBe(1);
  });

  it("returns hits map summarizing all patterns matched", () => {
    const { hits } = redact("a@b.com and c@d.org with sk-ant-XYZ");
    expect(hits["email"]).toBe(2);
    expect(hits["anthropic-key"]).toBe(1);
  });

  it("leaves non-sensitive text unchanged", () => {
    const input = "normal log line with numbers 12345 and words.";
    const { text, hits } = redact(input);
    expect(text).toBe(input);
    expect(Object.keys(hits)).toHaveLength(0);
  });
});
