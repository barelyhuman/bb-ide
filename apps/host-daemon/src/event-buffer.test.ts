import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBuffer } from "./event-buffer.js";

describe("event buffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes pushed events through the poster callback", async () => {
    vi.useFakeTimers();
    const postEvents = vi.fn(async () => ({ threadA: 1 }));
    const buffer = createEventBuffer({ postEvents });

    const event = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { type: "turn/started" },
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(event.sequence).toBe(1);
    expect(postEvents).toHaveBeenCalledWith([event]);
    expect(buffer.depth()).toBe(0);
  });

  it("discards acked events at or below the thread high-water mark", async () => {
    const buffer = createEventBuffer({
      postEvents: async () => undefined,
      flushAtCount: 1_000,
    });

    const first = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { type: "first" },
    });
    const second = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { type: "second" },
    });
    const other = buffer.push({
      environmentId: "env-2",
      threadId: "threadB",
      event: { type: "other" },
    });

    buffer.ack({ threadA: first.sequence });

    expect(buffer.snapshot()).toEqual([second, other]);
    buffer.dispose();
  });

  it("retries failed flushes and keeps events until they are acknowledged", async () => {
    vi.useFakeTimers();
    const postEvents = vi
      .fn<(_: unknown) => Promise<Record<string, number>>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ threadA: 1 });
    const buffer = createEventBuffer({ postEvents });

    buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { type: "turn/completed" },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(postEvents).toHaveBeenCalledTimes(1);
    expect(buffer.depth()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(postEvents).toHaveBeenCalledTimes(2);
    expect(buffer.depth()).toBe(0);
  });

  it("drops the oldest events when the buffer exceeds the max size", async () => {
    const buffer = createEventBuffer({
      postEvents: async () => undefined,
      flushAtCount: 2_000,
      maxBufferedEvents: 3,
    });

    buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 1 },
    });
    const second = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 2 },
    });
    const third = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 3 },
    });
    const fourth = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 4 },
    });

    expect(buffer.snapshot()).toEqual([second, third, fourth]);
    buffer.dispose();
  });

  it("assigns monotonic per-thread sequence numbers", () => {
    const buffer = createEventBuffer({
      postEvents: async () => undefined,
      flushAtCount: 1_000,
    });

    const first = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 1 },
    });
    const second = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { index: 2 },
    });
    const other = buffer.push({
      environmentId: "env-1",
      threadId: "threadB",
      event: { index: 1 },
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(other.sequence).toBe(1);
    buffer.dispose();
  });

  it("starts sequences from the provided high-water marks", () => {
    const buffer = createEventBuffer({
      postEvents: async () => undefined,
      flushAtCount: 1_000,
      initialHighWaterMarks: {
        threadA: 41,
      },
    });

    const event = buffer.push({
      environmentId: "env-1",
      threadId: "threadA",
      event: { type: "resumed" },
    });

    expect(event.sequence).toBe(42);
    buffer.dispose();
  });
});
