import type {
  ClientTurnRequestId,
  ClientTurnRequestStatus,
  ClientTurnRequestTerminalReason,
  ThreadEvent,
} from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";
import type { EventMeta } from "./event-decode.js";

export interface ThreadEventWithMetaLike {
  event: ThreadEvent;
  meta: EventMeta;
}

export interface AcceptedClientRequest {
  meta: EventMeta;
  turnId: string;
}

export interface AcceptedClientRequestContext {
  acceptedClientRequestEvents: readonly ThreadEventWithMetaLike[];
}

export interface ClientTurnRequestSettlement {
  message: string | null;
  reasonCode: ClientTurnRequestTerminalReason | null;
  requestId: ClientTurnRequestId;
  settledAt: number | null;
  status: ClientTurnRequestStatus;
  turnId: string | null;
}

export interface ClientTurnRequestSettlementContext extends AcceptedClientRequestContext {
  clientTurnRequestSettlements: readonly ClientTurnRequestSettlement[];
}

export const EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT: AcceptedClientRequestContext =
  {
    acceptedClientRequestEvents: [],
  };

export const EMPTY_CLIENT_TURN_REQUEST_SETTLEMENT_CONTEXT: ClientTurnRequestSettlementContext =
  {
    acceptedClientRequestEvents: [],
    clientTurnRequestSettlements: [],
  };

interface AcceptedClientRequestEvent {
  meta: EventMeta;
  requestId: ClientTurnRequestId;
  turnId: string;
}

interface AddAcceptedClientRequestEventsArgs {
  events: readonly ThreadEventWithMetaLike[];
  onAccepted: (accepted: AcceptedClientRequestEvent) => void;
}

interface BuildAcceptedClientRequestByIdArgs {
  context: AcceptedClientRequestContext;
  events: readonly ThreadEventWithMetaLike[];
}

interface BuildClientTurnRequestSettlementByIdArgs {
  context: ClientTurnRequestSettlementContext;
  events: readonly ThreadEventWithMetaLike[];
}

function settlementFromAcceptedEvent(
  accepted: AcceptedClientRequestEvent,
): ClientTurnRequestSettlement {
  return {
    message: null,
    reasonCode: "accepted",
    requestId: accepted.requestId,
    settledAt: accepted.meta.createdAt,
    status: "accepted",
    turnId: accepted.turnId,
  };
}

function addAcceptedClientRequestEvents({
  events,
  onAccepted,
}: AddAcceptedClientRequestEventsArgs): void {
  for (const { event, meta } of events) {
    if (event.type !== "turn/input/accepted") {
      continue;
    }
    onAccepted({
      meta,
      requestId: event.clientRequestId,
      turnId: requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      }),
    });
  }
}

export function buildAcceptedClientRequestById({
  context,
  events,
}: BuildAcceptedClientRequestByIdArgs): Map<
  ClientTurnRequestId,
  AcceptedClientRequest
> {
  const acceptedById = new Map<ClientTurnRequestId, AcceptedClientRequest>();
  const addAccepted = (accepted: AcceptedClientRequestEvent): void => {
    if (acceptedById.has(accepted.requestId)) {
      return;
    }
    acceptedById.set(accepted.requestId, {
      meta: accepted.meta,
      turnId: accepted.turnId,
    });
  };
  addAcceptedClientRequestEvents({
    events,
    onAccepted: addAccepted,
  });
  addAcceptedClientRequestEvents({
    events: context.acceptedClientRequestEvents,
    onAccepted: addAccepted,
  });
  return acceptedById;
}

export function buildClientTurnRequestSettlementById({
  context,
  events,
}: BuildClientTurnRequestSettlementByIdArgs): Map<
  ClientTurnRequestId,
  ClientTurnRequestSettlement
> {
  const settlementById = new Map<
    ClientTurnRequestId,
    ClientTurnRequestSettlement
  >();
  for (const settlement of context.clientTurnRequestSettlements) {
    settlementById.set(settlement.requestId, settlement);
  }
  const addAcceptedSettlement = (
    accepted: AcceptedClientRequestEvent,
  ): void => {
    const existing = settlementById.get(accepted.requestId);
    if (existing && existing.status !== "pending") {
      return;
    }
    settlementById.set(
      accepted.requestId,
      settlementFromAcceptedEvent(accepted),
    );
  };
  addAcceptedClientRequestEvents({
    events,
    onAccepted: addAcceptedSettlement,
  });
  addAcceptedClientRequestEvents({
    events: context.acceptedClientRequestEvents,
    onAccepted: addAcceptedSettlement,
  });
  return settlementById;
}
