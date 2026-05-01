import type {
  EventProjectionFileEditChange,
  EventProjectionFileEditMessage,
  EventProjectionMessage,
  EventProjectionOperationMessage,
  EventProjectionPermissionGrantLifecycleMessage,
} from "./event-projection-types.js";
import type { CompactionLifecycleEvent } from "./compaction-lifecycle.js";
import type { EventMeta } from "./event-decode.js";
import type { FileEditPartial } from "./file-edit-parsing.js";
import { messageId } from "./format-helpers.js";
import {
  mergeProvisioningMetadata,
  provisioningKey,
  provisioningTitleForStatus,
} from "./provisioning-helpers.js";
import {
  applyApprovalStatusDelta,
  buildApprovalStatusDelta,
} from "./tool-activity-projection.js";
import {
  haveCompatibleEventProjectionMessageScope,
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";
import {
  appendVisibleTextBuffer,
  createVisibleTextBuffer,
  flushVisibleTextBuffer,
  getVisibleTextBufferText,
  setVisibleTextBuffer,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";

export interface OperationProjectionState {
  messages: EventProjectionMessage[];
  fileEditsByCallId: Map<string, EventProjectionFileEditMessage[]>;
  fileEditStdoutBuffersByCallId: Map<string, VisibleTextBuffer>;
  openCompactionsByKey: Map<string, EventProjectionOperationMessage>;
  finalizedCompactionKeys: Set<string>;
  provisioningOperationsByKey: Map<string, EventProjectionOperationMessage>;
  permissionGrantsByInteractionId: Map<
    string,
    EventProjectionPermissionGrantLifecycleMessage
  >;
  threadOperationsById: Map<string, EventProjectionOperationMessage>;
}

export type CompactionTurnFinalizationStatus = Extract<
  EventProjectionOperationMessage["status"],
  "error" | "interrupted"
>;

interface FinalizeOpenCompactionsForTurnArgs {
  state: OperationProjectionState;
  meta: EventMeta;
  threadId: string;
  turnId: string | undefined;
  status: CompactionTurnFinalizationStatus;
  detail: string | undefined;
}

type LifecycleStatus = Extract<
  EventProjectionOperationMessage["status"],
  "pending" | "completed" | "error" | "interrupted"
>;

type LifecycleEventProjectionMessage =
  | EventProjectionOperationMessage
  | EventProjectionPermissionGrantLifecycleMessage;
type EventProjectionMessageScopeFields = ReturnType<
  | typeof eventProjectionMessageThreadScopeFields
  | typeof eventProjectionMessageTurnScopeFields
>;

interface OperationDetailMergeArgs {
  existing: string | undefined;
  incoming: string | undefined;
}

interface UpsertKeyedLifecycleMessageArgs<
  TMessage extends LifecycleEventProjectionMessage,
> {
  index: Map<string, TMessage>;
  incoming: TMessage;
  key: string | null | undefined;
  mergeExisting: (existing: TMessage, incoming: TMessage) => void;
  state: OperationProjectionState;
}

function isTerminalLifecycleStatus(status: LifecycleStatus): boolean {
  return status !== "pending";
}

function mergeLifecycleStatus(
  existing: LifecycleStatus,
  incoming: LifecycleStatus,
): LifecycleStatus {
  if (isTerminalLifecycleStatus(existing)) {
    return existing;
  }
  return incoming;
}

function mergeOperationDetail(
  args: OperationDetailMergeArgs,
): string | undefined {
  const details = [args.existing, args.incoming].filter(
    (value): value is string => Boolean(value),
  );
  if (details.length === 0) {
    return undefined;
  }
  return [...new Set(details)].join("\n");
}

function upsertKeyedLifecycleMessage<
  TMessage extends LifecycleEventProjectionMessage,
>(args: UpsertKeyedLifecycleMessageArgs<TMessage>): void {
  if (!args.key) {
    args.state.messages.push(args.incoming);
    return;
  }

  const scopedKey = lifecycleMessageKey(args.key, args.incoming);
  const existing = args.index.get(scopedKey);
  if (!existing) {
    args.index.set(scopedKey, args.incoming);
    args.state.messages.push(args.incoming);
    return;
  }

  updateMessageBounds(existing, args.incoming);
  args.mergeExisting(existing, args.incoming);
}

function lifecycleMessageKey(
  key: string,
  message: LifecycleEventProjectionMessage,
): string {
  if (message.scope.kind === "thread") {
    return `thread:${key}`;
  }
  return `turn:${message.scope.turnId}:${key}`;
}

function mergeProvisioningOperation(
  existing: EventProjectionOperationMessage,
  incoming: EventProjectionOperationMessage,
): void {
  existing.status = mergeLifecycleStatus(
    existing.status ?? "pending",
    incoming.status ?? "pending",
  );
  existing.title = provisioningTitleForStatus(existing.status);
  existing.provisioning = mergeProvisioningMetadata(
    existing.provisioning,
    incoming.provisioning,
  );
  existing.detail = mergeOperationDetail({
    existing: existing.detail,
    incoming: incoming.detail,
  });
}

export function upsertProvisioningOperation(
  state: OperationProjectionState,
  incoming: EventProjectionOperationMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.provisioningOperationsByKey,
    incoming,
    key: provisioningKey(incoming),
    mergeExisting: mergeProvisioningOperation,
    state,
  });
}

