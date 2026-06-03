import {
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  requestEnvironmentCleanupAndAdvance,
  wouldCleanupEnvironment,
  wouldCleanupEnvironmentWithNoLiveThreads,
} from "../environments/environment-lifecycle-owner.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import {
  queueSettledArchivedThreadProviderArchiveCommand,
  requestThreadStopIfNeeded,
} from "./thread-lifecycle.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import {
  requireThreadHostCommandEnvironment,
  type ThreadHostCommandEnvironment,
} from "./thread-command-environment.js";

export interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: {
    hostId: string;
    id: string;
  };
  thread: Thread;
}

export interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

export interface ArchiveManagerThreadsArgs {
  managerThread: Thread;
}

export interface ArchiveThreadWithLifecycleEffectsResult {
  archivedThread: Thread;
}

export interface ArchiveEnvironmentThreadsResult {
  archivedThreadIds: string[];
}

export interface ArchiveManagerThreadsResult {
  archivedThreadIds: string[];
}

type ThreadArchiveCleanupDeps = Pick<AppDeps, "db">;

interface BuildManagerArchiveThreadsArgs {
  childThreads: Thread[];
  managerThread: Thread;
}

interface ManagerArchiveTarget {
  environment: ThreadHostCommandEnvironment;
  thread: Thread;
}

interface ResolveManagerArchiveTargetsArgs {
  threads: Thread[];
}

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
    requestEnvironmentCleanupAndAdvance(deps, {
      environmentId: args.environment.id,
    });
  }

  return { archivedThreadIds };
}

function buildManagerArchiveThreads({
  childThreads,
  managerThread,
}: BuildManagerArchiveThreadsArgs): Thread[] {
  const threads = childThreads.filter(
    (thread) => thread.id !== managerThread.id,
  );
  if (managerThread.archivedAt === null) {
    threads.push(managerThread);
  }
  return threads;
}

function resolveManagerArchiveTargets(
  deps: AppDeps,
  args: ResolveManagerArchiveTargetsArgs,
): ManagerArchiveTarget[] {
  return args.threads.map((thread) => ({
    environment: requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    }),
    thread,
  }));
}

export function archiveManagerThreads(
  deps: AppDeps,
  args: ArchiveManagerThreadsArgs,
): ArchiveManagerThreadsResult {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.managerThread.id,
  });
  const threads = buildManagerArchiveThreads({
    childThreads,
    managerThread: args.managerThread,
  });
  const targets = resolveManagerArchiveTargets(deps, { threads });
  const archivedThreadIds: string[] = [];
  const affectedEnvironmentIds = new Set<string>();

  for (const target of targets) {
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment: target.environment,
      thread: target.thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.archivedThread.id);
    affectedEnvironmentIds.add(target.environment.id);
  }

  for (const environmentId of affectedEnvironmentIds) {
    if (
      wouldCleanupEnvironmentWithNoLiveThreads(deps, {
        environmentId,
      })
    ) {
      requestEnvironmentCleanupAndAdvance(deps, { environmentId });
    }
  }

  return { archivedThreadIds };
}
