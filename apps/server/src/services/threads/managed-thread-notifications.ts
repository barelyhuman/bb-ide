import type { PromptInput, Thread, ThreadEventTurnStatus } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  buildManagerSystemInputFromTemplateSlot,
  buildManagerSystemThreadMention,
  queueManagerSystemMessage,
  type ManagerSystemInputSegment,
  type ManagerSystemRenderedMention,
} from "./manager-system-messages.js";

export interface ManagedThreadTurnNotificationBatchItem {
  managedThread: Thread;
  turnStatus: ThreadEventTurnStatus;
}

interface ManagedThreadTurnNotificationBatch {
  items: ManagedThreadTurnNotificationBatchItem[];
  timer: ReturnType<typeof setTimeout>;
}

interface RenderManagedThreadTurnStatusBatchMessageArgs {
  items: ManagedThreadTurnNotificationBatchItem[];
}

interface ManagedThreadTurnStatusBatchLine {
  item: ManagedThreadTurnNotificationBatchItem;
  mention: ManagerSystemRenderedMention;
}

interface RenderManagedThreadTurnStatusBatchTextArgs {
  lines: ManagedThreadTurnStatusBatchLine[];
}

interface FormatManagedThreadTurnStatusLineArgs {
  line: ManagedThreadTurnStatusBatchLine;
}

interface BuildManagedThreadTurnStatusBatchInputArgs {
  items: ManagedThreadTurnNotificationBatchItem[];
}

interface BuildManagedThreadNeedsAttentionInputArgs {
  managedThread: Thread;
}

interface QueueManagedThreadTurnNotificationArgs {
  managedThread: Thread;
  managerThreadId: string;
  turnStatus: ThreadEventTurnStatus;
}

interface QueueManagedThreadNeedsAttentionNotificationArgs {
  managedThread: Thread;
  managerThreadId: string;
}

const MANAGED_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS = 2_000;
const MANAGED_THREAD_OUTCOME_BATCH_UPDATES_SLOT =
  "__BB_MANAGED_THREAD_OUTCOME_BATCH_UPDATES__";
const MANAGED_THREAD_ID_SLOT = "__BB_MANAGED_THREAD_ID__";
const MANAGED_THREAD_INTERRUPTED_GUIDANCE =
  ". Inspect this thread directly before taking action. If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.";
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

function buildManagedThreadTurnStatusBatchLines(
  args: RenderManagedThreadTurnStatusBatchMessageArgs,
): ManagedThreadTurnStatusBatchLine[] {
  return args.items.map((item) => ({
    item,
    mention: buildManagerSystemThreadMention({
      thread: item.managedThread,
    }),
  }));
}

function formatManagedThreadTurnStatusLine(
  args: FormatManagedThreadTurnStatusLineArgs,
): string {
  const titleSuffix = formatManagedThreadTitleSuffix(
    args.line.item.managedThread.title,
  );
  if (args.line.item.turnStatus === "interrupted") {
    return `- interrupted: ${args.line.mention.serializedText}${titleSuffix}${MANAGED_THREAD_INTERRUPTED_GUIDANCE}`;
  }
  return `- ${formatManagedThreadTurnStatusLabel(args.line.item.turnStatus)}: ${args.line.mention.serializedText}${titleSuffix}`;
}

function renderManagedThreadTurnStatusBatchText(
  args: RenderManagedThreadTurnStatusBatchTextArgs,
): string {
  return renderTemplate("systemMessageManagedThreadOutcomeBatch", {
    updates: args.lines
      .map((line) => formatManagedThreadTurnStatusLine({ line }))
      .join("\n"),
  });
}

function buildManagedThreadTurnStatusLineSegments(
  args: FormatManagedThreadTurnStatusLineArgs,
): ManagerSystemInputSegment[] {
  const titleSuffix = formatManagedThreadTitleSuffix(
    args.line.item.managedThread.title,
  );
  if (args.line.item.turnStatus === "interrupted") {
    return [
      { kind: "text", text: "- interrupted: " },
      { kind: "mention", mention: args.line.mention },
      {
        kind: "text",
        text: `${titleSuffix}${MANAGED_THREAD_INTERRUPTED_GUIDANCE}`,
      },
    ];
  }

  return [
    {
      kind: "text",
      text: `- ${formatManagedThreadTurnStatusLabel(args.line.item.turnStatus)}: `,
    },
    { kind: "mention", mention: args.line.mention },
    { kind: "text", text: titleSuffix },
  ];
}

function buildManagedThreadTurnStatusBatchSegments(
  args: RenderManagedThreadTurnStatusBatchTextArgs,
): ManagerSystemInputSegment[] {
  const segments: ManagerSystemInputSegment[] = [];
  for (const [index, line] of args.lines.entries()) {
    if (index > 0) {
      segments.push({ kind: "text", text: "\n" });
    }
    segments.push(...buildManagedThreadTurnStatusLineSegments({ line }));
  }
  return segments;
}

export function renderManagedThreadTurnStatusBatchMessage(
  args: RenderManagedThreadTurnStatusBatchMessageArgs,
): string {
  return renderManagedThreadTurnStatusBatchText({
    lines: buildManagedThreadTurnStatusBatchLines(args),
  });
}

export function buildManagedThreadTurnStatusBatchInput(
  args: BuildManagedThreadTurnStatusBatchInputArgs,
): PromptInput[] {
  const lines = buildManagedThreadTurnStatusBatchLines(args);
  const renderedText = renderTemplate("systemMessageManagedThreadOutcomeBatch", {
    updates: MANAGED_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
  });
  return buildManagerSystemInputFromTemplateSlot({
    renderedText,
    slot: MANAGED_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
    segments: buildManagedThreadTurnStatusBatchSegments({ lines }),
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
      input: buildManagedThreadTurnStatusBatchInput({
        items: batch.items,
      }),
      managerThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        managerThreadId,
        managedThreads: batch.items.map((item) => ({
          managedThreadId: item.managedThread.id,
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
      managedThread: args.managedThread,
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
        managedThread: args.managedThread,
        turnStatus: args.turnStatus,
      },
    ],
    timer: scheduleManagedThreadTurnNotificationBatchFlush(
      deps,
      args.managerThreadId,
    ),
  });
}

function buildManagedThreadNeedsAttentionInput(
  args: BuildManagedThreadNeedsAttentionInputArgs,
): PromptInput[] {
  const mention = buildManagerSystemThreadMention({
    thread: args.managedThread,
  });
  const renderedText = renderTemplate(
    "systemMessageManagedThreadNeedsAttention",
    {
      threadId: MANAGED_THREAD_ID_SLOT,
      titleSuffix: formatManagedThreadTitleSuffix(args.managedThread.title),
    },
  );
  return buildManagerSystemInputFromTemplateSlot({
    renderedText,
    slot: MANAGED_THREAD_ID_SLOT,
    segments: [{ kind: "mention", mention }],
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
        managedThreadId: args.managedThread.id,
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
      input: buildManagedThreadNeedsAttentionInput(args),
      managerThreadId: args.managerThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        managedThreadId: args.managedThread.id,
        managerThreadId: args.managerThreadId,
        err: error,
      },
      "Failed to queue manager needs-attention notification",
    );
  }
}
