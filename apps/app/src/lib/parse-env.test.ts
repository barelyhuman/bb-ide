import { describe, expect, it } from "vitest";
import { looksLikeEnvContent, parseEnvContent } from "./parse-env";

describe("parseEnvContent", () => {
  it("parses common dotenv syntax into explicit entries", () => {
    const result = parseEnvContent(
      [
        "# comment",
        "",
        "FOO=bar",
        'DOUBLE_QUOTED="hello world"',
        "SINGLE_QUOTED='hello world'",
        'QUOTED_HASH="bar # not a comment"',
        "UNQUOTED_HASH=bar # this is a comment",
        "DATABASE_URL=postgres://user:pass@host/db?opt=1",
        "EMPTY=",
        "  TRIMMED  =  value  ",
      ].join("\n"),
    );
    expect(result.entries).toEqual([
      { name: "FOO", value: "bar" },
      { name: "DOUBLE_QUOTED", value: "hello world" },
      { name: "SINGLE_QUOTED", value: "hello world" },
      { name: "QUOTED_HASH", value: "bar # not a comment" },
      { name: "UNQUOTED_HASH", value: "bar" },
      {
        name: "DATABASE_URL",
        value: "postgres://user:pass@host/db?opt=1",
      },
      { name: "EMPTY", value: "" },
      { name: "TRIMMED", value: "value" },
    ]);
    expect(result.errors).toEqual([]);
  });

  it("reports malformed lines while preserving valid entries", () => {
    const result = parseEnvContent(
      ["FOO=bar", "INVALID_LINE", "1BAD=value", "=value", "GOOD=value"].join(
        "\n",
      ),
    );
    expect(result.entries).toEqual([
      { name: "FOO", value: "bar" },
      { name: "GOOD", value: "value" },
    ]);
    expect(result.errors).toEqual([
      'Line 2: missing "=" separator',
      expect.stringContaining("Line 3: invalid name"),
      "Line 4: empty variable name",
    ]);
  });
});

describe("looksLikeEnvContent", () => {
  it("classifies multi-line dotenv content without treating single lines or prose as env files", () => {
    expect(looksLikeEnvContent("FOO=bar\nBAZ=qux")).toBe(true);
    expect(looksLikeEnvContent("FOO=bar")).toBe(false);
    expect(looksLikeEnvContent("hello\nworld")).toBe(false);
    expect(looksLikeEnvContent("# comment\nFOO=bar")).toBe(false);
    expect(looksLikeEnvContent("# comment\nFOO=bar\nBAZ=qux")).toBe(true);
  });
});
