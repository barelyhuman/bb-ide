import {
  archiveThread,
  listUnarchivedAssignedChildThreads,
  updateThread,
} from "@bb/db";
import type { PromptInput, Thread } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import type { DbNotifier, DbTransaction } from "@bb/db";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  buildManagerSystemInputFromTemplateSlot,
  buildManagerSystemThreadMention,
  queueManagerSystemMessage,
} from "./manager-system-messages.js";
import {
  appendThreadOwnershipChangeEvent,
  appendThreadOwnershipChangeEventInTransaction,
} from "./thread-events.js";

interface ThreadTitleSource {
  title: string | null;
}

interface QueueManagerSystemMessageBestEffortArgs {
  input: PromptInput[];
  managedThreadId: string;
  managerThreadId: string;
  reason: "assigned" | "removed";
}

type ThreadOwnershipSystemMessageTemplateId =
  | "systemMessageThreadOwnershipAssigned"
  | "systemMessageThreadOwnershipRemoved";

const THREAD_OWNERSHIP_THREAD_LABEL_SLOT = "__BB_THREAD_OWNERSHIP_LABEL__";

interface BuildThreadOwnershipSystemInputArgs {
  templateId: ThreadOwnershipSystemMessageTemplateId;
  thread: Thread;
}

interface HandleThreadOwnershipChangeArgs {
  previousThread: Thread;
  queueManagerMessages: boolean;
  updatedThread: Thread;
}

interface ReleaseUnarchivedChildrenFromArchivedManagerArgs {
  managerThreadId: string;
}

interface ArchiveThreadAndReleaseChildrenArgs {
  threadId: string;
}

interface ThreadOwnershipTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

function formatThreadTitleSuffixForManager(thread: ThreadTitleSource): string {
  return thread.title ? ` (${thread.title})` : "";
}

function buildThreadOwnershipSystemInput(
  args: BuildThreadOwnershipSystemInputArgs,
): PromptInput[] {
  const mention = buildManagerSystemThreadMention({ thread: args.thread });
  const renderedText = renderTemplate(args.templateId, {
    threadLabel: THREAD_OWNERSHIP_THREAD_LABEL_SLOT,
  });
  return buildManagerSystemInputFromTemplateSlot({
    renderedText,
    slot: THREAD_OWNERSHIP_THREAD_LABEL_SLOT,
    segments: [
      { kind: "mention", mention },
      {
        kind: "text",
        text: formatThreadTitleSuffixForManager(args.thread),
      },
    ],
  });
}

async function queueManagerSystemMessageBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagerSystemMessageBestEffortArgs,
): Promise<void> {
  try {
    await queueManagerSystemMessage(deps, {
      input: args.input,
      managerThreadId: args.managerThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        managedThreadId: args.managedThreadId,
        managerThreadId: args.managerThreadId,
        reason: args.reason,
        err: error,
      },
      "Failed to queue manager ownership system message",
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

  if (!args.queueManagerMessages) {
    return;
  }

  if (args.updatedThread.parentThreadId) {
    await queueManagerSystemMessageBestEffort(deps, {
      input: buildThreadOwnershipSystemInput({
        templateId: "systemMessageThreadOwnershipAssigned",
        thread: args.updatedThread,
      }),
      managedThreadId: args.updatedThread.id,
      managerThreadId: args.updatedThread.parentThreadId,
      reason: "assigned",
    });
  }
  if (args.previousThread.parentThreadId) {
    await queueManagerSystemMessageBestEffort(deps, {
      input: buildThreadOwnershipSystemInput({
        templateId: "systemMessageThreadOwnershipRemoved",
        thread: args.updatedThread,
      }),
      managedThreadId: args.updatedThread.id,
      managerThreadId: args.previousThread.parentThreadId,
      reason: "removed",
    });
  }
}

function releaseUnarchivedChildrenFromArchivedManagerInTransaction(
  deps: ThreadOwnershipTransactionDeps,
  args: ReleaseUnarchivedChildrenFromArchivedManagerArgs,
): void {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.managerThreadId,
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

      if (archivedThread.type === "manager") {
        releaseUnarchivedChildrenFromArchivedManagerInTransaction(
          {
            db: tx,
            hub: notificationBuffer,
          },
          {
            managerThreadId: archivedThread.id,
          },
        );
      }

      return archivedThread;
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}
