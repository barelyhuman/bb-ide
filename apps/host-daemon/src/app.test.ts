import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandFetchLoop } from "./app.js";

interface Deferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue | PromiseLike<TValue>) => void;
  reject: (reason?: Error) => void;
}

interface TestCommand {
  id: string;
}

type HandleCommands = (commands: TestCommand[]) => Promise<void>;

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: Deferred<TValue>["resolve"];
  let reject!: Deferred<TValue>["reject"];
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function handledCommandIds(
  handleCommands: ReturnType<typeof vi.fn<HandleCommands>>,
): string[] {
  return handleCommands.mock.calls.flatMap(([commands]) =>
    commands.map((command) => command.id),
  );
}

describe("createCommandFetchLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries fetching commands with exponential backoff after transient failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => undefined);
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    await loop.request();

    expect(fetchCommands).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchCommands).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(3);
    expect(handleCommands).not.toHaveBeenCalled();
  });

  it("jitters command fetch retry timing", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => undefined);
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    await loop.request();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(2);
  });

  it("fetches newly requested commands while a previous batch is still running", async () => {
    const firstBatchDone = createDeferred<void>();
    const logger = createLogger();
    const firstBatch = [{ id: "slow-command" }];
    const secondBatch = [{ id: "later-thread" }];
    let nextBatch: TestCommand[] = firstBatch;
    let firstHandlerCompleted = false;
    const fetchCommands = vi.fn(async () => {
      const batch = nextBatch;
      nextBatch = [];
      return batch;
    });
    const handleCommands = vi.fn(async (commands: TestCommand[]) => {
      if (commands[0] === firstBatch[0]) {
        await firstBatchDone.promise;
        firstHandlerCompleted = true;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    const firstRequest = loop.request();
    await vi.waitFor(() => {
      expect(handleCommands).toHaveBeenCalledWith(firstBatch);
    });

    nextBatch = secondBatch;
    const secondRequest = loop.request();
    await vi.waitFor(() => {
      expect(handleCommands).toHaveBeenCalledWith(secondBatch);
    });
    expect(firstHandlerCompleted).toBe(false);

    firstBatchDone.resolve();
    await Promise.all([firstRequest, secondRequest]);

    expect(handleCommands).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid in-flight command limits", () => {
    const logger = createLogger();
    const fetchCommands = vi.fn(async () => []);
    const handleCommands = vi.fn(async () => undefined);

    expect(() =>
      createCommandFetchLoop({
        logger,
        fetchCommands,
        handleCommands,
        maxInFlightCommands: 0,
      }),
    ).toThrow("maxInFlightCommands must be a finite number >= 1");
  });

  it("limits concurrently handled commands", async () => {
    const firstCommandDone = createDeferred<void>();
    const secondCommandDone = createDeferred<void>();
    const logger = createLogger();
    const commands = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce(commands)
      .mockResolvedValue([]);
    const handleCommands = vi.fn(async (batch: TestCommand[]) => {
      const command = batch[0];
      if (command?.id === "one") {
        await firstCommandDone.promise;
      }
      if (command?.id === "two") {
        await secondCommandDone.promise;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 2,
    });

    await loop.request();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual(["one", "two"]);
    });

    firstCommandDone.resolve();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual([
        "one",
        "two",
        "three",
      ]);
    });
    secondCommandDone.resolve();
    await loop.stopAndDrain();
  });

  it("retries fetching commands after handler failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce([{ id: "bad-command" }])
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => {
      throw new Error("handler boom");
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 1,
      retryDelayMs: 2_000,
    });

    await loop.request();
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to handle host-daemon commands",
    );
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(fetchCommands).toHaveBeenCalledTimes(2);
    });
  });

  it("waits for active and queued handlers before shutdown drain completes", async () => {
    const firstCommandDone = createDeferred<void>();
    const logger = createLogger();
    const commands = [{ id: "one" }, { id: "two" }];
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce(commands)
      .mockResolvedValue([]);
    const handleCommands = vi.fn(async (batch: TestCommand[]) => {
      if (batch[0]?.id === "one") {
        await firstCommandDone.promise;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 1,
    });

    await loop.request();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual(["one"]);
    });

    let drainCompleted = false;
    const drainPromise = loop.stopAndDrain().then(() => {
      drainCompleted = true;
    });
    await Promise.resolve();
    expect(drainCompleted).toBe(false);

    firstCommandDone.resolve();
    await drainPromise;
    expect(handledCommandIds(handleCommands)).toEqual(["one", "two"]);
  });
});
