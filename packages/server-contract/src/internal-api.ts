import type { Hono } from "hono";
import { hc } from "hono/client";
import type {
  EnvironmentDaemonCommand,
  EnvironmentDaemonSessionClientMessage,
  EnvironmentDaemonSessionCommandBatchMessage,
  EnvironmentDaemonSessionEventAckMessage,
  EnvironmentDaemonSessionOpenPayload,
  EnvironmentDaemonSessionToolCallResponseMessage,
  EnvironmentDaemonSessionWelcomeMessage,
} from "@bb/env-daemon-contract";
import type { Endpoint, PathId } from "./common.js";

type InternalSessionCommandsQuery = {
  sessionId: string;
  afterCursor?: string;
  limit?: string;
  waitMs?: string;
};

type InternalSessionMessageWithAck = Extract<
  EnvironmentDaemonSessionClientMessage,
  { type: "event_batch" }
>;

type InternalSessionMessageWithToolCallResponse = Extract<
  EnvironmentDaemonSessionClientMessage,
  { type: "tool_call_request" }
>;

type InternalSessionMessageWithoutBody =
  Exclude<
    EnvironmentDaemonSessionClientMessage,
    InternalSessionMessageWithAck | InternalSessionMessageWithToolCallResponse
  >;

/**
 * Internal API: server-implemented endpoints called by the env-daemon over HTTP.
 *
 * The daemon uses a polling loop:
 * 1. Open a session.
 * 2. Long-poll for commands.
 * 3. Push events, tool-call requests, and command results back to the server.
 */
export type InternalApiSchema = {
  /** Opens a new daemon session and returns lease and cursor bootstrap data. */
  "/environments/:id/env-daemon/session/open": {
    $post: Endpoint<
      PathId & { json: EnvironmentDaemonSessionOpenPayload },
      EnvironmentDaemonSessionWelcomeMessage,
      201
    >;
  };
  /** Long-polls for queued daemon commands for the active session. */
  "/environments/:id/env-daemon/session/commands": {
    $get:
      | Endpoint<
          PathId & { query: InternalSessionCommandsQuery },
          EnvironmentDaemonSessionCommandBatchMessage<EnvironmentDaemonCommand>,
          200
        >
      | Endpoint<PathId & { query: InternalSessionCommandsQuery }, undefined, 204>;
  };
  /** Accepts daemon-originated events, tool-call requests, and command results. */
  "/environments/:id/env-daemon/session/messages": {
    $post:
      | Endpoint<
          PathId & { json: InternalSessionMessageWithAck },
          EnvironmentDaemonSessionEventAckMessage,
          200
        >
      | Endpoint<
          PathId & { json: InternalSessionMessageWithToolCallResponse },
          EnvironmentDaemonSessionToolCallResponseMessage,
          200
        >
      | Endpoint<PathId & { json: InternalSessionMessageWithoutBody }, undefined, 204>;
  };
};

export type InternalApiRoutes = Hono<{}, InternalApiSchema, "/">;

export function createInternalApiClient(baseUrl: string, authToken: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const internalBaseUrl = normalizedBaseUrl.endsWith("/internal")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/internal`;

  return hc<InternalApiRoutes>(internalBaseUrl, {
    headers: { authorization: `Bearer ${authToken}` },
  });
}
