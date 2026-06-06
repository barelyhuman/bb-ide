import { threadScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { createEventSink, type CreateEventSinkOptions } from "./event-sink.js";

function createLogger(): CreateEventSinkOptions["logger"] {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function acceptingPostEvents() {
  return vi.fn<CreateEventSinkOptions["postEvents"]>(async (events) => ({
    kind: "accepted",
    acceptedEvents: events.map((event, eventIndex) => ({
      eventIndex,
      sequence: eventIndex + 1,
      threadId: event.threadId,
    })),
    rejectedEvents: [],
  }));
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
  it("posts emitted events", async () => {
    const postEvents = acceptingPostEvents();
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();

    expect(postEvents).toHaveBeenCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("holds events while the session is closed and delivers them once it reopens", async () => {
    let sessionOpen = false;
    const postEvents = acceptingPostEvents();
    const sink = createEventSink({
      isSessionOpen: () => sessionOpen,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await sink.flush();
    expect(postEvents).not.toHaveBeenCalled();

    sessionOpen = true;
    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(postEvents).toHaveBeenCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("keeps events queued after a post failure and redelivers them on the next flush", async () => {
    const postEvents = vi
      .fn<CreateEventSinkOptions["postEvents"]>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockImplementation(async (events) => ({
        kind: "accepted",
        acceptedEvents: events.map((event, eventIndex) => ({
          eventIndex,
          sequence: eventIndex + 1,
          threadId: event.threadId,
        })),
        rejectedEvents: [],
      }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger: createLogger(),
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    await sink.flush();

    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(postEvents).toHaveBeenLastCalledWith([
      { threadId: "thr_1", event: systemErrorEvent("thr_1") },
    ]);
  });

  it("drops rejected events with a warning without throwing", async () => {
    const logger = createLogger();
    const postEvents = vi.fn<CreateEventSinkOptions["postEvents"]>(async () => ({
      kind: "accepted",
      acceptedEvents: [],
      rejectedEvents: [
        {
          eventIndex: 0,
          reason: "thread_not_owned_by_host",
          threadId: "thr_1",
        },
      ],
    }));
    const sink = createEventSink({
      isSessionOpen: () => true,
      logger,
      postEvents,
    });

    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);

    // The rejected event is dropped, not retried.
    await sink.flush();
    expect(postEvents).toHaveBeenCalledTimes(1);
  });

  it("logs a debug tripwire once when the queue grows large while undelivered", () => {
    const logger = createLogger();
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger,
      postEvents: acceptingPostEvents(),
    });

    for (let index = 0; index < 511; index += 1) {
      sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    }
    expect(logger.debug).not.toHaveBeenCalled();

    // Crossing the depth threshold fires the tripwire once...
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ queueDepth: 512 }),
      expect.any(String),
    );
  });

  it("never throws from emit regardless of how many events queue up", () => {
    const sink = createEventSink({
      isSessionOpen: () => false,
      logger: createLogger(),
      postEvents: acceptingPostEvents(),
    });

    expect(() => {
      for (let index = 0; index < 1000; index += 1) {
        sink.emit({ threadId: "thr_1", event: systemErrorEvent("thr_1") });
      }
    }).not.toThrow();
  });
});
