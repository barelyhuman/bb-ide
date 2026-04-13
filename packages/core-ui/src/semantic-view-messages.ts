import type {
  ViewDelegationMessage,
  ViewMessage,
  ViewProjection,
  ViewTasksMessage,
  ViewTimelineEntry,
  ViewToolCallMessage,
  ViewTurn,
  ViewTurnStatus,
} from "@bb/domain";
import { isDelegationToolName } from "./tool-call-parsing.js";

interface IndexedMessage {
  index: number;
  message: ViewMessage;
}

interface ProjectionMessageBounds {
  createdAt: number;
  sourceSeqEnd: number;
  sourceSeqStart: number;
  startedAt: number;
}

function getStartedAt(message: Pick<ViewMessage, "startedAt" | "createdAt">): number {
  return message.startedAt ?? message.createdAt;
}

function getSyntheticTurnStatus(messages: ViewMessage[]): ViewTurnStatus {
  if (messages.some((message) => message.kind === "error")) {
    return "error";
  }
  if (
    messages.some((message) =>
      "status" in message &&
      (message.status === "pending" || message.status === "streaming")
    )
  ) {
    return "pending";
  }
  return "completed";
}

function syntheticTurnFromMessages(
  turnId: string,
  messages: ViewMessage[],
): ViewTurn {
  const firstMessage = messages[0];
  if (!firstMessage) {
    throw new Error(`Cannot build synthetic projection turn ${turnId} without messages`);
  }
  const sourceSeqStart = Math.min(...messages.map((message) => message.sourceSeqStart));
  const sourceSeqEnd = Math.max(...messages.map((message) => message.sourceSeqEnd));
  const startedAt = Math.min(...messages.map((message) => getStartedAt(message)));
  const createdAt = Math.max(...messages.map((message) => message.createdAt));
  const status = getSyntheticTurnStatus(messages);
  return {
    turnId,
    threadId: firstMessage.threadId,
    sourceSeqStart,
    sourceSeqEnd,
    startedAt,
    createdAt,
    completedAt: status === "pending" ? null : createdAt,
    status,
    summaryCount: 0,
    messages,
  };
}

function projectionFromMessages(messages: ViewMessage[]): ViewProjection {
  const entries: ViewProjection["entries"] = [];
  const turnMessagesById = new Map<string, ViewMessage[]>();
  const emittedTurnIds = new Set<string>();

  for (const message of messages) {
    if (!message.turnId) {
      entries.push({ kind: "message", message });
      continue;
    }

    const turnMessages = turnMessagesById.get(message.turnId) ?? [];
    turnMessages.push(message);
    turnMessagesById.set(message.turnId, turnMessages);
    if (!emittedTurnIds.has(message.turnId)) {
      emittedTurnIds.add(message.turnId);
      entries.push({
        kind: "turn",
        turn: syntheticTurnFromMessages(message.turnId, turnMessages),
      });
    }
  }

  return {
    entries: entries.map((entry) => {
      if (entry.kind === "message") {
        return entry;
      }
      const messagesForTurn = turnMessagesById.get(entry.turn.turnId) ?? [];
      return {
        kind: "turn",
        turn: syntheticTurnFromMessages(entry.turn.turnId, messagesForTurn),
      };
    }),
  };
}

function mergeTaskMessages(
  previous: ViewTasksMessage,
  next: ViewTasksMessage,
): ViewTasksMessage {
  return {
    ...next,
    sourceSeqStart: Math.min(previous.sourceSeqStart, next.sourceSeqStart),
    sourceSeqEnd: Math.max(previous.sourceSeqEnd, next.sourceSeqEnd),
    startedAt: Math.min(getStartedAt(previous), getStartedAt(next)),
    createdAt: Math.max(previous.createdAt, next.createdAt),
  };
}

