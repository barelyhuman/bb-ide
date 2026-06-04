import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import {
  buildClientTurnRequestSettlementById,
  type ClientTurnRequestSettlement,
  type ClientTurnRequestSettlementContext,
  type ThreadEventWithMetaLike,
} from "../src/accepted-client-request-context.js";

interface InputAcceptedEventArgs {
  clientRequestId: string;
  createdAt: number;
  eventId: string;
  sequence: number;
  turnId: string;
}

interface ClientTurnRequestSettlementArgs {
  message?: string | null;
  reasonCode?: ClientTurnRequestSettlement["reasonCode"];
  requestId: string;
  settledAt?: number | null;
  status: ClientTurnRequestSettlement["status"];
  turnId?: string | null;
}

function inputAcceptedEvent({
  clientRequestId,
  createdAt,
  eventId,
  sequence,
  turnId,
}: InputAcceptedEventArgs): ThreadEventWithMetaLike {
  return {
    event: {
      type: "turn/input/accepted",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope(turnId),
      clientRequestId,
    },
    meta: {
      createdAt,
      id: eventId,
      seq: sequence,
    },
  };
}

function clientTurnRequestSettlement({
  message = null,
  reasonCode = null,
  requestId,
  settledAt = null,
  status,
  turnId = null,
}: ClientTurnRequestSettlementArgs): ClientTurnRequestSettlement {
  return {
    message,
    reasonCode,
    requestId,
    settledAt,
    status,
    turnId,
  };
}

describe("client turn request settlement context", () => {
  it("combines lifecycle rows with accepted input events", () => {
    const context: ClientTurnRequestSettlementContext = {
      acceptedClientRequestEvents: [],
      clientTurnRequestSettlements: [
        clientTurnRequestSettlement({
          requestId: "creq_1234567890",
          status: "pending",
        }),
        clientTurnRequestSettlement({
          message: "Provider rejected input",
          reasonCode: "command_failed",
          requestId: "creq_1234567891",
          settledAt: 200,
          status: "failed",
        }),
      ],
    };

    const settlements = buildClientTurnRequestSettlementById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 100,
          eventId: "event-1",
          sequence: 1,
          turnId: "turn-1",
        }),
      ],
    });

    expect(settlements.get("creq_1234567890")).toMatchObject({
      reasonCode: "accepted",
      status: "accepted",
      turnId: "turn-1",
    });
    expect(settlements.get("creq_1234567891")).toMatchObject({
      message: "Provider rejected input",
      reasonCode: "command_failed",
      status: "failed",
    });
  });

  it("keeps the first accepted event for duplicate accepted inputs", () => {
    const context: ClientTurnRequestSettlementContext = {
      acceptedClientRequestEvents: [],
      clientTurnRequestSettlements: [],
    };

    const settlements = buildClientTurnRequestSettlementById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 100,
          eventId: "event-1",
          sequence: 1,
          turnId: "turn-1",
        }),
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 200,
          eventId: "event-2",
          sequence: 2,
          turnId: "turn-2",
        }),
      ],
    });

    expect(settlements.get("creq_1234567890")).toMatchObject({
      reasonCode: "accepted",
      settledAt: 100,
      status: "accepted",
      turnId: "turn-1",
    });
  });

  it("preserves failed lifecycle rows when a later accepted event appears", () => {
    const context: ClientTurnRequestSettlementContext = {
      acceptedClientRequestEvents: [],
      clientTurnRequestSettlements: [
        clientTurnRequestSettlement({
          message: "Command expired before provider accepted input",
          reasonCode: "command_expired",
          requestId: "creq_1234567890",
          settledAt: 100,
          status: "expired",
        }),
      ],
    };

    const settlements = buildClientTurnRequestSettlementById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 200,
          eventId: "event-2",
          sequence: 2,
          turnId: "turn-2",
        }),
      ],
    });

    expect(settlements.get("creq_1234567890")).toMatchObject({
      message: "Command expired before provider accepted input",
      reasonCode: "command_expired",
      settledAt: 100,
      status: "expired",
      turnId: null,
    });
  });

  it("dedupes current-window and context accepted events with current-window precedence", () => {
    const context: ClientTurnRequestSettlementContext = {
      acceptedClientRequestEvents: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 200,
          eventId: "event-2",
          sequence: 2,
          turnId: "turn-2",
        }),
      ],
      clientTurnRequestSettlements: [],
    };

    const settlements = buildClientTurnRequestSettlementById({
      context,
      events: [
        inputAcceptedEvent({
          clientRequestId: "creq_1234567890",
          createdAt: 100,
          eventId: "event-1",
          sequence: 1,
          turnId: "turn-1",
        }),
      ],
    });

    expect(settlements.size).toBe(1);
    expect(settlements.get("creq_1234567890")).toMatchObject({
      reasonCode: "accepted",
      settledAt: 100,
      status: "accepted",
      turnId: "turn-1",
    });
  });
});