function updateMessageBounds(
  existing: LifecycleEventProjectionMessage,
  incoming: LifecycleEventProjectionMessage,
): void {
  if (!haveCompatibleEventProjectionMessageScope(existing, incoming)) {
    throw new Error(
      `Cannot merge ${existing.kind} messages with different scopes`,
    );
  }
  existing.sourceSeqStart = Math.min(
    existing.sourceSeqStart,
    incoming.sourceSeqStart,
  );
  existing.sourceSeqEnd = Math.max(
    existing.sourceSeqEnd,
    incoming.sourceSeqEnd,
  );
  existing.createdAt = Math.max(existing.createdAt, incoming.createdAt);
  existing.startedAt = Math.min(
    existing.startedAt ?? existing.createdAt,
    incoming.startedAt ?? incoming.createdAt,
  );
}

export function upsertThreadOperationMessage(
  state: OperationProjectionState,
  incoming: EventProjectionOperationMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.threadOperationsById,
    incoming,
    key: incoming.threadOperation?.operationId,
    mergeExisting: mergeThreadOperationMessage,
    state,
  });
}

function mergeThreadOperationMessage(
  existing: EventProjectionOperationMessage,
  incoming: EventProjectionOperationMessage,
): void {
  const mergedStatus = mergeLifecycleStatus(
    existing.status ?? "pending",
    incoming.status ?? "pending",
  );
  const shouldUseIncomingLifecycle = existing.status !== mergedStatus;
  existing.status = mergedStatus;
  if (shouldUseIncomingLifecycle) {
    existing.title = incoming.title;
    existing.threadOperation = incoming.threadOperation;
  }
  existing.detail = mergeOperationDetail({
    existing: existing.detail,
    incoming: incoming.detail,
  });
}

export function upsertPermissionGrantLifecycleMessage(
  state: OperationProjectionState,
  incoming: EventProjectionPermissionGrantLifecycleMessage,
): void {
  upsertKeyedLifecycleMessage({
    index: state.permissionGrantsByInteractionId,
    incoming,
    key: incoming.interactionId,
    mergeExisting: mergePermissionGrantLifecycleMessage,
    state,
  });
}

function mergePermissionGrantLifecycleMessage(
  existing: EventProjectionPermissionGrantLifecycleMessage,
  incoming: EventProjectionPermissionGrantLifecycleMessage,
): void {
  const mergedStatus = mergeLifecycleStatus(existing.status, incoming.status);
  const shouldUseIncomingLifecycle = existing.status !== mergedStatus;
  existing.status = mergedStatus;
  if (shouldUseIncomingLifecycle) {
    existing.title = incoming.title;
  }
  existing.approvalTarget = incoming.approvalTarget;
}

function mergeFileChange(
  existing: EventProjectionFileEditChange | undefined,
  incoming: EventProjectionFileEditChange,
): EventProjectionFileEditChange {
  if (!existing) {
    return { ...incoming };
  }

  return {
    path: incoming.path,
    kind: incoming.kind ?? existing.kind,
    movePath: incoming.movePath ?? existing.movePath,
    diff: incoming.diff ?? existing.diff,
  };
}

function isTerminalFileEditStatus(
  status: EventProjectionFileEditMessage["status"] | undefined,
): boolean {
  return status !== undefined && status !== "pending";
}

export function flushPendingFileEditOutput(
  state: OperationProjectionState,
): void {
  for (const [callId, fileEdits] of state.fileEditsByCallId.entries()) {
    const buffer = state.fileEditStdoutBuffersByCallId.get(callId);
    if (!buffer || !flushVisibleTextBuffer(buffer)) {
      continue;
    }
    for (const fileEdit of fileEdits) {
      fileEdit.stdout = getVisibleTextBufferText(buffer);
    }
  }
}

interface CreateFileEditMessageArgs {
  callId: string;
  change: EventProjectionFileEditChange | null;
  changeIndex: number;
  meta: EventMeta;
  partial: FileEditPartial;
  scopeFields: EventProjectionMessageScopeFields;
  stdout: string | undefined;
  threadId: string;
}

