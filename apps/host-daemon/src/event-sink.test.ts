import { threadScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createEventSink,
  EventSinkDeliveryError,
  type CreateEventSinkOptions,
} from "./event-sink.js";

function createLogger(): CreateEventSinkOptions["logger"] {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function systemErrorEvent(threadId: string) {
  return {
    type: "system/error",
    threadId,
    scope: threadScope(),
    message: "boom",
  } as const;
}

describe("event sink", () => {
  it("posts emitted events without producer ids", async () => {
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => ({
        kind: "accepted",
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({
      threadId: "thr_1",
      event: systemErrorEvent("thr_1"),
    });
    await sink.flush();

    expect(postEvents).toHaveBeenCalledWith([
      {
        threadId: "thr_1",
        event: systemErrorEvent("thr_1"),
      },
    ]);
  });

  it("waits briefly for a session before posting queued events", async () => {
    let sessionOpen = false;
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async (events) => ({
        kind: "accepted",
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      maxQueueAgeMs: 100,
      postEvents,
      reconnectRetryDelayMs: 1,
    });

    sink.emit({
      threadId: "thr_1",
      event: systemErrorEvent("thr_1"),
    });
    const flush = sink.flush();
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    sessionOpen = true;
    await flush;

    expect(postEvents).toHaveBeenCalledTimes(1);
  });

  it("fails terminally on post failure instead of retrying ambiguously", async () => {
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(async () => {
      throw new Error("response lost");
    });
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({
      threadId: "thr_1",
      event: systemErrorEvent("thr_1"),
    });
    await expect(sink.flush()).rejects.toThrow(EventSinkDeliveryError);
    await expect(sink.flush()).rejects.toThrow(EventSinkDeliveryError);
    expect(postEvents).toHaveBeenCalledTimes(1);
  });

  it("fails terminally when the server rejects an event", async () => {
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(
      async () => ({
        kind: "accepted",
        acceptedEvents: [],
        rejectedEvents: [
          {
            eventIndex: 0,
            reason: "thread_not_owned_by_host",
            threadId: "thr_1",
          },
        ],
      }),
    );
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({
      threadId: "thr_1",
      event: systemErrorEvent("thr_1"),
    });

    await expect(sink.flush()).rejects.toThrow(EventSinkDeliveryError);
  });
});
