import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  formatToolCallCommand,
  formatToolCallOutput,
  isExploringCall,
  isExploringIntent,
  parseShellCommandIntents,
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

describe("parseShellCommandIntents", () => {
  it("returns empty array for commands without exploring intent", () => {
    expect(parseShellCommandIntents("corepack yarn test:app packages/excalidraw/tests/search.test.tsx --watch=false")).toEqual([]);
  });

  it("classifies sed reads with the concrete shell tool name", () => {
    expect(
      parseShellCommandIntents(
        "sed -n '1,260p' packages/excalidraw/components/SearchMenu.tsx",
      ),
    ).toEqual([
      {
        type: "read",
        cmd: "sed -n '1,260p' packages/excalidraw/components/SearchMenu.tsx",
        name: "sed",
        path: "packages/excalidraw/components/SearchMenu.tsx",
      },
    ]);
  });

  it("classifies grep searches with query and file path", () => {
    expect(
      parseShellCommandIntents(
        'grep -n "searchMatches" $EXCALIDRAW_REPO/packages/excalidraw/types.ts | head -20',
      ),
    ).toEqual([
      {
        type: "search",
        cmd: 'grep -n "searchMatches" $EXCALIDRAW_REPO/packages/excalidraw/types.ts | head -20',
        query: "searchMatches",
        path: "$EXCALIDRAW_REPO/packages/excalidraw/types.ts",
      },
    ]);
  });

  it("classifies rg searches across chained commands", () => {
    expect(
      parseShellCommandIntents(
        'pwd && rg -n "search sidebar|canvas search|search" packages/excalidraw',
      ),
    ).toEqual([
      {
        type: "search",
        cmd: 'pwd && rg -n "search sidebar|canvas search|search" packages/excalidraw',
        query: "search sidebar|canvas search|search",
        path: "packages/excalidraw",
      },
    ]);
  });

  it("keeps rg path extraction stable when glob filters are present", () => {
    expect(
      parseShellCommandIntents(
        `rg -n "searchQueryAtom|searchItemInFocusAtom" -g '*.ts' -g '*.tsx' packages/excalidraw`,
      ),
    ).toEqual([
      {
        type: "search",
        cmd: `rg -n "searchQueryAtom|searchItemInFocusAtom" -g '*.ts' -g '*.tsx' packages/excalidraw`,
        query: "searchQueryAtom|searchItemInFocusAtom",
        path: "packages/excalidraw",
      },
    ]);
  });

  it("classifies find pipelines as list_files instead of reads", () => {
    expect(
      parseShellCommandIntents(
        'find . -maxdepth 3 -type f | head -20',
      ),
    ).toEqual([
      {
        type: "list_files",
        cmd: 'find . -maxdepth 3 -type f | head -20',
        path: ".",
      },
    ]);
  });

  it("classifies ls invocations with an explicit path", () => {
    expect(parseShellCommandIntents("ls -la /tmp/workspace")).toEqual([
      {
        type: "list_files",
        cmd: "ls -la /tmp/workspace",
        path: "/tmp/workspace",
      },
    ]);
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

  it("formats TodoWrite with todo counts and active step", () => {
    expect(
      formatToolCallCommand("TodoWrite", {
        todos: [
          {
            content: "Read notes/context.txt",
            status: "completed",
            activeForm: "Reading notes/context.txt",
          },
          {
            content: "Edit notes/todo.txt",
            status: "in_progress",
            activeForm: "Editing notes/todo.txt",
          },
          {
            content: "Reply with TODO_WORKFLOW_DONE",
            status: "pending",
            activeForm: "Replying with TODO_WORKFLOW_DONE",
          },
        ],
      }),
    ).toBe(
      "TodoWrite 3 todos - 1 in progress, 1 pending, 1 completed: Editing notes/todo.txt",
    );
  });

  it("formats Claude Agent calls with subagent labels", () => {
    expect(
      formatToolCallCommand("Agent", {
        description: "Explore docs directory",
        prompt: "List all files in docs",
        subagent_type: "Explore",
      }),
    ).toBe("Agent [Explore] Explore docs directory");
  });

  it("formats collab agent spawn commands with prompt summaries", () => {
    expect(
      formatToolCallCommand("spawnAgent", {
        receiverThreadIds: ["thread-2"],
        prompt: "Inspect the docs directory in the current workspace and report the file names.",
      }),
    ).toBe(
      "spawnAgent 1 agent: Inspect the docs directory in the current workspace and report the file names.",
    );
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

describe("formatToolCallOutput", () => {
  it("shortens TodoWrite success boilerplate", () => {
    expect(
      formatToolCallOutput(
        "TodoWrite",
        "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
      ),
    ).toBe("Todo list updated");
  });

  it("preserves non-specialized outputs", () => {
    expect(formatToolCallOutput("ToolSearch", "alpha.md\nbeta.md")).toBe("alpha.md\nbeta.md");
  });

  it("preserves Agent report outputs after stripping metadata", () => {
    expect(
      formatToolCallOutput(
        "Agent",
        [
          "Perfect! Now let me create a summary of all findings:",
          "",
          "## Summary of Canvas Search Sidebar Implementation",
          "",
          "- item 1",
          "agentId: abc123",
          "<usage>total_tokens: 123",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Perfect! Now let me create a summary of all findings:",
        "",
        "## Summary of Canvas Search Sidebar Implementation",
        "",
        "- item 1",
      ].join("\n"),
    );
  });
});
