import { describe, expect, it } from "vitest";
import { itemStatusToToolStatus, parseExecLifecycleEvent } from "../src/exec-lifecycle.js";
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
});
