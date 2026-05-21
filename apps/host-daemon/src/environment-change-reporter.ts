import type { HostDaemonEnvironmentChangePayload } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import { runtimeErrorLogFields } from "./error-utils.js";

type ReportEnvironmentChange = (
  change: HostDaemonEnvironmentChangePayload,
) => Promise<void>;
type QueueEnvironmentChange = (
  change: HostDaemonEnvironmentChangePayload,
) => void;
type DisposeEnvironmentChangeReporter = () => void;

interface EnvironmentChangeReporterArgs {
  debounceMs: number;
  logger: HostDaemonLogger;
  reportEnvironmentChange: ReportEnvironmentChange;
}

interface EnvironmentChangeReporter {
  dispose: DisposeEnvironmentChangeReporter;
  queue: QueueEnvironmentChange;
}

interface PendingEnvironmentChangeEntry {
  change: HostDaemonEnvironmentChangePayload;
  timer: ReturnType<typeof setTimeout>;
}

interface FlushEntryArgs {
  key: string;
}

function toEnvironmentChangeKey(
  change: HostDaemonEnvironmentChangePayload,
): string {
  return `${change.environmentId}:${change.change}`;
}

export function createEnvironmentChangeReporter(
  args: EnvironmentChangeReporterArgs,
): EnvironmentChangeReporter {
  let disposed = false;
  const entries = new Map<string, PendingEnvironmentChangeEntry>();

  function flushEntry(payload: FlushEntryArgs): void {
    const entry = entries.get(payload.key);
    if (!entry || disposed) {
      return;
    }

    entries.delete(payload.key);
    void (async () => {
      try {
        await args.reportEnvironmentChange(entry.change);
      } catch (error) {
        if (disposed) {
          return;
        }
        args.logger.warn(
          {
            change: entry.change,
            ...runtimeErrorLogFields(error),
          },
          "Failed to report environment change",
        );
      }
    })();
  }

  return {
    queue(change: HostDaemonEnvironmentChangePayload): void {
      if (disposed) {
        return;
      }
      const key = toEnvironmentChangeKey(change);
      if (entries.has(key)) {
        return;
      }
      const entry: PendingEnvironmentChangeEntry = {
        change,
        timer: setTimeout(() => {
          flushEntry({
            key,
          });
        }, args.debounceMs),
      };
      entries.set(key, entry);
    },
    dispose(): void {
      disposed = true;
      for (const entry of entries.values()) {
        clearTimeout(entry.timer);
      }
      entries.clear();
    },
  };
}
