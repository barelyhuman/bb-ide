import type { PromptInput, ThreadEventTurnStatus } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  buildParentSystemInputFromTemplateSlot,
  buildParentSystemThreadMention,
  queueParentSystemMessage,
  type ParentSystemInputSegment,
  type ParentSystemRenderedMention,
  type ParentSystemThreadMentionSource,
} from "./parent-system-messages.js";

export type ChildThreadNotificationSource = ParentSystemThreadMentionSource;

export interface ChildThreadTurnNotificationBatchItem {
  childThread: ChildThreadNotificationSource;
  turnStatus: ThreadEventTurnStatus;
}

interface ChildThreadTurnNotificationBatch {
  items: ChildThreadTurnNotificationBatchItem[];
  timer: ReturnType<typeof setTimeout>;
}

interface RenderChildThreadTurnStatusBatchMessageArgs {
  items: ChildThreadTurnNotificationBatchItem[];
}

interface ChildThreadTurnStatusBatchLine {
  item: ChildThreadTurnNotificationBatchItem;
  mention: ParentSystemRenderedMention;
}

interface RenderChildThreadTurnStatusBatchTextArgs {
  lines: ChildThreadTurnStatusBatchLine[];
}

interface FormatChildThreadTurnStatusLineArgs {
  line: ChildThreadTurnStatusBatchLine;
}

interface BuildChildThreadTurnStatusBatchInputArgs {
  items: ChildThreadTurnNotificationBatchItem[];
}

interface BuildChildThreadNeedsAttentionInputArgs {
  childThread: ChildThreadNotificationSource;
}

interface QueueChildThreadTurnNotificationArgs {
  childThread: ChildThreadNotificationSource;
  parentThreadId: string;
  turnStatus: ThreadEventTurnStatus;
}

interface QueueChildThreadNeedsAttentionNotificationArgs {
  childThread: ChildThreadNotificationSource;
  parentThreadId: string;
}

const CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS = 2_000;
const CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT =
  "__BB_CHILD_THREAD_OUTCOME_BATCH_UPDATES__";
const CHILD_THREAD_MENTION_SLOT = "__BB_CHILD_THREAD_MENTION__";
const CHILD_THREAD_INTERRUPTED_GUIDANCE =
  " Inspect this thread directly before taking action. If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.";
const childThreadTurnNotificationBatches = new Map<
  string,
  ChildThreadTurnNotificationBatch
>();

