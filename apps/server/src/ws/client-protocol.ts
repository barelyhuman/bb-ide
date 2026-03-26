import type { WSEvents } from "hono/ws";
import type { ClientMessage } from "@bb/server-contract";
import type { Logger } from "@bb/logger";
import type { NotificationHub } from "./hub.js";

export interface ClientProtocolDeps {
  hub: NotificationHub;
  logger: Logger;
}

export function createClientWsHandler(deps: ClientProtocolDeps): WSEvents {
  const { hub, logger } = deps;

  return {
    onOpen(_event, ws) {
      hub.addClient(ws);
    },

    onMessage(event, ws) {
      try {
        const data =
          typeof event.data === "string" ? event.data : String(event.data);
        const message = JSON.parse(data) as ClientMessage;

        switch (message.type) {
          case "subscribe":
            hub.subscribe(ws, message.entity, message.id);
            break;
          case "unsubscribe":
            hub.unsubscribe(ws, message.entity, message.id);
            break;
          default: {
            const _exhaustive: never = message;
            logger.warn({ type: (_exhaustive as ClientMessage).type }, "unknown client message type");
          }
        }
      } catch (err) {
        logger.warn({ err }, "failed to parse client WS message");
      }
    },

    onClose(_event, ws) {
      hub.removeClient(ws);
    },

    onError(event, ws) {
      logger.warn({ err: event }, "client WS error");
      hub.removeClient(ws);
    },
  };
}
