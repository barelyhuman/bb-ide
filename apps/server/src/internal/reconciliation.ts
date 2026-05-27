import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import {
  environments,
  getThread,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  threads,
} from "@bb/db";
import type { HostDaemonActiveThread } from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../types.js";
import { requestEnvironmentCleanupAdvance } from "../services/environments/environment-cleanup.js";
import {
  completeThreadStart,
  finalizeStoppedThread,
  interruptActiveThreads,
  requestThreadStop,
} from "../services/threads/thread-lifecycle.js";
import { tryTransition } from "../services/threads/thread-transitions.js";

export async function reconcileSessionThreads(
  deps: LoggedPendingInteractionWorkSessionDeps,
  hostId: string,
  activeThreads: HostDaemonActiveThread[],
): Promise<void> {
  const activeThreadIds = activeThreads.map((thread) => thread.threadId);

  const pendingThreads = deps.db
    .select({
      deletedAt: threads.deletedAt,
      environmentId: environments.id,
      id: threads.id,
      status: threads.status,
      archivedAt: threads.archivedAt,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, hostId),
        inArray(threads.status, [
          "active",
          "created",
          "idle",
          "error",
          "provisioning",
        ]),
        or(isNotNull(threads.deletedAt), isNotNull(threads.stopRequestedAt)),
      ),
    )
    .all();

  for (const thread of pendingThreads) {
    const isActive = activeThreadIds.includes(thread.id);

    if (isActive) {
      requestThreadStop(deps, {
        environmentId: thread.environmentId,
        hostId,
        stopRequestedAt: thread.stopRequestedAt,
        threadId: thread.id,
      });
      continue;
    }

    if (thread.stopRequestedAt !== null && !isActive) {
      finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
        threadId: thread.id,
      });
      continue;
    }

    if (thread.deletedAt !== null && !isActive) {
      finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
        threadId: thread.id,
      });
    }
  }

  if (activeThreadIds.length > 0) {
    const erroredThreads = deps.db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(
        and(
          eq(environments.hostId, hostId),
          eq(threads.status, "error"),
          isNull(threads.deletedAt),
          isNull(threads.stopRequestedAt),
          inArray(threads.id, activeThreadIds),
        ),
      )
      .all();

    for (const thread of erroredThreads) {
      tryTransition(deps.db, deps.hub, thread.id, "active");
    }
  }

  const activeButMissing = deps.db
    .select({ environmentId: environments.id, id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, hostId),
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        activeThreadIds.length > 0
          ? notInArray(threads.id, activeThreadIds)
          : undefined,
      ),
    )
    .all();

  interruptActiveThreads(deps, {
    threads: activeButMissing.map((thread) => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
    })),
    reason: "host-daemon-restarted",
  });

  if (activeThreadIds.length > 0) {
    const inactiveButActive = deps.db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(
        and(
          eq(environments.hostId, hostId),
          inArray(threads.status, ["created", "provisioning", "idle"]),
          isNull(threads.deletedAt),
          isNull(threads.stopRequestedAt),
          inArray(threads.id, activeThreadIds),
        ),
      )
      .all();

    const blockedRevivalThreadIds = new Set(
      listThreadIdsWithLatestHostDaemonRestartInterruption(deps.db, {
        threadIds: inactiveButActive.map((thread) => thread.id),
      }),
    );

    for (const thread of inactiveButActive) {
      if (blockedRevivalThreadIds.has(thread.id)) {
        continue;
      }
      tryTransition(deps.db, deps.hub, thread.id, "active");
      completeThreadStart(deps, {
        threadId: thread.id,
      });
    }
  }
}

interface FinalizeStoppedThreadAndRequestCleanupAdvanceArgs {
  threadId: string;
}

function finalizeStoppedThreadAndRequestCleanupAdvance(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadAndRequestCleanupAdvanceArgs,
): void {
  const threadBeforeFinalize = getThread(deps.db, args.threadId);
  const finalized = finalizeStoppedThread(deps, args);
  if (!finalized) {
    return;
  }

  const threadAfterFinalize = getThread(deps.db, args.threadId);
  const environmentId =
    threadAfterFinalize?.environmentId ??
    threadBeforeFinalize?.environmentId ??
    null;
  if (environmentId === null) {
    return;
  }
  requestEnvironmentCleanupAdvance(deps, { environmentId });
}
