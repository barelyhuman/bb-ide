import { describe, expect, it } from "vitest";
import { formatTimelineAsText } from "../src/format-timeline-text.js";
import type { ViewMessage } from "@bb/domain";

describe("formatTimelineAsText", () => {
  it("renders user + assistant + tool-call in minimal mode", () => {
    const messages: ViewMessage[] = [
      {
        kind: "user",
        id: "u1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        text: "Fix the bug",
      },
      {
        kind: "assistant-text",
        id: "a1",
        threadId: "t1",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
        createdAt: 2,
        text: "I'll fix it now.",
        status: "completed",
      },
      {
        kind: "tool-call",
        id: "tc1",
        threadId: "t1",
        sourceSeqStart: 3,
        sourceSeqEnd: 4,
        createdAt: 3,
        toolName: "Bash",
        callId: "call-1",
        command: "npm test",
        output: "All tests passed",
        exitCode: 0,
        status: "completed",
      },
    ];

    const text = formatTimelineAsText(messages, { color: false });
    expect(text).toContain("User");
    expect(text).toContain("Fix the bug");
    expect(text).toContain("Assistant");
    expect(text).toContain("I'll fix it now.");
    expect(text).toContain("Tool Call: Bash");
    expect(text).toContain("npm test");
    expect(text).toContain("All tests passed");
  });

  it("collapses exploring calls in minimal mode", () => {
    const messages: ViewMessage[] = [
      {
        kind: "tool-exploring",
        id: "exp1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 3,
        createdAt: 1,
        status: "completed",
        calls: [
          {
            callId: "c1",
            command: "Read /src/main.ts",
            parsedCmd: [{ type: "read", cmd: "Read /src/main.ts", name: "Read", path: "/src/main.ts" }],
            output: "file contents here...",
            status: "completed",
          },
          {
            callId: "c2",
            command: "Grep 'bug' in /src",
            parsedCmd: [{ type: "search", cmd: "Grep 'bug' in /src", query: "bug", path: "/src" }],
            output: "found 3 matches",
            status: "completed",
          },
        ],
      },
    ];

    const minimal = formatTimelineAsText(messages, { color: false });
    expect(minimal).toContain("Explored 1 file, 1 search");
    expect(minimal).not.toContain("Read main.ts");
    expect(minimal).not.toContain("Search bug in /src");

    const verbose = formatTimelineAsText(messages, { color: false, verbose: true });
    expect(verbose).toContain("Explored 1 file, 1 search");
    expect(verbose).toContain("Read /src/main.ts");
    expect(verbose).toContain("Search bug in /src");
    expect(verbose).not.toContain("Read exec_command");
    expect(verbose).not.toContain("file contents here");
  });

  it("limits large exploring groups in minimal mode", () => {
    const calls = Array.from({ length: 10 }, (_, index) => ({
      callId: `c${index + 1}`,
      command: `Read /src/file-${index + 1}.ts`,
      parsedCmd: [
        {
          type: "read" as const,
          cmd: `Read /src/file-${index + 1}.ts`,
          name: "Read",
          path: `/src/file-${index + 1}.ts`,
        },
      ],
      status: "completed" as const,
    }));

    const minimal = formatTimelineAsText(
      [
        {
          kind: "tool-exploring",
          id: "exp-large",
          threadId: "t1",
          sourceSeqStart: 1,
          sourceSeqEnd: 10,
          createdAt: 1,
          status: "completed",
          calls,
        },
      ],
      { color: false },
    );

    expect(minimal).toContain("Explored 10 files");
    expect(minimal).not.toContain("Read /src/file-1.ts");
  });

  it("renders file edit with path", () => {
    const messages: ViewMessage[] = [
      {
        kind: "file-edit",
        id: "fe1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 2,
        createdAt: 1,
        callId: "call-1",
        changes: [
          { path: "/src/auth.ts", kind: "update", diff: "+  if (!user) return null;" },
        ],
        status: "completed",
      },
    ];

    const minimal = formatTimelineAsText(messages, { color: false });
    expect(minimal).toContain("File Edit");
    expect(minimal).toContain("/src/auth.ts");
    expect(minimal).not.toContain("if (!user)"); // diff hidden in minimal

    const verbose = formatTimelineAsText(messages, { color: false, verbose: true });
    expect(verbose).toContain("if (!user)"); // diff shown in verbose
  });

  it("renders errors", () => {
    const messages: ViewMessage[] = [
      {
        kind: "error",
        id: "e1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        rawType: "system/error",
        message: "Provider unavailable",
      },
    ];

    const text = formatTimelineAsText(messages, { color: false });
    expect(text).toContain("Error");
    expect(text).toContain("Provider unavailable");
  });

  it("hides reasoning in minimal, shows in verbose", () => {
    const messages: ViewMessage[] = [
      {
        kind: "assistant-reasoning",
        id: "r1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        text: "Let me think about this...",
        status: "completed",
      },
    ];

    const minimal = formatTimelineAsText(messages, { color: false });
    expect(minimal).toBe("");

    const verbose = formatTimelineAsText(messages, { color: false, verbose: true });
    expect(verbose).toContain("Reasoning");
    expect(verbose).toContain("Let me think about this");
  });

  it("collapses grouped tool activity in minimal mode and expands it in verbose mode", () => {
    const messages: ViewMessage[] = [
      {
        kind: "tool-call",
        id: "tc1",
        threadId: "t1",
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        startedAt: 1,
        toolName: "exec_command",
        callId: "call-1",
        command: "npm test",
        output: "ok",
        status: "completed",
      },
      {
        kind: "tool-call",
        id: "tc2",
        threadId: "t1",
        turnId: "turn-1",
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
        createdAt: 2,
        startedAt: 2,
        toolName: "exec_command",
        callId: "call-2",
        command: "npm run lint",
        output: "clean",
        status: "completed",
      },
      {
        kind: "assistant-text",
        id: "a1",
        threadId: "t1",
        turnId: "turn-1",
        sourceSeqStart: 3,
        sourceSeqEnd: 3,
        createdAt: 3,
        text: "Tests pass.",
        status: "completed",
      },
    ];

    const minimal = formatTimelineAsText(messages, { color: false });
    expect(minimal).toContain("Worked on 2 items");
    expect(minimal).toContain("Assistant");
    expect(minimal).toContain("Tests pass.");
    expect(minimal).not.toContain("npm test");

    const verbose = formatTimelineAsText(messages, { color: false, verbose: true });
    expect(verbose).toContain("Worked on 2 items");
    expect(verbose).toContain("npm test");
    expect(verbose).toContain("npm run lint");
    expect(verbose).toContain("ok");
    expect(verbose).toContain("clean");
  });

  it("keeps grouped error work summaries neutral in minimal mode", () => {
    const text = formatTimelineAsText(
      [
        {
          kind: "tasks",
          id: "tasks-1",
          threadId: "t1",
          turnId: "turn-1",
          sourceSeqStart: 1,
          sourceSeqEnd: 1,
          createdAt: 1,
          title: "Tasks updated",
          source: "todo",
          status: "completed",
          tasks: [{ text: "Run validation", status: "active" }],
        },
        {
          kind: "error",
          id: "error-1",
          threadId: "t1",
          turnId: "turn-1",
          sourceSeqStart: 2,
          sourceSeqEnd: 2,
          createdAt: 2,
          rawType: "provider/error",
          message: "Validation failed",
        },
      ],
      { color: false },
    );

    expect(text).toContain("Worked on 2 items");
    expect(text).not.toContain("Failed");
  });

  it("formats grouped duration summaries without item-count suffixes", () => {
    const text = formatTimelineAsText(
      [
        {
          kind: "tool-group",
          id: "group-1",
          turnId: "turn-1",
          summaryCount: 22,
          sourceSeqStart: 1,
          sourceSeqEnd: 22,
          startedAt: 1,
          createdAt: 128_001,
          durationMs: 128_000,
          status: "completed",
          messages: [],
        },
      ],
      { color: false },
    );

    expect(text).toContain("Worked for 2m 8s");
    expect(text).not.toContain("22 items");
  });

  it("omits completed badges for warning operations", () => {
    const text = formatTimelineAsText(
      [
        {
          kind: "operation",
          id: "op-1",
          threadId: "t1",
          turnId: "turn-1",
          sourceSeqStart: 1,
          sourceSeqEnd: 1,
          createdAt: 1,
          opType: "warning",
          title: "Warning",
          detail: "Rate limit status updated",
          status: "completed",
        },
      ],
      { color: false },
    );

    expect(text).toContain("Operation: Warning");
    expect(text).toContain("Rate limit status updated");
    expect(text).not.toContain("✓");
  });

  it("renders delegation summaries from structured fields and shows full output in verbose mode", () => {
    const messages: ViewMessage[] = [
      {
        kind: "delegation",
        id: "d1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        toolName: "Agent",
        callId: "agent-1",
        status: "completed",
        subagentType: "Explore",
        description: "Inspect the docs tree",
        output: "## Findings\n\n- alpha\n- beta",
        children: [],
      },
    ];

    const minimal = formatTimelineAsText(messages, { color: false });
    expect(minimal).toContain("Subagent Explore: Inspect the docs tree");
    expect(minimal).toContain("## Findings");

    const verbose = formatTimelineAsText(messages, { color: false, verbose: true });
    expect(verbose).toContain("Subagent Explore: Inspect the docs tree");
    expect(verbose).toContain("## Findings");
    expect(verbose).toContain("- alpha");
    expect(verbose).toContain("- beta");
  });

  it("labels tasks consistently as Updated tasks", () => {
    const messages: ViewMessage[] = [
      {
        kind: "tasks",
        id: "tasks-1",
        threadId: "t1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        createdAt: 1,
        title: "Tasks updated",
        tasks: [
          { text: "Inspect docs", status: "completed" },
          { text: "Write summary", status: "active" },
        ],
      },
    ];

    const text = formatTimelineAsText(messages, { color: false });
    expect(text).toContain("Updated tasks");
    expect(text).not.toContain("Tasks updated");
    expect(text).toContain("Inspect docs");
    expect(text).toContain("Write summary");
  });
});
