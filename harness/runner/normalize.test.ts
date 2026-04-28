import { describe, it, expect } from "vitest";
import { normalize } from "./normalize.js";

describe("normalize", () => {
  it("masks ISO timestamps", () => {
    expect(normalize("at 2026-04-28T14:22:01.123Z done")).toBe("at <TS> done");
    expect(normalize("at 2026-04-28T14:22:01+09:00")).toBe("at <TS>");
  });

  it("masks UUID v4", () => {
    expect(normalize("id=550e8400-e29b-41d4-a716-446655440000 ok")).toBe("id=<UUID> ok");
  });

  it("masks Windows and unix absolute paths", () => {
    expect(normalize("at C:\\prj\\harness-sf\\foo.cls")).toContain("<ABS>");
    expect(normalize("at /home/user/file.cls")).toContain("<ABS>");
    expect(normalize("not an abs ./relative/path.cls")).not.toContain("<ABS>");
  });

  it("masks SF IDs", () => {
    expect(normalize("Account 001000000000001AAA failed")).toBe("Account <SFID> failed");
    expect(normalize("Account 001000000000001 failed")).toBe("Account <SFID> failed");
  });

  it("masks emails", () => {
    expect(normalize("user mjkang2539@gmail.com saw")).toBe("user <EMAIL> saw");
  });

  it("masks token/cost numbers in well-known contexts", () => {
    expect(normalize("total_tokens: 12345")).toBe("total_tokens: <N>");
    expect(normalize("cost: 0.0234")).toBe("cost: <N>");
    expect(normalize("duration_ms: 1234")).toBe("duration_ms: <N>");
  });

  it("trims trailing whitespace and collapses blank lines", () => {
    const input = "line a   \n\n\n\nline b\t\n";
    expect(normalize(input)).toBe("line a\n\nline b\n");
  });

  it("collapses markdown table padding", () => {
    expect(normalize("| col a    |     col b   |")).toBe("| col a | col b |");
  });

  it("masks anthropic key and bearer", () => {
    expect(normalize("key=sk-ant-abc_DEF-1")).toBe("key=<ANTHROPIC_KEY>");
    expect(normalize("Authorization: Bearer abc.DEF")).toContain("<BEARER>");
  });

  it("does NOT alter korean particles or synonyms (drift signal)", () => {
    expect(normalize("결과는 안전하다")).toBe("결과는 안전하다");
    expect(normalize("결과가 안전합니다")).toBe("결과가 안전합니다");
  });

  it("is idempotent", () => {
    const once = normalize("at 2026-04-28T14:22:01Z user@x.com");
    const twice = normalize(once);
    expect(twice).toBe(once);
  });
});
