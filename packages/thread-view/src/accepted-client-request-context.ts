import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
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

export const EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT: AcceptedClientRequestContext =
  {
    acceptedClientRequestEvents: [],
  };

interface AddAcceptedClientRequestsArgs {
  acceptedById: Map<ClientTurnRequestId, AcceptedClientRequest>;
  events: readonly ThreadEventWithMetaLike[];
}

interface BuildAcceptedClientRequestByIdArgs {
  context: AcceptedClientRequestContext;
  events: readonly ThreadEventWithMetaLike[];
}

function addAcceptedClientRequests({
  acceptedById,
  events,
}: AddAcceptedClientRequestsArgs): void {
  for (const { event, meta } of events) {
    if (event.type !== "turn/input/accepted") {
      continue;
    }
    if (acceptedById.has(event.clientRequestId)) {
      continue;
    }
    acceptedById.set(event.clientRequestId, {
      meta,
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
  addAcceptedClientRequests({
    acceptedById,
    events,
  });
  addAcceptedClientRequests({
    acceptedById,
    events: context.acceptedClientRequestEvents,
  });
  return acceptedById;
}
