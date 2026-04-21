import type {
  ViewAssistantReasoningMessage,
  ViewAssistantTextMessage,
  ViewMessage,
} from "@bb/domain";
import {
  flushToolActivityBeforeNonToolMessage,
  type ToolActivityProjectionState,
} from "./tool-activity-projection.js";
import {
  flushVisibleTextBuffer,
  getVisibleTextBufferText,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";

export interface AssistantStreamProjectionState extends ToolActivityProjectionState {
  messages: ViewMessage[];
  openAssistantByTurn: Map<string, ViewAssistantTextMessage>;
  assistantTextBuffersByTurn: Map<string, VisibleTextBuffer>;
  visibleAssistantTurnKeys: Set<string>;
  finalizedAssistantTurnKeys: Set<string>;
  openReasoningByTurn: Map<string, ViewAssistantReasoningMessage>;
  reasoningTextBuffersByTurn: Map<string, VisibleTextBuffer>;
  visibleReasoningTurnKeys: Set<string>;
  finalizedReasoningTurnKeys: Set<string>;
}

type BufferedAssistantMessage =
  | ViewAssistantTextMessage
  | ViewAssistantReasoningMessage;

interface SyncBufferedTextMessageArgs<
  TMessage extends BufferedAssistantMessage,
> {
  buffer: VisibleTextBuffer;
  message: TMessage;
  state: AssistantStreamProjectionState;
  status: TMessage["status"];
  turnKey: string;
  visibleKeys: Set<string>;
}

interface FlushBufferedTextMessagesArgs<
  TMessage extends BufferedAssistantMessage,
> {
  buffers: Map<string, VisibleTextBuffer>;
  finalizedKeys: Set<string>;
  openMessages: Map<string, TMessage>;
  state: AssistantStreamProjectionState;
  visibleKeys: Set<string>;
}

export function hasFinalizedProjectionKey(
  finalizedKeys: Set<string>,
  primaryKey: string,
  fallbackKey: string | undefined,
): boolean {
  return (
    finalizedKeys.has(primaryKey) ||
    (fallbackKey !== undefined && finalizedKeys.has(fallbackKey))
  );
}

export function resolveOpenProjectionKey<TMessage>(
  openMessages: Map<string, TMessage>,
  primaryKey: string,
  fallbackKey: string | undefined,
): string {
  if (
    fallbackKey !== undefined &&
    openMessages.has(fallbackKey) &&
    !openMessages.has(primaryKey)
  ) {
    return fallbackKey;
  }
  return primaryKey;
}

export function finalizeProjectionKeys(
  finalizedKeys: Set<string>,
  keys: Array<string | undefined>,
): void {
  for (const key of keys) {
    if (!key) continue;
    finalizedKeys.add(key);
  }
}

export function syncBufferedTextMessage<
  TMessage extends BufferedAssistantMessage,
>(args: SyncBufferedTextMessageArgs<TMessage>): void {
  const text = getVisibleTextBufferText(args.buffer);
  if (!text) {
    if (args.status === "completed") {
      args.message.status = "completed";
    }
    return;
  }

  args.message.text = text;
  args.message.status = args.status;
  if (args.visibleKeys.has(args.turnKey)) {
    return;
  }

  flushToolActivityBeforeNonToolMessage(args.state);
  args.state.messages.push(args.message);
  args.visibleKeys.add(args.turnKey);
}

function flushBufferedTextMessages<
  TMessage extends BufferedAssistantMessage,
>(args: FlushBufferedTextMessagesArgs<TMessage>): void {
  const pendingMessages = Array.from(args.openMessages.entries()).sort(
    (left, right) =>
      left[1].sourceSeqStart - right[1].sourceSeqStart ||
      left[1].sourceSeqEnd - right[1].sourceSeqEnd ||
      left[1].createdAt - right[1].createdAt,
  );

  for (const [turnKey, message] of pendingMessages) {
    const buffer = args.buffers.get(turnKey);
    if (buffer) {
      flushVisibleTextBuffer(buffer);
      syncBufferedTextMessage({
        buffer,
        message,
        state: args.state,
        status: "completed",
        turnKey,
        visibleKeys: args.visibleKeys,
      });
    } else {
      message.status = "completed";
    }
    args.finalizedKeys.add(turnKey);
  }

  args.openMessages.clear();
  args.buffers.clear();
  args.visibleKeys.clear();
}

export function flushBufferedAssistantMessages(
  state: AssistantStreamProjectionState,
): void {
  flushBufferedTextMessages({
    buffers: state.assistantTextBuffersByTurn,
    finalizedKeys: state.finalizedAssistantTurnKeys,
    openMessages: state.openAssistantByTurn,
    state,
    visibleKeys: state.visibleAssistantTurnKeys,
  });
}

export function flushBufferedReasoningMessages(
  state: AssistantStreamProjectionState,
): void {
  flushBufferedTextMessages({
    buffers: state.reasoningTextBuffersByTurn,
    finalizedKeys: state.finalizedReasoningTurnKeys,
    openMessages: state.openReasoningByTurn,
    state,
    visibleKeys: state.visibleReasoningTurnKeys,
  });
}

export function completeOpenReasoningMessages(
  state: AssistantStreamProjectionState,
): void {
  for (const reasoning of state.openReasoningByTurn.values()) {
    if (reasoning.status === "streaming") {
      reasoning.status = "completed";
    }
  }
  state.openReasoningByTurn.clear();
  state.reasoningTextBuffersByTurn.clear();
  state.visibleReasoningTurnKeys.clear();
}
