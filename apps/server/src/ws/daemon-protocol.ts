import type { WSEvents } from "hono/ws";
import type { Logger } from "@bb/logger";
import type { DbConnection } from "@bb/db";
import { closeSession, heartbeatSession, getActiveSession } from "@bb/db";
import type {
  HostDaemonDaemonWsMessage,
} from "@bb/host-daemon-contract";
import type { NotificationHub } from "./hub.js";

export interface DaemonProtocolDeps {
  hub: NotificationHub;
  db: DbConnection;
  logger: Logger;
  secretToken: string;
}

interface DaemonWsState {
  sessionId: string | null;
  hostId: string | null;
}

export function createDaemonWsHandler(deps: DaemonProtocolDeps): WSEvents {
  const { hub, db, logger } = deps;
  const state: DaemonWsState = { sessionId: null, hostId: null };

  return {
    onOpen(_event, ws) {
      // Auth and session binding happen on first message
      // The daemon sends sessionId+token as query params on WS upgrade
      // For now, we extract from the upgrade URL in the route handler
      // and pass through the WS context
    },

    onMessage(event, ws) {
      try {
        const data =
          typeof event.data === "string" ? event.data : String(event.data);
        const message = JSON.parse(data) as HostDaemonDaemonWsMessage;

        if (message.type === "heartbeat") {
          if (!state.sessionId) {
            logger.warn("heartbeat received before session binding");
            return;
          }
          const session = getActiveSession(db, state.hostId!);
          if (!session || session.id !== state.sessionId) {
            ws.send(
              JSON.stringify({
                type: "session-close",
                reason: "expired",
              }),
            );
            ws.close(1000, "session expired");
            return;
          }
          const leaseExpiresAt = Date.now() + session.leaseTimeoutMs;
          heartbeatSession(db, state.sessionId, leaseExpiresAt);
        }
      } catch (err) {
        logger.warn({ err }, "failed to parse daemon WS message");
      }
    },

    onClose(_event, _ws) {
      if (state.sessionId) {
        closeSession(db, hub, state.sessionId, "daemon-disconnect");
        hub.removeDaemon(state.sessionId);
        state.sessionId = null;
        state.hostId = null;
      }
    },

    onError(event, _ws) {
      logger.warn({ err: event }, "daemon WS error");
      if (state.sessionId) {
        closeSession(db, hub, state.sessionId, "daemon-disconnect");
        hub.removeDaemon(state.sessionId);
        state.sessionId = null;
        state.hostId = null;
      }
    },
  };
}

export function bindDaemonSession(
  state: DaemonWsState,
  sessionId: string,
  hostId: string,
) {
  state.sessionId = sessionId;
  state.hostId = hostId;
}

export interface DaemonWsHandlerWithState {
  handler: WSEvents;
  bindSession: (sessionId: string, hostId: string) => void;
}

export function createDaemonWsHandlerWithState(
  deps: DaemonProtocolDeps,
): DaemonWsHandlerWithState {
  const { hub, db, logger } = deps;
  const state: DaemonWsState = { sessionId: null, hostId: null };

  const handler: WSEvents = {
    onOpen(_event, _ws) {},

    onMessage(event, ws) {
      try {
        const data =
          typeof event.data === "string" ? event.data : String(event.data);
        const message = JSON.parse(data) as HostDaemonDaemonWsMessage;

        if (message.type === "heartbeat") {
          if (!state.sessionId) {
            logger.warn("heartbeat received before session binding");
            return;
          }
          const session = getActiveSession(db, state.hostId!);
          if (!session || session.id !== state.sessionId) {
            ws.send(
              JSON.stringify({ type: "session-close", reason: "expired" }),
            );
            ws.close(1000, "session expired");
            return;
          }
          const leaseExpiresAt = Date.now() + session.leaseTimeoutMs;
          heartbeatSession(db, state.sessionId, leaseExpiresAt);
        }
      } catch (err) {
        logger.warn({ err }, "failed to parse daemon WS message");
      }
    },

    onClose(_event, _ws) {
      if (state.sessionId) {
        closeSession(db, hub, state.sessionId, "daemon-disconnect");
        hub.removeDaemon(state.sessionId);
        state.sessionId = null;
        state.hostId = null;
      }
    },

    onError(event, _ws) {
      logger.warn({ err: event }, "daemon WS error");
      if (state.sessionId) {
        closeSession(db, hub, state.sessionId, "daemon-disconnect");
        hub.removeDaemon(state.sessionId);
        state.sessionId = null;
        state.hostId = null;
      }
    },
  };

  return {
    handler,
    bindSession(sessionId: string, hostId: string) {
      state.sessionId = sessionId;
      state.hostId = hostId;
    },
  };
}
