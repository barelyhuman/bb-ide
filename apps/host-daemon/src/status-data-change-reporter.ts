import path from "node:path";
import type { HostDaemonStatusDataChangePayload } from "@bb/host-daemon-contract";
import type { JsonValue, StatusDataKey } from "@bb/domain";
import { STATUS_DATA_DIRECTORY_NAME } from "@bb/host-watcher";
import {
  readStatusDataDirectoryFingerprintFromRoot,
  readHostStatusDataFromRoot,
} from "./command-handlers/status-data.js";
import { CommandDispatchError } from "./command-dispatch-support.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";
import {
  readPreviousValue,
  statusDataCacheKey,
  StatusDataCache,
  type CachedStatusDataValue,
} from "./status-data-reporter-cache.js";
import {
  applyStatusDataSnapshotDiff,
  shouldSkipUnchangedStatusDataSnapshot,
} from "./status-data-snapshot-diff.js";

interface CreateStatusDataChangeReporterOptions {
  logger: HostDaemonLogger;
  postStatusDataChange: (
    payload: HostDaemonStatusDataChangePayload,
  ) => Promise<void>;
}

interface StatusDataCacheKeyArgs {
  key: StatusDataKey;
  threadId: string;
}

interface ReportObservedDeleteArgs extends StatusDataCacheKeyArgs {
  generation: number;
  previous: CachedStatusDataValue | undefined;
  threadStoragePath: string;
}

interface ReportObservedChangeArgs {
  change: ObserveStatusDataChangeArgs;
  generation: number;
}

interface PrimeThreadArgs {
  generation: number;
  target: TrackedStatusDataThread;
}

interface ReportThreadSnapshotDiffArgs extends ReconcileThreadStatusDataArgs {
  generation: number;
}

interface ApplyThreadSnapshotArgs extends ReconcileThreadStatusDataArgs {
  generation: number;
  postChanges: boolean;
  skipUnchangedFingerprint: boolean;
}

interface RefreshThreadFingerprintArgs extends ReconcileThreadStatusDataArgs {
  generation: number;
}

interface StatusDataReporterGenerationArgs {
  generation: number;
}

export interface ObserveStatusDataChangeArgs {
  key: StatusDataKey;
  threadId: string;
  threadStoragePath: string;
}

export interface TrackedStatusDataThread {
  threadId: string;
  threadStoragePath: string;
}

export interface TrackStatusDataThreadArgs {
  threadId: string;
}

export interface ReplaceTrackedStatusDataThreadsArgs {
  targets: readonly TrackedStatusDataThread[];
}

export interface ReconcileThreadStatusDataArgs {
  threadId: string;
  threadStoragePath: string;
}

export interface RecordStatusDataCommandSetArgs {
  key: StatusDataKey;
  threadId: string;
  value: JsonValue;
  version: string;
}

export interface RecordStatusDataCommandDeleteArgs {
  key: StatusDataKey;
  threadId: string;
}

function isMissingStatusDataEntryError(error: Error): boolean {
  return error instanceof CommandDispatchError && error.code === "ENOENT";
}

function isNonReportableStatusDataReadError(error: Error): boolean {
  return (
    error instanceof CommandDispatchError &&
    (error.code === "invalid_json" ||
      error.code === "invalid_path" ||
      error.code === "file_too_large")
  );
}

export class StatusDataChangeReporter {
  // This cache tracks values known by the server, not merely values seen on disk.
  private readonly cache = new StatusDataCache();
  private readonly pendingByCacheKey = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(
    private readonly options: CreateStatusDataChangeReporterOptions,
  ) {}

  private isCurrentGeneration(args: StatusDataReporterGenerationArgs): boolean {
    return args.generation === this.generation;
  }

