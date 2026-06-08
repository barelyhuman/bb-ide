import fs from "node:fs/promises";
import path from "node:path";
import { calculateExponentialBackoffDelay } from "@bb/domain";
import {
  RootSubscription,
  type ParcelWatcherEventBatch,
} from "./root-subscription.js";
import { createDebouncedCallbackScheduler } from "./watch-callback-scheduler.js";
import { pathExists } from "./path-exists.js";
import {
  collectWorkspaceStatusChanges,
  resolveMetadataWatchSpecs,
  type WatchSubscriptionSpec,
} from "./watch-specs.js";
import {
  WORKSPACE_STATUS_WATCH_CHANGE_KINDS,
  type WorkspaceStatusWatchChangeKind,
  type WorkspaceStatusWatchArgs,
  type WorkspaceStatusWatchError,
} from "./watch-status-types.js";

const WORKSPACE_STATUS_WATCH_DEBOUNCE_MS = 75;
const WORKSPACE_STATUS_WATCH_MAX_WAIT_MS = 500;
const WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS = 250;
const WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS = 30_000;

interface WorkspaceStatusWatcherArgs extends WorkspaceStatusWatchArgs {
  cwd: string;
  debounceMs: number;
  maxRetryDelayMs: number;
  maxWaitMs: number;
  retryDelayMs: number;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown watch error";
}

function createWorkspaceStatusCallbackError(
  cwd: string,
  error: unknown,
): WorkspaceStatusWatchError {
  return {
    message: `Workspace status callback failed: ${toErrorMessage(error)}`,
    rootPath: cwd,
  };
}

function createWorkspaceRootWatchSpec(cwd: string): WatchSubscriptionSpec {
  return {
    kind: "workspace-root",
    options: {
      ignore: [".git"],
    },
    rootPath: cwd,
  };
}

async function resolveWatchRootPath(rootPath: string): Promise<string> {
  try {
    return await fs.realpath(rootPath);
  } catch {
    return rootPath;
  }
}

export class WorkspaceStatusWatcher {
  private readonly changedPaths = new Set<string>();
  private readonly changeKinds = new Set<WorkspaceStatusWatchChangeKind>();
  private disposed = false;
  private metadataRetryAttempt = 0;
  private metadataStartRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subscriptions = new Map<string, RootSubscription>();
  private readonly changeScheduler;

  constructor(private readonly args: WorkspaceStatusWatcherArgs) {
    this.changeScheduler = createDebouncedCallbackScheduler({
      debounceMs: args.debounceMs,
      maxWaitMs: args.maxWaitMs,
      onFlush: () => {
        if (this.disposed) {
          return;
        }
        try {
          const changedPaths = Array.from(this.changedPaths).sort();
          const changeKinds = Array.from(this.changeKinds);
          this.changedPaths.clear();
          this.changeKinds.clear();
          if (changedPaths.length === 0 || changeKinds.length === 0) {
            return;
          }
          this.args.onChange({
            changedPaths,
            changeKinds,
          });
        } catch (error) {
          this.args.onWatchError(
            createWorkspaceStatusCallbackError(this.args.cwd, error),
          );
        }
      },
    });
  }

  start(): void {
    void this.startAsync();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.changeScheduler.dispose();
    this.changedPaths.clear();
    this.changeKinds.clear();
    if (this.metadataStartRetryTimer !== null) {
      clearTimeout(this.metadataStartRetryTimer);
      this.metadataStartRetryTimer = null;
    }
    await Promise.all(
      [...this.subscriptions.values()].map((subscription) =>
        subscription.dispose(),
      ),
    );
    this.subscriptions.clear();
  }

  private async startAsync(): Promise<void> {
    if (!(await pathExists(path.join(this.args.cwd, ".git")))) {
      return;
    }
    if (this.disposed) {
      return;
    }
    this.startWatchSubscription(
      createWorkspaceRootWatchSpec(await resolveWatchRootPath(this.args.cwd)),
    );
    this.startMetadataWatchSubscriptions();
  }

