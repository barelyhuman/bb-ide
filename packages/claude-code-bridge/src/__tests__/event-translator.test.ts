import { describe, expect, it, beforeEach } from "vitest";
import {
  translateSdkMessage,
  resetTurnCounter,
  type JsonRpcNotification,
} from "../event-translator.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

describe("event-translator", () => {
  beforeEach(() => {
    resetTurnCounter();
  });

  it("captures system init without emitting notifications", () => {
    const message = {
      type: "system",
      subtype: "init",
      session_id: "sess-1",
    } as unknown as SDKMessage;

    const { notifications, turnId } = translateSdkMessage(
      message,
      "thread-1",
      undefined,
    );

    expect(notifications).toHaveLength(0);
    expect(turnId).toBeUndefined();
  });

  it("emits turn/started + item/completed for assistant text", () => {
    const message = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    } as unknown as SDKMessage;

    const { notifications, turnId } = translateSdkMessage(
      message,
      "thread-1",
      undefined,
    );

    expect(turnId).toBe("turn-1");
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      method: "turn/started",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(notifications[1]).toMatchObject({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { normalizedType: "agentmessage", text: { text: "Hello world" } },
      },
    });
  });

  it("emits item/started for tool_use blocks", () => {
    const message = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "read_file",
            input: { path: "/test.ts" },
          },
        ],
      },
    } as unknown as SDKMessage;

    const { notifications } = translateSdkMessage(
      message,
      "thread-1",
      undefined,
    );

    // turn/started + item/started (no text so no item/completed for text)
    expect(notifications).toHaveLength(2);
    expect(notifications[1]).toMatchObject({
      method: "item/started",
      params: {
        item: {
          normalizedType: "toolcall",
          callId: "call-1",
          tool: "read_file",
        },
      },
    });
  });

  it("emits delta for stream_event text", () => {
    const message = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "chunk" },
      },
    } as unknown as SDKMessage;

    const { notifications } = translateSdkMessage(
      message,
      "thread-1",
      "turn-1",
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "chunk" },
    });
  });

  it("emits turn/completed for result message", () => {
    const message = {
      type: "result",
      subtype: "success",
    } as unknown as SDKMessage;

    const { notifications, turnId } = translateSdkMessage(
      message,
      "thread-1",
      "turn-1",
    );

    expect(turnId).toBeUndefined();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        result: { subtype: "success" },
      },
    });
  });

  it("does not emit turn/started twice for same turn", () => {
    const msg1 = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Part 1" }],
      },
    } as unknown as SDKMessage;

    const result1 = translateSdkMessage(msg1, "thread-1", undefined);
    expect(result1.turnId).toBe("turn-1");

    const msg2 = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Part 2" }],
      },
    } as unknown as SDKMessage;

    const result2 = translateSdkMessage(msg2, "thread-1", result1.turnId);
    const turnStartedCount = result2.notifications.filter(
      (n) => n.method === "turn/started",
    ).length;
    expect(turnStartedCount).toBe(0);
  });

  it("emits tool result items from user messages", () => {
    const message = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: "file contents here",
          },
        ],
      },
    } as unknown as SDKMessage;

    const { notifications } = translateSdkMessage(
      message,
      "thread-1",
      "turn-1",
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      method: "item/completed",
      params: {
        item: {
          normalizedType: "toolresult",
          callId: "call-1",
        },
      },
    });
  });
});
