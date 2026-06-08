import type { ThreadEventTurnStatus } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueManagerSystemMessage } from "./manager-system-messages.js";

export interface ManagedThreadTurnNotificationBatchItem {
  managedThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface ManagedThreadTurnNotificationBatch {
  items: ManagedThreadTurnNotificationBatchItem[];
  timer: ReturnType<typeof setTimeout>;
}

interface RenderManagedThreadTurnStatusBatchMessageArgs {
  items: ManagedThreadTurnNotificationBatchItem[];
}

interface RenderManagedThreadNeedsAttentionMessageArgs {
  managedThreadId: string;
  title: string | null;
}

interface QueueManagedThreadTurnNotificationArgs {
  managedThreadId: string;
  managerThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface QueueManagedThreadNeedsAttentionNotificationArgs {
  managedThreadId: string;
  managerThreadId: string;
  title: string | null;
}

const MANAGED_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS = 2_000;
const managedThreadTurnNotificationBatches = new Map<
  string,
  ManagedThreadTurnNotificationBatch
>();

function formatManagedThreadTitleSuffix(title: string | null): string {
  return title ? ` (${title})` : "";
}

function formatManagedThreadTurnStatusLabel(
  turnStatus: ThreadEventTurnStatus,
): string {
  switch (turnStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

function formatManagedThreadTurnStatusLine(
  item: ManagedThreadTurnNotificationBatchItem,
): string {
  if (item.turnStatus === "interrupted") {
    return `- interrupted: ${item.managedThreadId}${formatManagedThreadTitleSuffix(item.title)}. Inspect this thread directly before taking action. If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.`;
  }
  return `- ${formatManagedThreadTurnStatusLabel(item.turnStatus)}: ${item.managedThreadId}${formatManagedThreadTitleSuffix(item.title)}`;
}

export function renderManagedThreadTurnStatusBatchMessage(
  args: RenderManagedThreadTurnStatusBatchMessageArgs,
): string {
  return renderTemplate("systemMessageManagedThreadOutcomeBatch", {
    updates: args.items.map(formatManagedThreadTurnStatusLine).join("\n"),
  });
}

function managedThreadTurnNotificationLogMessage(
  turnStatus: ThreadEventTurnStatus,
): string {
  switch (turnStatus) {
    case "completed":
      return "Failed to queue manager completed-thread notification";
    case "failed":
      return "Failed to queue manager failed-thread notification";
    case "interrupted":
      return "Failed to queue manager interrupted-thread notification";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

async function flushManagedThreadTurnNotificationBatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  managerThreadId: string,
): Promise<void> {
  const batch = managedThreadTurnNotificationBatches.get(managerThreadId);
  if (!batch) {
    return;
  }
  managedThreadTurnNotificationBatches.delete(managerThreadId);

  try {
    await queueManagerSystemMessage(deps, {
      managerThreadId,
      messageText: renderManagedThreadTurnStatusBatchMessage({
        items: batch.items,
      }),
    });
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        managerThreadId,
        managedThreads: batch.items.map((item) => ({
          managedThreadId: item.managedThreadId,
          turnStatus: item.turnStatus,
        })),
      },
      "Failed to queue batched manager turn notifications",
    );
  }
}

function scheduleManagedThreadTurnNotificationBatchFlush(
  deps: LoggedPendingInteractionWorkSessionDeps,
  managerThreadId: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void flushManagedThreadTurnNotificationBatch(deps, managerThreadId);
  }, MANAGED_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS);
}

function queueManagedThreadTurnNotificationBatchItem(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagedThreadTurnNotificationArgs,
): void {
  const existingBatch = managedThreadTurnNotificationBatches.get(
    args.managerThreadId,
  );
  if (existingBatch) {
    existingBatch.items.push({
      managedThreadId: args.managedThreadId,
      title: args.title,
      turnStatus: args.turnStatus,
    });
    clearTimeout(existingBatch.timer);
    existingBatch.timer = scheduleManagedThreadTurnNotificationBatchFlush(
      deps,
      args.managerThreadId,
    );
    return;
  }

  managedThreadTurnNotificationBatches.set(args.managerThreadId, {
    items: [
      {
        managedThreadId: args.managedThreadId,
        title: args.title,
        turnStatus: args.turnStatus,
      },
    ],
    timer: scheduleManagedThreadTurnNotificationBatchFlush(
      deps,
      args.managerThreadId,
    ),
  });
}

function renderManagedThreadNeedsAttentionMessage(
  args: RenderManagedThreadNeedsAttentionMessageArgs,
): string {
  return renderTemplate("systemMessageManagedThreadNeedsAttention", {
    threadId: args.managedThreadId,
    titleSuffix: formatManagedThreadTitleSuffix(args.title),
  });
}

/**
 * Queues a manager-facing notification for managed thread turn outcomes.
 * Normal turn-completion event side effects pass the actual terminal status;
 * command-result failures pass `failed` because no terminal turn event exists.
 * This is best-effort post-commit notification work.
 */
export async function queueManagedThreadTurnNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagedThreadTurnNotificationArgs,
): Promise<void> {
  try {
    queueManagedThreadTurnNotificationBatchItem(deps, args);
  } catch (error) {
    deps.logger.error(
      {
        managedThreadId: args.managedThreadId,
        managerThreadId: args.managerThreadId,
        turnStatus: args.turnStatus,
        err: error,
      },
      managedThreadTurnNotificationLogMessage(args.turnStatus),
    );
  }
}

export async function queueManagedThreadNeedsAttentionNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagedThreadNeedsAttentionNotificationArgs,
): Promise<void> {
  try {
    await queueManagerSystemMessage(deps, {
      managerThreadId: args.managerThreadId,
      messageText: renderManagedThreadNeedsAttentionMessage(args),
    });
  } catch (error) {
    deps.logger.error(
      {
        managedThreadId: args.managedThreadId,
        managerThreadId: args.managerThreadId,
        err: error,
      },
      "Failed to queue manager needs-attention notification",
    );
  }
}
