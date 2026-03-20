import { describe, expect, it } from "vitest";
import {
  decodeBridgeJsonRpcRequest,
  decodeBridgeJsonRpcResponse,
  decodeToolCallResponsePayload,
} from "./rpc-contract.js";

describe("rpc-contract", () => {
  it("accepts valid bridge requests and rejects non-requests", () => {
    expect(
      decodeBridgeJsonRpcRequest({
        jsonrpc: "2.0",
        id: "req-1",
        method: "turn/start",
        params: { threadId: "thread-1" },
      }),
    ).toMatchObject({
      id: "req-1",
      method: "turn/start",
      params: { threadId: "thread-1" },
    });

    expect(
      decodeBridgeJsonRpcRequest({
        jsonrpc: "2.0",
        id: "req-1",
        result: { ok: true },
      }),
    ).toBeNull();
  });

  it("accepts success and error responses", () => {
    expect(
      decodeBridgeJsonRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      }),
    ).toMatchObject({ id: 1, result: { ok: true } });

    expect(
      decodeBridgeJsonRpcResponse({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32602, message: "bad request" },
      }),
    ).toMatchObject({
      id: 2,
      error: { code: -32602, message: "bad request" },
    });
  });

  it("extracts tool response text and error state from canonical payloads", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputText", text: "first" },
          { type: "inputImage", imageUrl: "https://example.com/ignored.png" },
          { type: "inputText", text: "second" },
        ],
      }),
    ).toEqual({
      content: "first\nsecond",
      isError: false,
    });

    expect(
      decodeToolCallResponsePayload({
        success: false,
        contentItems: [],
      }),
    ).toEqual({
      content: "OK",
      isError: true,
    });
  });
});
