import { describe, expect, it } from "vitest";
import { deriveStoredEventItemFields } from "../src/stored-event-item-fields.js";

describe("deriveStoredEventItemFields", () => {
  it("derives item columns from completed item events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/completed",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        turnId: "turn-1",
        item: {
          id: "msg-1",
          type: "agentMessage",
          text: "hello",
        },
      }),
    ).toEqual({
      itemId: "msg-1",
      itemKind: "agentMessage",
    });
  });

  it("derives item ids from delta and progress events without an item kind", () => {
    expect(
      deriveStoredEventItemFields({
        type: "item/toolCall/progress",
        threadId: "thread-1",
        providerThreadId: "provider-1",
        turnId: "turn-1",
        itemId: "tool-1",
        message: "still running",
      }),
    ).toEqual({
      itemId: "tool-1",
      itemKind: null,
    });
  });

  it("returns null item columns for non-item events", () => {
    expect(
      deriveStoredEventItemFields({
        type: "system/error",
        threadId: "thread-1",
        code: "tool_failed",
        message: "Something failed",
      }),
    ).toEqual({
      itemId: null,
      itemKind: null,
    });
  });
});