  private startWatchSubscription(spec: WatchSubscriptionSpec): void {
    if (this.disposed || this.subscriptions.has(spec.rootPath)) {
      return;
    }
    const subscription = new RootSubscription({
      rootPath: spec.rootPath,
      subscribeOptions: spec.options,
      retryDelayMs: this.args.retryDelayMs,
      maxRetryDelayMs: this.args.maxRetryDelayMs,
      onEvents: (events) => {
        this.handleWorkspaceEvents(spec, events);
      },
      onDroppedEvents: () => {
        // Dropped events are recoverable for workspace status: conservatively
        // mark the whole spec changed so consumers re-read current state.
        this.queueConservativeWorkspaceStatusChange(spec);
      },
      onWatchError: (message) => {
        this.args.onWatchError({ message, rootPath: spec.rootPath });
      },
    });
    this.subscriptions.set(spec.rootPath, subscription);
    subscription.start();
  }

  private handleWorkspaceEvents(
    spec: WatchSubscriptionSpec,
    events: ParcelWatcherEventBatch,
  ): void {
    if (events.length === 0) {
      return;
    }
    const changeEvent = collectWorkspaceStatusChanges({ events, spec });
    if (!changeEvent) {
      return;
    }
    for (const changedPath of changeEvent.changedPaths) {
      this.changedPaths.add(changedPath);
    }
    for (const changeKind of changeEvent.changeKinds) {
      this.changeKinds.add(changeKind);
    }
    this.changeScheduler.schedule();
  }

  private queueConservativeWorkspaceStatusChange(
    spec: WatchSubscriptionSpec,
  ): void {
    this.changedPaths.add(spec.rootPath);
    for (const changeKind of WORKSPACE_STATUS_WATCH_CHANGE_KINDS) {
      this.changeKinds.add(changeKind);
    }
    this.changeScheduler.schedule();
  }

  private scheduleMetadataWatchRetry(): void {
    if (this.disposed || this.metadataStartRetryTimer !== null) {
      return;
    }
    this.metadataRetryAttempt += 1;
    this.metadataStartRetryTimer = setTimeout(
      () => {
        this.metadataStartRetryTimer = null;
        this.startMetadataWatchSubscriptions();
      },
      calculateExponentialBackoffDelay({
        attempt: this.metadataRetryAttempt,
        baseDelayMs: this.args.retryDelayMs,
        maxDelayMs: this.args.maxRetryDelayMs,
      }),
    );
  }

  private startMetadataWatchSubscriptions(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): void {
    void this.startMetadataWatchSubscriptionsAsync(metadataSpecs);
  }

  private async startMetadataWatchSubscriptionsAsync(
    metadataSpecs?: WatchSubscriptionSpec[] | null,
  ): Promise<void> {
    try {
      const resolvedMetadataSpecs =
        metadataSpecs ?? (await resolveMetadataWatchSpecs(this.args.cwd));
      if (this.disposed) {
        return;
      }
      if (!resolvedMetadataSpecs) {
        this.scheduleMetadataWatchRetry();
        return;
      }
      this.metadataRetryAttempt = 0;
      for (const spec of resolvedMetadataSpecs) {
        this.startWatchSubscription(spec);
      }
    } catch {
      if (this.disposed) {
        return;
      }
      this.scheduleMetadataWatchRetry();
    }
  }
}

export function createWorkspaceStatusWatcher(
  args: WorkspaceStatusWatchArgs & { cwd: string },
): WorkspaceStatusWatcher {
  return new WorkspaceStatusWatcher({
    cwd: args.cwd,
    debounceMs: WORKSPACE_STATUS_WATCH_DEBOUNCE_MS,
    maxRetryDelayMs: WORKSPACE_STATUS_WATCH_MAX_RETRY_DELAY_MS,
    maxWaitMs: WORKSPACE_STATUS_WATCH_MAX_WAIT_MS,
    onChange: args.onChange,
    onWatchError: args.onWatchError,
    retryDelayMs: WORKSPACE_STATUS_WATCH_RETRY_DELAY_MS,
  });
}