function createFileEditMessage({
  callId,
  change,
  changeIndex,
  meta,
  partial,
  scopeFields,
  stdout,
  threadId,
}: CreateFileEditMessageArgs): EventProjectionFileEditMessage {
  return {
    kind: "file-edit",
    id: messageId(threadId, "file-edit", `${callId}:${changeIndex}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...scopeFields,
    ...(partial.parentToolCallId
      ? { parentToolCallId: partial.parentToolCallId }
      : {}),
    callId,
    changes: change ? [{ ...change }] : [],
    stdout,
    stderr: partial.stderr,
    approvalStatus: partial.approvalStatus ?? null,
    status: partial.status ?? "pending",
  };
}

function updateFileEditMessage(
  existing: EventProjectionFileEditMessage,
  meta: EventMeta,
  partial: FileEditPartial,
  scopeFields: EventProjectionMessageScopeFields,
  change: EventProjectionFileEditChange | null,
  stdout: string | undefined,
): void {
  if (!haveCompatibleEventProjectionMessageScope(existing, scopeFields)) {
    throw new Error(
      `Cannot merge file-edit messages with different scopes for call ${partial.callId}`,
    );
  }
  existing.sourceSeqEnd = meta.seq;
  existing.createdAt = meta.createdAt;

  if (!existing.parentToolCallId && partial.parentToolCallId) {
    existing.parentToolCallId = partial.parentToolCallId;
  }

  if (change) {
    existing.changes = [mergeFileChange(existing.changes[0], change)];
  }

  existing.stdout = stdout;

  if (partial.stderr) {
    existing.stderr = partial.stderr;
  }

  existing.approvalStatus = applyApprovalStatusDelta(
    existing.approvalStatus,
    buildApprovalStatusDelta(partial.approvalStatus, partial.status),
  );

  if (partial.status) {
    if (partial.status === "error") {
      existing.status = "error";
    } else if (
      existing.status === "pending" ||
      existing.status === "interrupted"
    ) {
      existing.status = partial.status;
    } else if (existing.status !== "error" && partial.status === "completed") {
      existing.status = "completed";
    }
  }
}

export function upsertFileEdit(
  state: OperationProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  partial: FileEditPartial,
): void {
  const scopeFields = turnId
    ? eventProjectionMessageTurnScopeFields(turnId)
    : eventProjectionMessageThreadScopeFields();
  const existingRows = state.fileEditsByCallId.get(partial.callId) ?? [];
  const stdoutBuffer =
    state.fileEditStdoutBuffersByCallId.get(partial.callId) ??
    createVisibleTextBuffer();
  state.fileEditStdoutBuffersByCallId.set(partial.callId, stdoutBuffer);

  if (partial.stdout) {
    if (partial.appendStdout) {
      appendVisibleTextBuffer(stdoutBuffer, partial.stdout);
    } else {
      setVisibleTextBuffer(
        stdoutBuffer,
        partial.stdout,
        isTerminalFileEditStatus(partial.status),
      );
    }
  } else if (isTerminalFileEditStatus(partial.status)) {
    flushVisibleTextBuffer(stdoutBuffer);
  }

  const stdout = getVisibleTextBufferText(stdoutBuffer);
  const changes =
    partial.changes && partial.changes.length > 0
      ? partial.changes
      : existingRows.length > 0
        ? existingRows.map(() => null)
        : [null];

  for (const [changeIndex, change] of changes.entries()) {
    const existing = existingRows[changeIndex];
    if (existing) {
      updateFileEditMessage(
        existing,
        meta,
        partial,
        scopeFields,
        change,
        stdout,
      );
      continue;
    }

    const message = createFileEditMessage({
      callId: partial.callId,
      change,
      changeIndex,
      meta,
      partial,
      scopeFields,
      stdout,
      threadId,
    });
    existingRows.push(message);
    state.messages.push(message);
  }

  state.fileEditsByCallId.set(partial.callId, existingRows);
}

export function onCompactionBegin(
  state: OperationProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.status = "pending";
    existing.title = "Context compacting...";
    existing.detail = payload.detail ?? existing.detail;
    return;
  }

  const message: EventProjectionOperationMessage = {
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields()),
    opType: "compaction",
    title: "Context compacting...",
    detail: payload.detail,
    status: "pending",
  };
  state.openCompactionsByKey.set(payload.key, message);
  state.messages.push(message);
}

export function onCompactionEnd(
  state: OperationProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.status = "completed";
    existing.title = "Context compacted";
    existing.detail = payload.detail ?? existing.detail;
    state.openCompactionsByKey.delete(payload.key);
    state.finalizedCompactionKeys.add(payload.key);
    return;
  }

  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  state.messages.push({
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields()),
    opType: "compaction",
    title: "Context compacted",
    detail: payload.detail,
    status: "completed",
  });
  state.finalizedCompactionKeys.add(payload.key);
}

/**
 * Turn-end finalization is provisional: keep the compaction open so a later
 * explicit compaction completion can override the inferred error/interruption.
 */
export function finalizeOpenCompactionsForTurn(
  args: FinalizeOpenCompactionsForTurnArgs,
): void {
  if (!args.turnId) return;

  for (const message of args.state.openCompactionsByKey.values()) {
    if (
      message.threadId !== args.threadId ||
      message.scope.kind !== "turn" ||
      message.scope.turnId !== args.turnId
    ) {
      continue;
    }

    message.sourceSeqEnd = Math.max(message.sourceSeqEnd, args.meta.seq);
    message.createdAt = Math.max(message.createdAt, args.meta.createdAt);
    message.status = args.status;
    message.title =
      args.status === "error"
        ? "Context compaction failed"
        : "Context compaction interrupted";
    message.detail = args.detail ?? message.detail;
  }
}
