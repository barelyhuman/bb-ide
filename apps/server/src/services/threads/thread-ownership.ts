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
import { queueParentSystemMessage } from "./parent-system-messages.js";
import {
  appendThreadOwnershipChangeEvent,
  appendThreadOwnershipChangeEventInTransaction,
} from "./thread-events.js";

interface ThreadLabelSource {
  id: string;
  title: string | null;
}

interface QueueParentSystemMessageBestEffortArgs {
  childThreadId: string;
  parentThreadId: string;
  messageText: string;
  reason: "assigned" | "removed";
}

interface HandleThreadOwnershipChangeArgs {
  previousThread: Thread;
  queueParentMessages: boolean;
  updatedThread: Thread;
}

interface ReleaseUnarchivedChildrenFromArchivedThreadArgs {
  parentThreadId: string;
}

interface ArchiveThreadAndReleaseChildrenArgs {
  threadId: string;
}

interface ThreadOwnershipTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

function formatThreadLabelForParent(thread: ThreadLabelSource): string {
  return thread.title ? `${thread.id}: ${thread.title}` : thread.id;
}

async function queueParentSystemMessageBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueParentSystemMessageBestEffortArgs,
): Promise<void> {
  try {
    await queueParentSystemMessage(deps, {
      parentThreadId: args.parentThreadId,
      messageText: args.messageText,
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThreadId,
        parentThreadId: args.parentThreadId,
        reason: args.reason,
        err: error,
      },
      "Failed to queue parent ownership system message",
    );
  }
}

export async function handleThreadOwnershipChange(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: HandleThreadOwnershipChangeArgs,
): Promise<void> {
  if (
    args.updatedThread.parentThreadId === args.previousThread.parentThreadId
  ) {
    return;
  }

  appendThreadOwnershipChangeEvent(deps, {
    threadId: args.updatedThread.id,
    environmentId: args.updatedThread.environmentId,
    previousParentThreadId: args.previousThread.parentThreadId,
    nextParentThreadId: args.updatedThread.parentThreadId,
  });

  if (!args.queueParentMessages) {
    return;
  }

  const threadLabel = formatThreadLabelForParent(args.updatedThread);
  if (args.updatedThread.parentThreadId) {
    await queueParentSystemMessageBestEffort(deps, {
      childThreadId: args.updatedThread.id,
      parentThreadId: args.updatedThread.parentThreadId,
      messageText: renderTemplate("systemMessageThreadOwnershipAssigned", {
        threadLabel,
      }),
      reason: "assigned",
    });
  }
  if (args.previousThread.parentThreadId) {
    await queueParentSystemMessageBestEffort(deps, {
      childThreadId: args.updatedThread.id,
      parentThreadId: args.previousThread.parentThreadId,
      messageText: renderTemplate("systemMessageThreadOwnershipRemoved", {
        threadLabel,
      }),
      reason: "removed",
    });
  }
}

function releaseUnarchivedChildrenFromArchivedThreadInTransaction(
  deps: ThreadOwnershipTransactionDeps,
  args: ReleaseUnarchivedChildrenFromArchivedThreadArgs,
): void {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.parentThreadId,
  });

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
  }
}

export function archiveThreadAndReleaseChildren(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db" | "hub">,
  args: ArchiveThreadAndReleaseChildrenArgs,
): Thread | null {
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const archivedThread = archiveThread(
        tx,
        notificationBuffer,
        args.threadId,
      );
      if (!archivedThread) {
        return null;
      }

      releaseUnarchivedChildrenFromArchivedThreadInTransaction(
        {
          db: tx,
          hub: notificationBuffer,
        },
        {
          parentThreadId: archivedThread.id,
        },
      );

      return archivedThread;
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}