export function compactTaskMessages(messages: ViewMessage[]): ViewMessage[] {
  const compacted: ViewMessage[] = [];

  for (const message of messages) {
    const previous = compacted[compacted.length - 1];
    if (
      previous?.kind === "tasks" &&
      message.kind === "tasks" &&
      previous.source === message.source &&
      (previous.turnId ?? null) === (message.turnId ?? null) &&
      (previous.parentToolCallId ?? null) === (message.parentToolCallId ?? null)
    ) {
      compacted[compacted.length - 1] = mergeTaskMessages(previous, message);
      continue;
    }

    compacted.push(message);
  }

  return compacted;
}

export function sortViewMessagesBySource(messages: ViewMessage[]): ViewMessage[] {
  return messages
    .map((message, index) => ({ index, message }))
    .sort((left, right) => {
      if (left.message.sourceSeqStart !== right.message.sourceSeqStart) {
        return left.message.sourceSeqStart - right.message.sourceSeqStart;
      }
      if (left.message.createdAt !== right.message.createdAt) {
        return left.message.createdAt - right.message.createdAt;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function isDelegationCandidate(
  message: ViewMessage,
): message is ViewToolCallMessage {
  return (
    message.kind === "tool-call" &&
    isDelegationToolName(message.toolName)
  );
}

function toDelegationMessage(
  message: ViewToolCallMessage,
  childProjection: ViewProjection,
): ViewDelegationMessage {
  const childBounds = getProjectionMessageBounds(childProjection);
  return {
    kind: "delegation",
    id: message.id,
    threadId: message.threadId,
    sourceSeqStart: childBounds
      ? Math.min(message.sourceSeqStart, childBounds.sourceSeqStart)
      : message.sourceSeqStart,
    sourceSeqEnd: childBounds
      ? Math.max(message.sourceSeqEnd, childBounds.sourceSeqEnd)
      : message.sourceSeqEnd,
    createdAt: childBounds
      ? Math.max(message.createdAt, childBounds.createdAt)
      : message.createdAt,
    ...(childBounds
      ? { startedAt: Math.min(getStartedAt(message), childBounds.startedAt) }
      : message.startedAt !== undefined
        ? { startedAt: message.startedAt }
        : {}),
    ...(message.turnId ? { turnId: message.turnId } : {}),
    ...(message.parentToolCallId ? { parentToolCallId: message.parentToolCallId } : {}),
    toolName: message.toolName,
    callId: message.callId,
    command: message.command,
    subagentType: message.subagentType,
    description: message.description,
    output: message.output,
    duration: message.duration,
    durationMs: message.durationMs,
    status: message.status,
    childProjection,
  };
}

function getEntryMessages(entry: ViewTimelineEntry): readonly ViewMessage[] {
  if (entry.kind === "message") {
    return [entry.message];
  }
  if (entry.turn.messages) {
    return entry.turn.messages;
  }
  if (entry.turn.terminalMessage) {
    return [entry.turn.terminalMessage];
  }
  return [];
}

function collectProjectionMessages(projection: ViewProjection): IndexedMessage[] {
  const messages: IndexedMessage[] = [];
  let index = 0;
  for (const entry of projection.entries) {
    for (const message of getEntryMessages(entry)) {
      messages.push({ index, message });
      index += 1;
    }
  }
  return messages;
}

function getProjectionMessageBounds(
  projection: ViewProjection,
): ProjectionMessageBounds | null {
  let bounds: ProjectionMessageBounds | null = null;
  for (const entry of projection.entries) {
    for (const message of getEntryMessages(entry)) {
      const startedAt = getStartedAt(message);
      bounds = bounds
        ? {
            sourceSeqStart: Math.min(bounds.sourceSeqStart, message.sourceSeqStart),
            sourceSeqEnd: Math.max(bounds.sourceSeqEnd, message.sourceSeqEnd),
            startedAt: Math.min(bounds.startedAt, startedAt),
            createdAt: Math.max(bounds.createdAt, message.createdAt),
          }
        : {
            sourceSeqStart: message.sourceSeqStart,
            sourceSeqEnd: message.sourceSeqEnd,
            startedAt,
            createdAt: message.createdAt,
          };
    }
  }
  return bounds;
}

function collectDescendantMessageIds(
  callId: string,
  childIdsByParentCallId: Map<string, string[]>,
  messagesById: Map<string, ViewMessage>,
): Set<string> {
  const descendantIds = new Set<string>();
  const pendingIds = [...(childIdsByParentCallId.get(callId) ?? [])];

  while (pendingIds.length > 0) {
    const messageId = pendingIds.pop();
    if (!messageId || descendantIds.has(messageId)) {
      continue;
    }

    descendantIds.add(messageId);
    const message = messagesById.get(messageId);
    if (message && isDelegationCandidate(message)) {
      pendingIds.push(...(childIdsByParentCallId.get(message.callId) ?? []));
    }
  }

  return descendantIds;
}

function filterProjectionMessages(
  projection: ViewProjection,
  includedMessageIds: Set<string>,
  transformMessage: (message: ViewMessage) => ViewMessage,
): ViewProjection {
  const entries: ViewTimelineEntry[] = [];

  for (const entry of projection.entries) {
    if (entry.kind === "message") {
      if (includedMessageIds.has(entry.message.id)) {
        entries.push({
          kind: "message",
          message: transformMessage(entry.message),
        });
      }
      continue;
    }

    const messages = getEntryMessages(entry)
      .filter((message) => includedMessageIds.has(message.id))
      .map((message) => transformMessage(message));
    if (messages.length === 0) {
      continue;
    }

    entries.push({
      kind: "turn",
      turn: {
        ...entry.turn,
        messages,
      },
    });
  }

  return { entries };
}

export function normalizeSemanticViewProjection(
  projection: ViewProjection,
): ViewProjection {
  const indexedMessages = collectProjectionMessages(projection);
  const messagesById = new Map(
    indexedMessages.map((entry) => [entry.message.id, entry.message]),
  );
  const delegationCallIds = new Set(
    indexedMessages
      .map((entry) => entry.message)
      .filter(isDelegationCandidate)
      .map((message) => message.callId),
  );
  const childIdsByParentCallId = new Map<string, string[]>();
  const attachedIds = new Set<string>();

  for (const { message } of indexedMessages) {
    const parentToolCallId = message.parentToolCallId;
    if (!parentToolCallId || !delegationCallIds.has(parentToolCallId)) {
      continue;
    }

    const existing = childIdsByParentCallId.get(parentToolCallId) ?? [];
    existing.push(message.id);
    childIdsByParentCallId.set(parentToolCallId, existing);
    attachedIds.add(message.id);
  }

  const rootIds = new Set(
    indexedMessages
      .filter((entry) => !attachedIds.has(entry.message.id))
      .map((entry) => entry.message.id),
  );

  const toSemanticMessage = (message: ViewMessage): ViewMessage => {
    if (!isDelegationCandidate(message)) {
      return message;
    }

    const descendantIds = collectDescendantMessageIds(
      message.callId,
      childIdsByParentCallId,
      messagesById,
    );
    const childProjection = normalizeSemanticViewProjection(
      filterProjectionMessages(
        projection,
        descendantIds,
        (childMessage) => childMessage,
      ),
    );
    return toDelegationMessage(message, childProjection);
  };

  return filterProjectionMessages(projection, rootIds, toSemanticMessage);
}

function flattenTopLevelProjectionMessages(projection: ViewProjection): ViewMessage[] {
  const messages: ViewMessage[] = [];
  for (const entry of projection.entries) {
    if (entry.kind === "message") {
      messages.push(entry.message);
      continue;
    }
    messages.push(...getEntryMessages(entry));
  }
  return messages;
}

export function normalizeSemanticViewMessages(
  messages: ViewMessage[],
): ViewMessage[] {
  return flattenTopLevelProjectionMessages(
    normalizeSemanticViewProjection(
      projectionFromMessages(
        sortViewMessagesBySource(compactTaskMessages(messages)),
      ),
    ),
  );
}
