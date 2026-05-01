import type { ActiveThinking } from "@bb/domain";
import type { ThreadEvent } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";
import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionMessage,
  EventProjectionTurnStatus,
} from "./event-projection-types.js";
import {
  flushBufferedAssistantMessages,
  type AssistantStreamProjectionState,
} from "./assistant-stream-projection.js";
import {
  finalizeOperationMessage,
  interruptOperationMessage,
} from "./parse-operation-message.js";
import {
  flushActiveToolCell,
  flushPendingToolActivityOutput,
  interruptPendingToolActivity,
} from "./tool-activity-projection.js";
import { createToolActivityState } from "./tool-activity-projection.js";
import {
  flushPendingFileEditOutput,
  type CompactionTurnFinalizationStatus,
  type OperationProjectionState,
} from "./operation-projection.js";
import {
  createVisibleTextBuffer,
  getVisibleTextBufferText,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";
import { shouldPreservePendingMessages } from "./user-message-parsing.js";
import {
  createBufferedTextInstanceKey,
  type BufferedTextInstanceIdentity,
} from "./buffered-text-identity.js";

export interface CompactionTurnFinalization {
  status: CompactionTurnFinalizationStatus;
  detail: string | undefined;
}

type TurnPendingFinalizationStatus = Extract<
  EventProjectionTurnStatus,
  "interrupted"
>;
type TurnCompletedStatus = Extract<
  ThreadEvent,
  { type: "turn/completed" }
>["status"];

interface ActiveThinkingLifecycle {
  itemId: string;
  messageKey: string;
  startedAt: number;
  threadId: string;
  turnId: string;
  updatedAt: number;
  updatedSeq: number;
}

interface UpsertReasoningLifecycleArgs {
  identity: BufferedTextInstanceIdentity | null;
  meta: EventMeta;
  state: ProjectionState;
  threadId: string;
}

interface CompleteTurnArgs {
  state: ProjectionState;
  status: TurnCompletedStatus;
  turnId: string;
}

interface FinalizeProjectionMessagesArgs {
  options: BuildEventProjectionMessagesOptions | undefined;
  state: ProjectionState;
}

export interface ProjectionState
  extends AssistantStreamProjectionState, OperationProjectionState {
  seenUserKeys: Set<string>;
  openTurnIds: Set<string>;
  closedTurnIds: Set<string>;
  pendingFinalizationByTurnId: Map<string, TurnPendingFinalizationStatus>;
  openReasoningLifecyclesByKey: Map<string, ActiveThinkingLifecycle>;
  reasoningTextBuffersByKey: Map<string, VisibleTextBuffer>;
  finalizedReasoningKeys: Set<string>;
  delegationParentToolCallIdsByProviderThreadId: Map<string, string>;
}

export function createProjectionState(): ProjectionState {
  return {
    messages: [],
    seenUserKeys: new Set(),
    openTurnIds: new Set(),
    closedTurnIds: new Set(),
    pendingFinalizationByTurnId: new Map(),
    openAssistantMessagesByKey: new Map(),
    assistantTextBuffersByKey: new Map(),
    visibleAssistantMessageKeys: new Set(),
    finalizedAssistantMessageKeys: new Set(),
    openReasoningLifecyclesByKey: new Map(),
    reasoningTextBuffersByKey: new Map(),
    finalizedReasoningKeys: new Set(),
    openCompactionsByKey: new Map(),
    finalizedCompactionKeys: new Set(),
    provisioningOperationsByKey: new Map(),
    permissionGrantsByInteractionId: new Map(),
    threadOperationsById: new Map(),
    fileEditsByCallId: new Map(),
    fileEditStdoutBuffersByCallId: new Map(),
    delegationParentToolCallIdsByProviderThreadId: new Map(),
    toolActivity: createToolActivityState(),
  };
}

function isNewerActiveThinkingLifecycle(
  candidate: ActiveThinkingLifecycle,
  current: ActiveThinkingLifecycle,
): boolean {
  if (candidate.updatedSeq !== current.updatedSeq) {
    return candidate.updatedSeq > current.updatedSeq;
  }
  return candidate.updatedAt > current.updatedAt;
}

function findLatestActiveThinkingLifecycle(
  openLifecycles: ReadonlyMap<string, ActiveThinkingLifecycle>,
): ActiveThinkingLifecycle | null {
  let latestLifecycle: ActiveThinkingLifecycle | null = null;
  for (const lifecycle of openLifecycles.values()) {
    if (
      latestLifecycle === null ||
      isNewerActiveThinkingLifecycle(lifecycle, latestLifecycle)
    ) {
      latestLifecycle = lifecycle;
    }
  }
  return latestLifecycle;
}

function getActiveThinkingText(
  state: ProjectionState,
  messageKey: string,
): string {
  const buffer = state.reasoningTextBuffersByKey.get(messageKey);
  return (buffer ? getVisibleTextBufferText(buffer) : undefined) ?? "";
}

export function buildProjectionActiveThinking(
  state: ProjectionState,
  threadStatus: BuildEventProjectionMessagesOptions["threadStatus"],
): ActiveThinking | null {
  if (threadStatus !== "active") {
    return null;
  }

  const latestLifecycle = findLatestActiveThinkingLifecycle(
    state.openReasoningLifecyclesByKey,
  );
  if (!latestLifecycle) {
    return null;
  }

  return {
    id: latestLifecycle.itemId,
    text: getActiveThinkingText(state, latestLifecycle.messageKey),
    startedAt: latestLifecycle.startedAt,
    updatedAt: latestLifecycle.updatedAt,
  };
}

export function upsertReasoningLifecycle(
  args: UpsertReasoningLifecycleArgs,
): void {
  if (!args.identity) {
    return;
  }

  const messageKey = createBufferedTextInstanceKey(args.identity);
  if (args.state.closedTurnIds.has(args.identity.turnId)) {
    return;
  }
  if (args.state.finalizedReasoningKeys.has(messageKey)) {
    return;
  }

  args.state.openTurnIds.add(args.identity.turnId);

  const existingLifecycle =
    args.state.openReasoningLifecyclesByKey.get(messageKey);
  if (existingLifecycle) {
    existingLifecycle.updatedAt = args.meta.createdAt;
    existingLifecycle.updatedSeq = args.meta.seq;
    return;
  }

  args.state.openReasoningLifecyclesByKey.set(messageKey, {
    itemId: args.identity.itemId,
    messageKey,
    startedAt: args.meta.createdAt,
    threadId: args.threadId,
    turnId: args.identity.turnId,
    updatedAt: args.meta.createdAt,
    updatedSeq: args.meta.seq,
  });
}

export function trackReasoningTurn(
  state: ProjectionState,
  identity: BufferedTextInstanceIdentity | null,
): void {
  if (!identity || state.closedTurnIds.has(identity.turnId)) {
    return;
  }
  state.openTurnIds.add(identity.turnId);
}

export function finalizeReasoningLifecycle(
  state: ProjectionState,
  identity: BufferedTextInstanceIdentity | null,
): void {
  if (!identity) {
    return;
  }

  const messageKey = createBufferedTextInstanceKey(identity);
  state.openReasoningLifecyclesByKey.delete(messageKey);
  state.finalizedReasoningKeys.add(messageKey);
}

function closeOpenTurns(state: ProjectionState): void {
  for (const turnId of state.openTurnIds) {
    state.closedTurnIds.add(turnId);
  }
  state.openTurnIds.clear();
}

function finalizeOpenReasoningLifecycles(state: ProjectionState): void {
  for (const messageKey of state.openReasoningLifecyclesByKey.keys()) {
    state.finalizedReasoningKeys.add(messageKey);
  }
  state.openReasoningLifecyclesByKey.clear();
}

export function onTurnStarted(state: ProjectionState, turnId: string): void {
  state.openTurnIds.add(turnId);
}

export function onTurnCompleted(args: CompleteTurnArgs): void {
  args.state.closedTurnIds.add(args.turnId);
  args.state.openTurnIds.delete(args.turnId);
  if (args.status === "interrupted") {
    args.state.pendingFinalizationByTurnId.set(args.turnId, "interrupted");
  }
  finalizeOpenReasoningLifecycles(args.state);
}

export function onThreadInterrupted(state: ProjectionState): void {
  closeOpenTurns(state);
  finalizeOpenReasoningLifecycles(state);
}

export function flushProjectionBufferedOutputs(state: ProjectionState): void {
  flushBufferedAssistantMessages(state);
  flushPendingToolActivityOutput(state);
  flushPendingFileEditOutput(state);
}

function finalizePendingMessages(args: FinalizeProjectionMessagesArgs): void {
  const shouldPreservePending = shouldPreservePendingMessages(
    args.options?.threadStatus,
  );
  const shouldFinalizeBufferedAssistants =
    args.options?.threadStatus !== undefined && !shouldPreservePending;
  if (shouldPreservePending) {
    flushActiveToolCell(args.state);
    return;
  }

  flushPendingToolActivityOutput(args.state);
  flushPendingFileEditOutput(args.state);
  interruptPendingToolActivity(args.state);

  for (const fileEdits of args.state.fileEditsByCallId.values()) {
    for (const fileEdit of fileEdits) {
      if (fileEdit.status === "pending") {
        fileEdit.status = "interrupted";
      }
    }
  }

  if (shouldFinalizeBufferedAssistants) {
    flushBufferedAssistantMessages(args.state);
  }

  for (const message of args.state.messages) {
    if (message.kind !== "operation") continue;
    finalizeOperationMessage(message, args.options);
  }

  flushActiveToolCell(args.state);
}

function isMessageScopedToFinalizedTurn(
  message: EventProjectionMessage,
  pendingFinalizationByTurnId: ReadonlyMap<
    string,
    TurnPendingFinalizationStatus
  >,
): boolean {
  return (
    message.scope.kind === "turn" &&
    pendingFinalizationByTurnId.has(message.scope.turnId)
  );
}

function finalizePendingMessageForInterruptedTurn(
  message: EventProjectionMessage,
): void {
  switch (message.kind) {
    case "command":
    case "tool-call":
    case "web-search":
    case "web-fetch":
      return;
    case "file-edit":
      if (message.status === "pending") {
        message.status = "interrupted";
      }
      return;
    case "operation":
      interruptOperationMessage(message);
      return;
    case "permission-grant-lifecycle":
      if (message.status === "pending") {
        message.status = "interrupted";
        message.title = "Permission grant interrupted";
      }
      return;
    case "assistant-text":
    case "debug/raw-event":
    case "delegation":
    case "error":
    case "user":
      return;
  }
}

function finalizeInterruptedTurnPendingMessages(state: ProjectionState): void {
  if (state.pendingFinalizationByTurnId.size === 0) {
    return;
  }

  interruptPendingToolActivity(state, {
    turnIds: new Set(state.pendingFinalizationByTurnId.keys()),
  });

  for (const message of state.messages) {
    if (
      !isMessageScopedToFinalizedTurn(
        message,
        state.pendingFinalizationByTurnId,
      )
    ) {
      continue;
    }
    finalizePendingMessageForInterruptedTurn(message);
  }
}

export function finalizeProjectionState(
  args: FinalizeProjectionMessagesArgs,
): void {
  finalizePendingMessages(args);
  finalizeInterruptedTurnPendingMessages(args.state);
}

export function getReasoningTextBuffer(
  state: ProjectionState,
  messageKey: string,
): VisibleTextBuffer {
  const buffer =
    state.reasoningTextBuffersByKey.get(messageKey) ??
    createVisibleTextBuffer();
  state.reasoningTextBuffersByKey.set(messageKey, buffer);
  return buffer;
}
