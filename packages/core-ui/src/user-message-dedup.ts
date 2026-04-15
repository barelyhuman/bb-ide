import type { ThreadEvent, ViewMessage } from "@bb/domain";
import {
  attachPendingClientRequestedMessagesToTurn,
  clearPendingClientRequestedSignatureCounts,
  consumePendingClientRequestedSignature,
  createPendingClientRequestedMessageQueue,
  hasPendingClientRequestedSignature,
  materializePendingClientRequestedMessages,
  recordPendingClientRequestedMessage,
  shiftPendingClientRequestedMessage,
  type PendingClientRequestedMessageMatch,
  type PendingClientRequestedMessageQueue,
} from "./pending-client-requested-messages.js";

export type ProjectedUserMessage = Extract<ViewMessage, { kind: "user" }>;

type ClientInputEventType =
  | "client/thread/start"
  | "client/turn/requested"
  | "client/turn/start";

export interface PendingUserSignatureCounts {
  clientStart: Map<string, number>;
  clientThreadStart: Map<string, number>;
  clientRequested: PendingClientRequestedMessageQueue;
  provider: Map<string, number>;
}

export interface ClientStartEventContext {
  eventType: ClientInputEventType;
  startSource?: string;
  isThreadStart: boolean;
  isTurnRequested: boolean;
  isTurnStart: boolean;
}

interface PendingUserSignatureCountsArgs {
  counts: PendingUserSignatureCounts;
}

interface ProjectedClientUserArgs extends PendingUserSignatureCountsArgs {
  signature: string;
  context: ClientStartEventContext;
  message?: ProjectedUserMessage;
  turnId?: string;
}

interface ProviderUserDeduplicationArgs extends PendingUserSignatureCountsArgs {
  signature: string;
}

interface PendingClientRequestedCountsArgs extends PendingUserSignatureCountsArgs {
  signature: string;
}

interface PendingClientRequestedTurnArgs extends PendingUserSignatureCountsArgs {
  threadId: string;
  turnId: string;
}

interface PendingClientRequestedMatchArgs extends PendingUserSignatureCountsArgs {
  signature: string;
  turnId?: string;
}

interface MaterializePendingUserMessagesArgs extends PendingUserSignatureCountsArgs {
  lastSourceSeq: number;
}

export function createPendingUserSignatureCounts(): PendingUserSignatureCounts {
  return {
    clientStart: new Map(),
    clientThreadStart: new Map(),
    clientRequested: createPendingClientRequestedMessageQueue(),
    provider: new Map(),
  };
}

function getPendingSignatureCount(
  map: Map<string, number>,
  signature: string,
): number {
  return map.get(signature) ?? 0;
}

function incrementPendingSignatureCount(
  map: Map<string, number>,
  signature: string,
): void {
  map.set(signature, getPendingSignatureCount(map, signature) + 1);
}

function decrementPendingSignatureCount(
  map: Map<string, number>,
  signature: string,
): boolean {
  const count = getPendingSignatureCount(map, signature);
  if (count <= 0) {
    return false;
  }
  if (count === 1) {
    map.delete(signature);
    return true;
  }
  map.set(signature, count - 1);
  return true;
}

export function clearPendingUserSignatureCounts(
  args: PendingUserSignatureCountsArgs,
): void {
  args.counts.clientStart.clear();
  args.counts.clientThreadStart.clear();
  clearPendingClientRequestedSignatureCounts(args.counts.clientRequested);
  args.counts.provider.clear();
}

export function attachPendingClientRequestedMessagesForTurn(
  args: PendingClientRequestedTurnArgs,
): void {
  attachPendingClientRequestedMessagesToTurn(
    args.counts.clientRequested,
    {
      threadId: args.threadId,
      turnId: args.turnId,
    },
  );
}

export function consumePendingClientRequestedCounts(
  args: PendingClientRequestedCountsArgs,
): void {
  decrementPendingSignatureCount(args.counts.clientStart, args.signature);
  decrementPendingSignatureCount(args.counts.clientThreadStart, args.signature);
  consumePendingClientRequestedSignature(
    args.counts.clientRequested,
    { signature: args.signature },
  );
}

export function getClientStartEventContext(
  eventType: ThreadEvent["type"],
  startSource: string | undefined,
): ClientStartEventContext | null {
  switch (eventType) {
    case "client/thread/start":
      return {
        eventType,
        startSource,
        isThreadStart: true,
        isTurnRequested: false,
        isTurnStart: false,
      };
    case "client/turn/requested":
      return {
        eventType,
        startSource,
        isThreadStart: false,
        isTurnRequested: true,
        isTurnStart: false,
      };
    case "client/turn/start":
      return {
        eventType,
        startSource,
        isThreadStart: false,
        isTurnRequested: false,
        isTurnStart: true,
      };
    default:
      return null;
  }
}

export function shouldSkipProjectedClientUser(
  args: ProjectedClientUserArgs,
): boolean {
  const pendingThreadStartCount = getPendingSignatureCount(
    args.counts.clientThreadStart,
    args.signature,
  );
  if (
    args.context.isTurnStart &&
    args.context.startSource === "spawn" &&
    pendingThreadStartCount > 0
  ) {
    return true;
  }

  if (
    args.context.isTurnStart &&
    hasPendingClientRequestedSignature(
      args.counts.clientRequested,
      { signature: args.signature },
    )
  ) {
    return true;
  }

  const pendingProviderCount = getPendingSignatureCount(
    args.counts.provider,
    args.signature,
  );
  if (args.context.isTurnStart && pendingProviderCount > 0) {
    decrementPendingSignatureCount(args.counts.provider, args.signature);
    return true;
  }

  return false;
}

export function recordProjectedClientUser(
  args: ProjectedClientUserArgs,
): void {
  incrementPendingSignatureCount(args.counts.clientStart, args.signature);
  if (args.context.isThreadStart) {
    incrementPendingSignatureCount(args.counts.clientThreadStart, args.signature);
  }
  if (args.context.isTurnRequested) {
    recordPendingClientRequestedMessage(
      args.counts.clientRequested,
      {
        message: args.message,
        signature: args.signature,
        turnId: args.turnId,
      },
    );
  }
}

export function consumePendingClientStartUser(
  args: ProviderUserDeduplicationArgs,
): boolean {
  const consumedClientStart = decrementPendingSignatureCount(
    args.counts.clientStart,
    args.signature,
  );
  if (!consumedClientStart) {
    return false;
  }

  decrementPendingSignatureCount(args.counts.clientThreadStart, args.signature);
  return true;
}

export function shiftPendingClientRequestedUser(
  args: PendingClientRequestedMatchArgs,
): PendingClientRequestedMessageMatch | undefined {
  return shiftPendingClientRequestedMessage(
    args.counts.clientRequested,
    {
      signature: args.signature,
      turnId: args.turnId,
    },
  );
}

export function recordProjectedProviderUser(
  args: ProviderUserDeduplicationArgs,
): void {
  incrementPendingSignatureCount(args.counts.provider, args.signature);
}

export function buildUserMessageKey(message: ProjectedUserMessage): string {
  const turnKey = message.turnId === undefined
    ? "turn:undefined"
    : `turn:${message.turnId}`;
  return `${turnKey}\u0000${message.id}\u0000${message.text}`;
}

export function materializePendingClientRequestedUserMessages(
  args: MaterializePendingUserMessagesArgs,
): ProjectedUserMessage[] {
  return materializePendingClientRequestedMessages(
    args.counts.clientRequested,
    args.lastSourceSeq,
  );
}
