import type { ThreadEventTurnStatus } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueParentSystemMessage } from "./parent-system-messages.js";

interface RenderChildThreadTurnStatusMessageArgs {
  childThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface RenderChildThreadNeedsAttentionMessageArgs {
  childThreadId: string;
  title: string | null;
}

interface QueueChildThreadTurnNotificationArgs {
  childThreadId: string;
  parentThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface QueueChildThreadNeedsAttentionNotificationArgs {
  childThreadId: string;
  parentThreadId: string;
  title: string | null;
}

function formatChildThreadTitleSuffix(title: string | null): string {
  return title ? ` (${title})` : "";
}

function renderChildThreadTurnStatusMessage(
  args: RenderChildThreadTurnStatusMessageArgs,
): string {
  const variables = {
    threadId: args.childThreadId,
    titleSuffix: formatChildThreadTitleSuffix(args.title),
  };

  switch (args.turnStatus) {
    case "completed":
      return renderTemplate("systemMessageChildThreadComplete", variables);
    case "failed":
      return renderTemplate("systemMessageChildThreadFailed", variables);
    case "interrupted":
      return renderTemplate("systemMessageChildThreadInterrupted", variables);
    default: {
      const exhaustiveCheck: never = args.turnStatus;
      return exhaustiveCheck;
    }
  }
}

function renderChildThreadNeedsAttentionMessage(
  args: RenderChildThreadNeedsAttentionMessageArgs,
): string {
  return renderTemplate("systemMessageChildThreadNeedsAttention", {
    threadId: args.childThreadId,
    titleSuffix: formatChildThreadTitleSuffix(args.title),
  });
}

/**
 * Queues a parent-facing notification for child thread turn outcomes.
 * Normal turn-completion event side effects pass the actual terminal status;
 * command-result failures pass `failed` because no terminal turn event exists.
 * This is best-effort post-commit notification work.
 */
export async function queueChildThreadTurnNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadTurnNotificationArgs,
): Promise<void> {
  try {
    await queueParentSystemMessage(deps, {
      parentThreadId: args.parentThreadId,
      messageText: renderChildThreadTurnStatusMessage(args),
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThreadId,
        parentThreadId: args.parentThreadId,
        turnStatus: args.turnStatus,
        err: error,
      },
      "Failed to queue parent turn notification",
    );
  }
}

export async function queueChildThreadNeedsAttentionNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadNeedsAttentionNotificationArgs,
): Promise<void> {
  try {
    await queueParentSystemMessage(deps, {
      parentThreadId: args.parentThreadId,
      messageText: renderChildThreadNeedsAttentionMessage(args),
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThreadId,
        parentThreadId: args.parentThreadId,
        err: error,
      },
      "Failed to queue parent needs-attention notification",
    );
  }
}
