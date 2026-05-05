import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import type { HostDaemonEnvironmentChangePayload } from "@bb/host-daemon-contract";
import { createEnvironmentChangeReporter } from "./environment-change-reporter.js";

type ReportEnvironmentChange = (
  change: HostDaemonEnvironmentChangePayload,
) => Promise<void>;

interface CreateReporterArgs {
  logger?: ReturnType<typeof createLogger>;
  reportEnvironmentChange?: ReportEnvironmentChange;
}

const TEST_REPORTER_DEBOUNCE_MS = 100;

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createReporter(args: CreateReporterArgs) {
  return createEnvironmentChangeReporter({
    debounceMs: TEST_REPORTER_DEBOUNCE_MS,
    logger: args.logger ?? createLogger(),
    reportEnvironmentChange:
      args.reportEnvironmentChange ?? (async () => undefined),
  });
}

describe("createEnvironmentChangeReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces repeated workspace status change hints into one server report per environment", async () => {
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
      .fn<ReportEnvironmentChange>()
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

  it("logs failed environment change reports without retrying", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi
      .fn<ReportEnvironmentChange>()
      .mockRejectedValueOnce(new Error("boom"));
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
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("reports a later same-key environment change after a failed report is dropped", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const reportEnvironmentChange = vi
      .fn<ReportEnvironmentChange>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const reporter = createReporter({
      logger,
      reportEnvironmentChange,
    });

    const change: HostDaemonEnvironmentChangePayload = {
      environmentId: "env-1",
      change: "work-status-changed",
    };
    reporter.queue(change);

    await vi.advanceTimersByTimeAsync(100);
    expect(reportEnvironmentChange).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    reporter.queue(change);
    await vi.advanceTimersByTimeAsync(100);

    expect(reportEnvironmentChange).toHaveBeenCalledTimes(2);
    expect(reportEnvironmentChange).toHaveBeenLastCalledWith(change);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
