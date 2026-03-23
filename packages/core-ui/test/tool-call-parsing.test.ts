import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  formatToolCallCommand,
  isExploringCall,
  isExploringIntent,
  toolNameToParsedIntents,
} from "../src/tool-call-parsing.js";

describe("extractShellCommandFromString", () => {
  it("returns the command as-is when no shell wrapper is present", () => {
    expect(extractShellCommandFromString("ls -la")).toBe("ls -la");
  });

  it("returns undefined for empty input", () => {
    expect(extractShellCommandFromString("")).toBeUndefined();
    expect(extractShellCommandFromString("   ")).toBeUndefined();
  });

  it("unwraps bash -c 'command'", () => {
    expect(extractShellCommandFromString("bash -c 'echo hello'")).toBe("echo hello");
  });

  it("unwraps /usr/bin/bash -c command", () => {
    expect(extractShellCommandFromString("/usr/bin/bash -c echo hello")).toBe("echo hello");
  });

  it("unwraps zsh -lc 'command'", () => {
    expect(extractShellCommandFromString("zsh -lc 'git status'")).toBe("git status");
  });

  it("preserves command when shell is not a known wrapper", () => {
    expect(extractShellCommandFromString("fish -c 'echo hello'")).toBe("fish -c 'echo hello'");
  });

  it("unwraps double-quoted shell args", () => {
    expect(extractShellCommandFromString('bash -c "echo hello"')).toBe("echo hello");
  });
});

describe("isExploringIntent / isExploringCall", () => {
  it("classifies read, list_files, search as exploring", () => {
    expect(isExploringIntent({ type: "read", cmd: "Read foo" })).toBe(true);
    expect(isExploringIntent({ type: "list_files", cmd: "Glob *" })).toBe(true);
    expect(isExploringIntent({ type: "search", cmd: "Grep x" })).toBe(true);
  });

  it("classifies unknown as not exploring", () => {
    expect(isExploringIntent({ type: "unknown", cmd: "something" })).toBe(false);
  });

  it("isExploringCall returns false for empty parsedCmd", () => {
    expect(isExploringCall({ parsedCmd: [] })).toBe(false);
  });

  it("isExploringCall returns true when all intents are exploring", () => {
    expect(isExploringCall({ parsedCmd: [{ type: "read", cmd: "Read x" }] })).toBe(true);
  });

  it("isExploringCall returns false when any intent is not exploring", () => {
    expect(
      isExploringCall({
        parsedCmd: [
          { type: "read", cmd: "Read x" },
          { type: "unknown", cmd: "something" },
        ],
      }),
    ).toBe(false);
  });
});

describe("toolNameToParsedIntents", () => {
  it("maps Read to a read intent", () => {
    const intents = toolNameToParsedIntents("Read", { file_path: "/src/index.ts" });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.type).toBe("read");
    expect(intents[0]?.path).toBe("/src/index.ts");
  });

  it("maps Glob to a list_files intent", () => {
    const intents = toolNameToParsedIntents("Glob", { pattern: "**/*.ts" });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.type).toBe("list_files");
  });

  it("maps Grep to a search intent", () => {
    const intents = toolNameToParsedIntents("Grep", { pattern: "TODO", path: "src" });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.type).toBe("search");
    expect(intents[0]?.query).toBe("TODO");
    expect(intents[0]?.path).toBe("src");
  });

  it("returns empty array for unknown tools", () => {
    expect(toolNameToParsedIntents("CustomTool", {})).toEqual([]);
  });
});

describe("formatToolCallCommand", () => {
  it("returns tool name when args are null", () => {
    expect(formatToolCallCommand("Read", null)).toBe("Read");
  });

  it("formats Read with file path", () => {
    expect(formatToolCallCommand("Read", { file_path: "/foo.ts" })).toBe("Read /foo.ts");
  });

  it("formats Bash with command", () => {
    expect(formatToolCallCommand("Bash", { command: "npm test" })).toBe("npm test");
  });

  it("formats unknown tools with compact args", () => {
    const result = formatToolCallCommand("MyTool", { key: "value" });
    expect(result).toBe("MyTool { key: value }");
  });

  it("truncates long arg values", () => {
    const longValue = "a".repeat(50);
    const result = formatToolCallCommand("MyTool", { key: longValue });
    expect(result).toContain("...");
  });
});
