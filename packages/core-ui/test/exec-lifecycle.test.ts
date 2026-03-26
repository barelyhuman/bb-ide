import { describe, expect, it } from "vitest";
import {
  itemStatusToToolStatus,
  parseExecLifecycleEvent,
  parseToolCallLifecycleEvent,
} from "../src/exec-lifecycle.js";
import type { ThreadEventRow } from "@bb/domain";

describe("itemStatusToToolStatus", () => {
  it("maps pending to pending", () => {
    expect(itemStatusToToolStatus("pending")).toBe("pending");
  });

  it("maps completed to completed", () => {
    expect(itemStatusToToolStatus("completed")).toBe("completed");
  });

  it("maps failed to error", () => {
    expect(itemStatusToToolStatus("failed")).toBe("error");
  });

  it("maps interrupted to interrupted", () => {
    expect(itemStatusToToolStatus("interrupted")).toBe("interrupted");
  });
});

describe("parseExecLifecycleEvent", () => {
  const meta = { id: "evt-1", seq: 1, createdAt: 1000 };
  const row: ThreadEventRow = { id: "evt-1", threadId: "t-1", seq: 1, type: "item/started", data: {}, createdAt: 1000 };

  it("parses item/started commandExecution as begin event", () => {
    const decoded = {
      type: "item/started" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: { type: "commandExecution" as const, id: "call-1", command: "echo hello", cwd: "/tmp", status: "pending" as const },
    };
    const result = parseExecLifecycleEvent(decoded, meta, row);
    expect(result?.kind).toBe("begin");
    expect(result?.call.callId).toBe("call-1");
    expect(result?.call.command).toBe("echo hello");
  });

  it("parses item/completed commandExecution as end event", () => {
    const decoded = {
      type: "item/completed" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: { type: "commandExecution" as const, id: "call-1", command: "echo hello", cwd: "/tmp", status: "completed" as const, exitCode: 0 },
    };
    const result = parseExecLifecycleEvent(decoded, meta, row);
    expect(result?.kind).toBe("end");
    expect(result?.call.status).toBe("completed");
  });

  it("maps non-zero exit code to error status", () => {
    const decoded = {
      type: "item/completed" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: { type: "commandExecution" as const, id: "call-1", command: "false", cwd: "/tmp", status: "completed" as const, exitCode: 1 },
    };
    const result = parseExecLifecycleEvent(decoded, meta, row);
    expect(result?.call.status).toBe("error");
  });

  it("parses output delta events", () => {
    const decoded = {
      type: "item/commandExecution/outputDelta" as const,
      threadId: "t-1",
      itemId: "call-1",
      delta: "output text",
    };
    const result = parseExecLifecycleEvent(decoded, meta, row);
    expect(result?.kind).toBe("output");
    expect(result?.call.output).toBe("output text");
    expect(result?.appendOutput).toBe(true);
  });

  it("returns null for non-exec item events", () => {
    const decoded = {
      type: "item/started" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: { type: "agentMessage" as const, id: "msg-1", text: "hello", status: "pending" as const },
    };
    expect(parseExecLifecycleEvent(decoded, meta, row)).toBeNull();
  });

  it("classifies shell reads as exploring intents", () => {
    const decoded = {
      type: "item/completed" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: {
        type: "commandExecution" as const,
        id: "call-2",
        command: "sed -n '1,260p' packages/excalidraw/components/SearchMenu.tsx",
        cwd: "/tmp",
        status: "completed" as const,
        exitCode: 0,
      },
    };

    const result = parseExecLifecycleEvent(decoded, meta, row);
    expect(result?.call.parsedCmd).toEqual([
      {
        type: "read",
        cmd: "sed -n '1,260p' packages/excalidraw/components/SearchMenu.tsx",
        name: "exec_command",
        path: "packages/excalidraw/components/SearchMenu.tsx",
      },
    ]);
  });
});

describe("parseToolCallLifecycleEvent", () => {
  const meta = { id: "evt-1", seq: 1, createdAt: 1000 };

  it("formats TodoWrite lifecycle events with concise command and output", () => {
    const decoded = {
      type: "item/completed" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: {
        type: "toolCall" as const,
        id: "tool-1",
        tool: "TodoWrite",
        arguments: {
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
          ],
        },
        result:
          "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
        status: "completed" as const,
      },
    };

    const result = parseToolCallLifecycleEvent(decoded, meta);
    expect(result?.kind).toBe("end");
    expect(result?.call.command).toBe(
      "TodoWrite 2 todos - 1 in progress, 1 completed: Editing notes/todo.txt",
    );
    expect(result?.call.output).toBe("Todo list updated");
  });

  it("formats Agent tool calls with their subagent type", () => {
    const decoded = {
      type: "item/started" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: {
        type: "toolCall" as const,
        id: "tool-2",
        tool: "Agent",
        arguments: {
          description: "Explore docs directory",
          prompt: "List docs files",
          subagent_type: "Explore",
        },
        status: "pending" as const,
      },
    };

    const result = parseToolCallLifecycleEvent(decoded, meta);
    expect(result?.kind).toBe("begin");
    expect(result?.call.command).toBe("Agent [Explore] Explore docs directory");
  });

  it("summarizes Agent tool results", () => {
    const decoded = {
      type: "item/completed" as const,
      threadId: "t-1",
      turnId: "turn-1",
      item: {
        type: "toolCall" as const,
        id: "tool-3",
        tool: "Agent",
        arguments: {
          description: "Explore docs directory",
          prompt: "List docs files",
          subagent_type: "Explore",
        },
        result: [
          "Perfect! Let me summarize what I found.",
          "",
          "## Docs directory overview",
          "",
          "- alpha.md",
          "agentId: abc123",
          "<usage>total_tokens: 42",
        ].join("\n"),
        status: "completed" as const,
      },
    };

    const result = parseToolCallLifecycleEvent(decoded, meta);
    expect(result?.call.output).toBe("Subagent report: Docs directory overview");
  });
});
