import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBufferedEnvironmentChangeReporter,
  createCommandFetchLoop,
} from "./app.js";
import {
  createDeferredPromise,
} from "@bb/test-helpers";
import type { HostDaemonEnvironmentChangePayload } from "@bb/host-daemon-contract";
import { AbortError } from "p-retry";

interface FetchCommandsArgs {
  afterCursor: number;
}

interface CreateReporterArgs {
  logger?: ReturnType<typeof createLogger>;
  reportEnvironmentChange?: (
    change: HostDaemonEnvironmentChangePayload,
  ) => Promise<void>;
}

const TEST_REPORTER_DEBOUNCE_MS = 100;
const TEST_REPORTER_RETRY_DELAY_MS = 250;
const TEST_REPORTER_RETRY_MAX_DELAY_MS = 1_000;

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createReporter(args: CreateReporterArgs) {
  return createBufferedEnvironmentChangeReporter({
    debounceMs: TEST_REPORTER_DEBOUNCE_MS,
    logger: args.logger ?? createLogger(),
    reportEnvironmentChange:
      args.reportEnvironmentChange ?? (async () => undefined),
    retryDelayMs: TEST_REPORTER_RETRY_DELAY_MS,
    retryMaxDelayMs: TEST_REPORTER_RETRY_MAX_DELAY_MS,
  });
}

describe("createCommandFetchLoop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries fetching commands after transient failures", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<unknown[]>>()
      .mockRejectedValueOnce(new Error("boom"))
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
    await vi.waitFor(() => {
      expect(fetchCommands).toHaveBeenCalledTimes(2);
    });
    expect(handleCommands).not.toHaveBeenCalled();
  });
});

describe("createBufferedEnvironmentChangeReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates repeated workspace status change hints into one server report per environment", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi.fn(async () => undefined);
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });
    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);
    expect(reportEnvironmentChange).toHaveBeenCalledWith({
      environmentId: "env-1",
      change: "work-status-changed",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("preserves trailing workspace status changes that arrive while a report is in flight", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const firstReport = createDeferredPromise<void>();
    const reportEnvironmentChange = vi
      .fn<(_: HostDaemonEnvironmentChangePayload) => Promise<void>>()
      .mockImplementationOnce(() => firstReport.promise)
      .mockResolvedValueOnce(undefined);
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });

    firstReport.resolve(undefined);
    await Promise.resolve();

    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("cancels queued environment change reports on dispose", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi.fn(async () => undefined);
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });
    reporter.dispose();
    await vi.advanceTimersByTimeAsync(100);

    expect(reportEnvironmentChange).not.toHaveBeenCalled();
  });

  it("retries failed environment change reports until one succeeds", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi
      .fn<(_: HostDaemonEnvironmentChangePayload) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(2);
  });

  it("drops permanent environment change failures without retrying", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi
      .fn<(_: HostDaemonEnvironmentChangePayload) => Promise<void>>()
      .mockRejectedValueOnce(new AbortError("gone"));
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    reporter.queue({
      environmentId: "env-1",
      change: "work-status-changed",
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);
  });
});
