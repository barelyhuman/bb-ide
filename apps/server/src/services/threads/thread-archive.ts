import { listLiveThreadsInEnvironment } from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
  wouldCleanupEnvironmentWithNoLiveThreads,
} from "../environments/environment-cleanup.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import {
  queueSettledArchivedThreadProviderArchiveCommand,
  requestThreadStopIfNeeded,
} from "./thread-lifecycle.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";

export interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: Environment;
  thread: Thread;
}

export interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

export interface ArchiveThreadWithLifecycleEffectsResult {
  archivedThread: Thread;
}

export interface ArchiveEnvironmentThreadsResult {
  archivedThreadIds: string[];
}

type ThreadArchiveCleanupDeps = Pick<AppDeps, "db">;

export function wouldCleanupAfterThreadArchive(
  deps: ThreadArchiveCleanupDeps,
  thread: Thread,
): boolean {
  return wouldCleanupEnvironment(deps, {
    environmentId: thread.environmentId,
    excludeThreadId: thread.id,
  });
}

export function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): ArchiveThreadWithLifecycleEffectsResult | null {
  const archiveResult = archiveThreadAndReleaseChildren(deps, {
    thread: args.thread,
  });
  if (!archiveResult) {
    return null;
  }

  const { archivedThread } = archiveResult;
  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: archivedThread.id,
  });
  requestThreadStopIfNeeded(deps, archivedThread, args.environment);
  queueSettledArchivedThreadProviderArchiveCommand(deps, {
    threadId: archivedThread.id,
  });
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });

  return { archivedThread };
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): ArchiveEnvironmentThreadsResult {
  const threads = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment: args.environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.archivedThread.id);
  }

  if (
    archivedThreadIds.length > 0 &&
    wouldCleanupEnvironmentWithNoLiveThreads(deps, {
      environmentId: args.environment.id,
    })
  ) {
    requestEnvironmentCleanup(deps, {
      environmentId: args.environment.id,
    });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: args.environment.id,
    });
  }

  return { archivedThreadIds };
}