  async replaceTrackedThreads(
    args: ReplaceTrackedStatusDataThreadsArgs,
  ): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    const nextThreadIds = new Set(
      args.targets.map((target) => target.threadId),
    );
    this.pendingByCacheKey.clear();
    const previouslyTrackedThreadIds = this.cache.replaceTrackedThreadIds({
      threadIds: nextThreadIds,
    });
    await Promise.all(
      args.targets.map((target) =>
        previouslyTrackedThreadIds.has(target.threadId)
          ? this.reconcileThread(target)
          : this.primeThread({ generation, target }),
      ),
    );
  }

  trackThread(args: TrackStatusDataThreadArgs): void {
    this.cache.trackThread({ threadId: args.threadId });
  }

  recordCommandSet(args: RecordStatusDataCommandSetArgs): void {
    if (!this.cache.isTracked({ threadId: args.threadId })) {
      this.options.logger.warn(
        {
          key: args.key,
          threadId: args.threadId,
        },
        "Ignoring STATUS-data command result for untracked thread",
      );
      return;
    }
    this.cache.setValue({
      key: args.key,
      threadId: args.threadId,
      value: args.value,
      version: args.version,
    });
  }

  recordCommandDelete(args: RecordStatusDataCommandDeleteArgs): void {
    if (!this.cache.isTracked({ threadId: args.threadId })) {
      this.options.logger.warn(
        {
          key: args.key,
          threadId: args.threadId,
        },
        "Ignoring STATUS-data command result for untracked thread",
      );
      return;
    }
    this.cache.deleteValue({ key: args.key, threadId: args.threadId });
  }

  async reconcileThread(args: ReconcileThreadStatusDataArgs): Promise<void> {
    if (!this.cache.isTracked({ threadId: args.threadId })) {
      return;
    }
    const generation = this.generation;
    try {
      await this.reportThreadSnapshotDiff({
        ...args,
        generation,
      });
    } catch (error) {
      this.options.logger.warn(
        {
          threadId: args.threadId,
          threadStoragePath: args.threadStoragePath,
          ...runtimeErrorLogFields(error),
        },
        "Failed to reconcile STATUS-data changes",
      );
    }
  }

  observe(args: ObserveStatusDataChangeArgs): Promise<void> {
    const cacheKey = statusDataCacheKey(args);
    const generation = this.generation;
    const previous = this.pendingByCacheKey.get(cacheKey) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() =>
        this.reportObservedChange({
          change: args,
          generation,
        }),
      )
      .catch((error) => {
        this.options.logger.warn(
          {
            key: args.key,
            threadId: args.threadId,
            ...runtimeErrorLogFields(error),
          },
          "Failed to report observed STATUS-data change",
        );
      })
      .finally(() => {
        if (this.pendingByCacheKey.get(cacheKey) === pending) {
          this.pendingByCacheKey.delete(cacheKey);
        }
      });
    this.pendingByCacheKey.set(cacheKey, pending);
    return pending;
  }

  private async primeThread(args: PrimeThreadArgs): Promise<void> {
    try {
      await this.applyThreadSnapshot({
        generation: args.generation,
        postChanges: false,
        skipUnchangedFingerprint: false,
        threadId: args.target.threadId,
        threadStoragePath: args.target.threadStoragePath,
      });
    } catch (error) {
      this.options.logger.warn(
        {
          threadId: args.target.threadId,
          threadStoragePath: args.target.threadStoragePath,
          ...runtimeErrorLogFields(error),
        },
        "Failed to prime STATUS-data change cache",
      );
    }
  }

  private async reportObservedChange(
    args: ReportObservedChangeArgs,
  ): Promise<void> {
    if (args.generation !== this.generation) {
      return;
    }
    const previous = this.cache.getValue({
      key: args.change.key,
      threadId: args.change.threadId,
    });

    try {
      const entry = await readHostStatusDataFromRoot({
        rootPath: args.change.threadStoragePath,
        key: args.change.key,
      });
      if (args.generation !== this.generation) {
        return;
      }
      if (previous?.version === entry.version) {
        return;
      }
      await this.options.postStatusDataChange({
        threadId: args.change.threadId,
        key: args.change.key,
        deleted: false,
        value: entry.value,
        version: entry.version,
        ...readPreviousValue(previous),
      });
      if (args.generation !== this.generation) {
        return;
      }
      this.cache.setValue({
        key: args.change.key,
        threadId: args.change.threadId,
        value: entry.value,
        version: entry.version,
      });
      await this.refreshThreadFingerprint({
        generation: args.generation,
        threadId: args.change.threadId,
        threadStoragePath: args.change.threadStoragePath,
      });
      return;
    } catch (error) {
      if (error instanceof Error && isMissingStatusDataEntryError(error)) {
        await this.reportObservedDelete({
          generation: args.generation,
          key: args.change.key,
          previous,
          threadId: args.change.threadId,
          threadStoragePath: args.change.threadStoragePath,
        });
        return;
      }
      if (error instanceof Error && isNonReportableStatusDataReadError(error)) {
        this.options.logger.warn(
          {
            key: args.change.key,
            statusDataPath: path.join(
              args.change.threadStoragePath,
              STATUS_DATA_DIRECTORY_NAME,
              `${args.change.key}.json`,
            ),
            threadId: args.change.threadId,
            ...runtimeErrorLogFields(error),
          },
          "Ignoring unreadable observed STATUS-data file",
        );
        return;
      }
      throw error;
    }
  }

  private async reportObservedDelete(
    args: ReportObservedDeleteArgs,
  ): Promise<void> {
    if (args.generation !== this.generation || args.previous === undefined) {
      return;
    }
    await this.options.postStatusDataChange({
      threadId: args.threadId,
      key: args.key,
      deleted: true,
      value: null,
      version: null,
      ...readPreviousValue(args.previous),
    });
    if (args.generation !== this.generation) {
      return;
    }
    this.cache.deleteValue({ key: args.key, threadId: args.threadId });
    await this.refreshThreadFingerprint({
      generation: args.generation,
      threadId: args.threadId,
      threadStoragePath: args.threadStoragePath,
    });
  }

  private async refreshThreadFingerprint(
    args: RefreshThreadFingerprintArgs,
  ): Promise<void> {
    try {
      const fingerprint = await readStatusDataDirectoryFingerprintFromRoot({
        rootPath: args.threadStoragePath,
      });
      if (args.generation !== this.generation) {
        return;
      }
      this.cache.setFingerprint({
        fingerprint,
        threadId: args.threadId,
      });
    } catch (error) {
      this.options.logger.warn(
        {
          threadId: args.threadId,
          threadStoragePath: args.threadStoragePath,
          ...runtimeErrorLogFields(error),
        },
        "Failed to refresh STATUS-data directory fingerprint",
      );
    }
  }

  private async reportThreadSnapshotDiff(
    args: ReportThreadSnapshotDiffArgs,
  ): Promise<void> {
    await this.applyThreadSnapshot({
      ...args,
      postChanges: true,
      skipUnchangedFingerprint: true,
    });
  }

  private async applyThreadSnapshot(
    args: ApplyThreadSnapshotArgs,
  ): Promise<void> {
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    if (
      args.skipUnchangedFingerprint &&
      (await shouldSkipUnchangedStatusDataSnapshot({
        cache: this.cache,
        generation: args.generation,
        isCurrentGeneration: (generationArgs) =>
          this.isCurrentGeneration(generationArgs),
        threadId: args.threadId,
        threadStoragePath: args.threadStoragePath,
      }))
    ) {
      return;
    }

    await applyStatusDataSnapshotDiff({
      cache: this.cache,
      generation: args.generation,
      isCurrentGeneration: (generationArgs) =>
        this.isCurrentGeneration(generationArgs),
      postChanges: args.postChanges,
      postStatusDataChange: (payload) =>
        this.options.postStatusDataChange(payload),
      threadId: args.threadId,
      threadStoragePath: args.threadStoragePath,
    });
    if (!this.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    await this.refreshThreadFingerprint(args);
  }
}
