import { calculateExponentialBackoffDelay } from "@bb/domain";
import type { HostDaemonEnvironmentChangePayload } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import { AbortError } from "p-retry";

interface BufferedEnvironmentChangeReporterArgs {
  debounceMs: number;
  logger: HostDaemonLogger;
  reportEnvironmentChange: (
    change: HostDaemonEnvironmentChangePayload,
  ) => Promise<void>;
  retryMaxDelayMs: number;
  retryDelayMs: number;
}

interface BufferedEnvironmentChangeEntry {
  change: HostDaemonEnvironmentChangePayload;
  dirtyWhileInflight: boolean;
  inflight: boolean;
  retryAttempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ScheduledEntryArgs {
  delayMs: number;
  key: string;
}

interface FlushEntryArgs {
  key: string;
}

function shouldRetryEnvironmentChangeError(error: unknown): boolean {
  return !(error instanceof AbortError);
}

function toEnvironmentChangeKey(change: HostDaemonEnvironmentChangePayload): string {
  return `${change.environmentId}:${change.change}`;
}

export function createBufferedEnvironmentChangeReporter(
  args: BufferedEnvironmentChangeReporterArgs,
) {
  let disposed = false;
  const entries = new Map<string, BufferedEnvironmentChangeEntry>();

  function scheduleEntry(scheduledEntryArgs: ScheduledEntryArgs): void {
    const entry = entries.get(scheduledEntryArgs.key);
    if (!entry || disposed) {
      return;
    }
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void flushEntry({
        key: scheduledEntryArgs.key,
      });
    }, scheduledEntryArgs.delayMs);
  }

  async function flushEntry(payload: FlushEntryArgs): Promise<void> {
    const entry = entries.get(payload.key);
    if (!entry || entry.inflight || disposed) {
      return;
    }
    entry.inflight = true;
    try {
      await args.reportEnvironmentChange(entry.change);
      if (disposed) {
        return;
      }
      if (entries.get(payload.key) !== entry) {
        return;
      }
      entry.inflight = false;
      entry.retryAttempt = 0;
      if (entry.dirtyWhileInflight) {
        entry.dirtyWhileInflight = false;
        scheduleEntry({
          delayMs: args.debounceMs,
          key: payload.key,
        });
        return;
      }
      entries.delete(payload.key);
    } catch (error) {
      if (disposed) {
        return;
      }
      if (entries.get(payload.key) !== entry) {
        return;
      }
      entry.inflight = false;
      if (!shouldRetryEnvironmentChangeError(error)) {
        args.logger.warn(
          {
            change: entry.change,
            err: error,
          },
          "Dropping environment change after permanent failure",
        );
        entries.delete(payload.key);
        return;
      }
      entry.retryAttempt += 1;
      args.logger.warn(
        {
          change: entry.change,
          err: error,
        },
        "Failed to report environment change",
      );
      scheduleEntry({
        delayMs: calculateExponentialBackoffDelay({
          attempt: entry.retryAttempt,
          baseDelayMs: args.retryDelayMs,
          maxDelayMs: args.retryMaxDelayMs,
        }),
        key: payload.key,
      });
    }
  }

  return {
    queue(change: HostDaemonEnvironmentChangePayload): void {
      if (disposed) {
        return;
      }
      const key = toEnvironmentChangeKey(change);
      const existingEntry = entries.get(key);
      if (existingEntry) {
        if (existingEntry.inflight) {
          existingEntry.dirtyWhileInflight = true;
        }
        return;
      }
      entries.set(key, {
        change,
        dirtyWhileInflight: false,
        inflight: false,
        retryAttempt: 0,
        timer: null,
      });
      scheduleEntry({
        delayMs: args.debounceMs,
        key,
      });
    },
    dispose(): void {
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.timer === null) {
          continue;
        }
        clearTimeout(entry.timer);
      }
      entries.clear();
    },
  };
}
