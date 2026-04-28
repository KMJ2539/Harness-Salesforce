const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?/g;
const UUID_V4 = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ABSOLUTE_PATH_WIN = /[A-Z]:\\[^\s"'<>|]+/g;
const ABSOLUTE_PATH_NIX = /(?<![A-Za-z0-9_])\/(?:home|Users|usr|opt|tmp|var)\/[^\s"'<>|]+/g;
const SF_ID_18 = /\b[a-zA-Z0-9]{3}[A-Za-z0-9]{12}[A-Za-z0-9]{3}\b/g;
const SF_ID_15 = /\b[a-zA-Z0-9]{3}[A-Za-z0-9]{12}\b/g;
const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_\-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._\-]+/gi;
const TOKEN_COST_NUMBER = /(?<=\b(?:tokens?|cost|usd|duration_ms|total_tokens)[\s:=]+)[\d,.]+/gi;

export function normalize(input: string): string {
  let text = input;

  text = text.replace(ANTHROPIC_KEY, "<ANTHROPIC_KEY>");
  text = text.replace(BEARER, "<BEARER>");
  text = text.replace(ISO_TS, "<TS>");
  text = text.replace(UUID_V4, "<UUID>");
  text = text.replace(ABSOLUTE_PATH_WIN, "<ABS>");
  text = text.replace(ABSOLUTE_PATH_NIX, "<ABS>");
  text = text.replace(SF_ID_18, "<SFID>");
  text = text.replace(SF_ID_15, "<SFID>");
  text = text.replace(EMAIL, "<EMAIL>");
  text = text.replace(TOKEN_COST_NUMBER, "<N>");

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.replace(/(\|[^\n]*\|)/g, (m) => m.replace(/[ \t]{2,}/g, " "));

  return text;
}
