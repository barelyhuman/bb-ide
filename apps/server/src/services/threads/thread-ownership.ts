import {
  archiveThread,
  listUnarchivedAssignedChildThreads,
  updateThread,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import type { DbNotifier, DbTransaction } from "@bb/db";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { queueManagerSystemMessage } from "./manager-system-messages.js";
import {
  appendThreadOwnershipChangeEvent,
  appendThreadOwnershipChangeEventInTransaction,
} from "./thread-events.js";

interface ThreadLabelSource {
  id: string;
  title: string | null;
}

interface QueueManagerSystemMessageBestEffortArgs {
  managedThreadId: string;
  managerThreadId: string;
  messageText: string;
  reason: "assigned" | "removed";
}

export interface HandleThreadOwnershipChangeArgs {
  previousThread: Thread;
  queueManagerMessages: boolean;
  updatedThread: Thread;
}

export interface ReleaseUnarchivedChildrenFromArchivedManagerArgs {
  managerThreadId: string;
}

export interface ArchiveThreadAndReleaseChildrenArgs {
  thread: Thread;
}

export interface ArchiveThreadAndReleaseChildrenResult {
  archivedThread: Thread;
  releasedThreads: Thread[];
}

interface ThreadOwnershipTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

function formatThreadLabelForManager(thread: ThreadLabelSource): string {
  return thread.title ? `${thread.id}: ${thread.title}` : thread.id;
}

async function queueManagerSystemMessageBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagerSystemMessageBestEffortArgs,
): Promise<void> {
  try {
    await queueManagerSystemMessage(deps, {
      managerThreadId: args.managerThreadId,
      messageText: args.messageText,
    });
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        managedThreadId: args.managedThreadId,
        managerThreadId: args.managerThreadId,
        reason: args.reason,
      },
      "Failed to queue manager ownership system message",
    );
  }
}

export async function handleThreadOwnershipChange(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: HandleThreadOwnershipChangeArgs,
): Promise<void> {
  if (args.updatedThread.parentThreadId === args.previousThread.parentThreadId) {
    return;
  }

  appendThreadOwnershipChangeEvent(deps, {
    threadId: args.updatedThread.id,
    environmentId: args.updatedThread.environmentId,
    previousParentThreadId: args.previousThread.parentThreadId,
    nextParentThreadId: args.updatedThread.parentThreadId,
  });

  if (!args.queueManagerMessages) {
    return;
  }

  const threadLabel = formatThreadLabelForManager(args.updatedThread);
  if (args.updatedThread.parentThreadId) {
    await queueManagerSystemMessageBestEffort(deps, {
      managedThreadId: args.updatedThread.id,
      managerThreadId: args.updatedThread.parentThreadId,
      messageText: renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadLabel,
      }),
      reason: "assigned",
    });
  }
  if (args.previousThread.parentThreadId) {
    await queueManagerSystemMessageBestEffort(deps, {
      managedThreadId: args.updatedThread.id,
      managerThreadId: args.previousThread.parentThreadId,
      messageText: renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadLabel,
      }),
      reason: "removed",
    });
  }
}

function releaseUnarchivedChildrenFromArchivedManagerInTransaction(
  deps: ThreadOwnershipTransactionDeps,
  args: ReleaseUnarchivedChildrenFromArchivedManagerArgs,
): Thread[] {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.managerThreadId,
  });
  const releasedThreads: Thread[] = [];

  for (const childThread of childThreads) {
    const updatedThread = updateThread(deps.db, deps.hub, childThread.id, {
      parentThreadId: null,
    });
    if (!updatedThread) {
      continue;
    }
    appendThreadOwnershipChangeEventInTransaction(deps, {
      threadId: updatedThread.id,
      environmentId: updatedThread.environmentId,
      previousParentThreadId: childThread.parentThreadId,
      nextParentThreadId: updatedThread.parentThreadId,
    });
    releasedThreads.push(updatedThread);
  }

  return releasedThreads;
}

export function archiveThreadAndReleaseChildren(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db" | "hub">,
  args: ArchiveThreadAndReleaseChildrenArgs,
): ArchiveThreadAndReleaseChildrenResult | null {
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const archivedThread = archiveThread(
        tx,
        notificationBuffer,
        args.thread.id,
      );
      if (!archivedThread) {
        return null;
      }

      const releasedThreads =
        archivedThread.type === "manager"
          ? releaseUnarchivedChildrenFromArchivedManagerInTransaction(
              {
                db: tx,
                hub: notificationBuffer,
              },
              {
                managerThreadId: archivedThread.id,
              },
            )
          : [];

      return {
        archivedThread,
        releasedThreads,
      };
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}
