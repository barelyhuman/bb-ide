import { describe, expect, it } from "vitest";
import {
  decodeNativeProviderToolCallRequest,
  decodeNormalizedProviderToolCallRequest,
} from "./provider-tool-call-contract.js";

describe("provider-tool-call-contract", () => {
  it("preserves optional BB thread hints on normalized bridge tool calls", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-1", "item/tool/call", {
        providerThreadId: "provider-abc",
        threadId: "thr_123",
        turnId: "turn-1",
        callId: "call-1",
        tool: "message_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-1",
      threadId: "thr_123",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "message_user",
      arguments: { text: "hello" },
    });
  });

  it("allows normalized bridge tool calls to omit a BB thread hint", () => {
    expect(
      decodeNormalizedProviderToolCallRequest("req-2", "item/tool/call", {
        providerThreadId: "provider-abc",
        turnId: "turn-1",
        callId: "call-1",
        tool: "message_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-2",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "message_user",
      arguments: { text: "hello" },
    });
  });

  it("treats native provider tool calls as provider-scoped requests", () => {
    expect(
      decodeNativeProviderToolCallRequest("req-2", "item/tool/call", {
        threadId: "provider-abc",
        turnId: "turn-1",
        callId: "call-1",
        tool: "message_user",
        arguments: { text: "hello" },
      }),
    ).toEqual({
      requestId: "req-2",
      providerThreadId: "provider-abc",
      turnId: "turn-1",
      callId: "call-1",
      tool: "message_user",
      arguments: { text: "hello" },
    });
  });
});