function formatChildThreadTurnStatusLabel(
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

function buildChildThreadTurnStatusBatchLines(
  args: RenderChildThreadTurnStatusBatchMessageArgs,
): ChildThreadTurnStatusBatchLine[] {
  return args.items.map((item) => ({
    item,
    mention: buildParentSystemThreadMention({
      thread: item.childThread,
    }),
  }));
}

function formatChildThreadTurnStatusLine(
  args: FormatChildThreadTurnStatusLineArgs,
): string {
  if (args.line.item.turnStatus === "interrupted") {
    return `${args.line.mention.serializedText} was interrupted.${CHILD_THREAD_INTERRUPTED_GUIDANCE}`;
  }
  return `${args.line.mention.serializedText} ${formatChildThreadTurnStatusLabel(args.line.item.turnStatus)}.`;
}

function renderChildThreadTurnStatusBatchText(
  args: RenderChildThreadTurnStatusBatchTextArgs,
): string {
  const updates =
    args.lines.length === 1 && args.lines[0]
      ? formatChildThreadTurnStatusLine({ line: args.lines[0] })
      : [
          "Multiple child threads updated:",
          ...args.lines.map(
            (line) => `- ${formatChildThreadTurnStatusLine({ line })}`,
          ),
        ].join("\n");
  return renderTemplate("systemMessageChildThreadOutcomeBatch", {
    updates,
  });
}

function buildChildThreadTurnStatusLineSegments(
  args: FormatChildThreadTurnStatusLineArgs,
): ParentSystemInputSegment[] {
  if (args.line.item.turnStatus === "interrupted") {
    return [
      { kind: "mention", mention: args.line.mention },
      {
        kind: "text",
        text: ` was interrupted.${CHILD_THREAD_INTERRUPTED_GUIDANCE}`,
      },
    ];
  }

  return [
    { kind: "mention", mention: args.line.mention },
    {
      kind: "text",
      text: ` ${formatChildThreadTurnStatusLabel(args.line.item.turnStatus)}.`,
    },
  ];
}

function buildChildThreadTurnStatusBatchSegments(
  args: RenderChildThreadTurnStatusBatchTextArgs,
): ParentSystemInputSegment[] {
  if (args.lines.length === 1 && args.lines[0]) {
    return buildChildThreadTurnStatusLineSegments({ line: args.lines[0] });
  }

  const segments: ParentSystemInputSegment[] = [];
  segments.push({ kind: "text", text: "Multiple child threads updated:" });
  for (const line of args.lines) {
    segments.push({ kind: "text", text: "\n- " });
    segments.push(...buildChildThreadTurnStatusLineSegments({ line }));
  }
  return segments;
}

export function renderChildThreadTurnStatusBatchMessage(
  args: RenderChildThreadTurnStatusBatchMessageArgs,
): string {
  return renderChildThreadTurnStatusBatchText({
    lines: buildChildThreadTurnStatusBatchLines(args),
  });
}

export function buildChildThreadTurnStatusBatchInput(
  args: BuildChildThreadTurnStatusBatchInputArgs,
): PromptInput[] {
  const lines = buildChildThreadTurnStatusBatchLines(args);
  const renderedText = renderTemplate("systemMessageChildThreadOutcomeBatch", {
    updates: CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
  });
  return buildParentSystemInputFromTemplateSlot({
    renderedText,
    slot: CHILD_THREAD_OUTCOME_BATCH_UPDATES_SLOT,
    segments: buildChildThreadTurnStatusBatchSegments({ lines }),
  });
}

export function buildChildThreadNeedsAttentionInput(
  args: BuildChildThreadNeedsAttentionInputArgs,
): PromptInput[] {
  const mention = buildParentSystemThreadMention({
    thread: args.childThread,
  });
  const renderedText = renderTemplate(
    "systemMessageChildThreadNeedsAttention",
    {
      threadMention: CHILD_THREAD_MENTION_SLOT,
    },
  );
  return buildParentSystemInputFromTemplateSlot({
    renderedText,
    slot: CHILD_THREAD_MENTION_SLOT,
    segments: [{ kind: "mention", mention }],
  });
}

function childThreadTurnNotificationLogMessage(
  turnStatus: ThreadEventTurnStatus,
): string {
  switch (turnStatus) {
    case "completed":
      return "Failed to queue parent completed-thread notification";
    case "failed":
      return "Failed to queue parent failed-thread notification";
    case "interrupted":
      return "Failed to queue parent interrupted-thread notification";
    default: {
      const exhaustiveCheck: never = turnStatus;
      return exhaustiveCheck;
    }
  }
}

async function flushChildThreadTurnNotificationBatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parentThreadId: string,
): Promise<void> {
  const batch = childThreadTurnNotificationBatches.get(parentThreadId);
  if (!batch) {
    return;
  }
  childThreadTurnNotificationBatches.delete(parentThreadId);

  try {
    await queueParentSystemMessage(deps, {
      input: buildChildThreadTurnStatusBatchInput({
        items: batch.items,
      }),
      parentThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        err: error,
        parentThreadId,
        childThreads: batch.items.map((item) => ({
          childThreadId: item.childThread.id,
          turnStatus: item.turnStatus,
        })),
      },
      "Failed to queue batched parent turn notifications",
    );
  }
}

function scheduleChildThreadTurnNotificationBatchFlush(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parentThreadId: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void flushChildThreadTurnNotificationBatch(deps, parentThreadId);
  }, CHILD_THREAD_TURN_NOTIFICATION_BATCH_DELAY_MS);
}

function queueChildThreadTurnNotificationBatchItem(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadTurnNotificationArgs,
): void {
  const existingBatch = childThreadTurnNotificationBatches.get(
    args.parentThreadId,
  );
  if (existingBatch) {
    existingBatch.items.push({
      childThread: args.childThread,
      turnStatus: args.turnStatus,
    });
    clearTimeout(existingBatch.timer);
    existingBatch.timer = scheduleChildThreadTurnNotificationBatchFlush(
      deps,
      args.parentThreadId,
    );
    return;
  }

  childThreadTurnNotificationBatches.set(args.parentThreadId, {
    items: [
      {
        childThread: args.childThread,
        turnStatus: args.turnStatus,
      },
    ],
    timer: scheduleChildThreadTurnNotificationBatchFlush(
      deps,
      args.parentThreadId,
    ),
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
    queueChildThreadTurnNotificationBatchItem(deps, args);
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThread.id,
        parentThreadId: args.parentThreadId,
        turnStatus: args.turnStatus,
        err: error,
      },
      childThreadTurnNotificationLogMessage(args.turnStatus),
    );
  }
}

export async function queueChildThreadNeedsAttentionNotificationBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueChildThreadNeedsAttentionNotificationArgs,
): Promise<void> {
  try {
    await queueParentSystemMessage(deps, {
      input: buildChildThreadNeedsAttentionInput({
        childThread: args.childThread,
      }),
      parentThreadId: args.parentThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThread.id,
        parentThreadId: args.parentThreadId,
        err: error,
      },
      "Failed to queue parent needs-attention notification",
    );
  }
}
