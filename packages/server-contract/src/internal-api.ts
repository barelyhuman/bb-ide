import type { Hono } from "hono";
import { hc } from "hono/client";
import type { EmptyInput, Endpoint, PathId } from "./common.js";
import type { EnvironmentDaemonCommand } from "./environment-daemon-commands.js";
import type {
  EnvironmentDaemonSessionClientMessage,
  EnvironmentDaemonSessionCommandBatchMessage,
  EnvironmentDaemonSessionEventAckMessage,
  EnvironmentDaemonSessionOpenPayload,
  EnvironmentDaemonSessionProviderResponseMessage,
  EnvironmentDaemonSessionWelcomeMessage,
} from "./session-protocol.js";

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

type InternalSessionMessageWithProviderResponse = Extract<
  EnvironmentDaemonSessionClientMessage,
  { type: "provider_request" }
>;

type InternalSessionMessageWithoutBody =
  Exclude<
    EnvironmentDaemonSessionClientMessage,
    InternalSessionMessageWithAck | InternalSessionMessageWithProviderResponse
  >;

export type InternalApiSchema = {
  "/environments/:id/env-daemon/session/open": {
    $post: Endpoint<
      PathId & { json: EnvironmentDaemonSessionOpenPayload },
      EnvironmentDaemonSessionWelcomeMessage,
      201
    >;
  };
  "/environments/:id/env-daemon/session/commands": {
    $get:
      | Endpoint<
          PathId & { query: InternalSessionCommandsQuery },
          EnvironmentDaemonSessionCommandBatchMessage<EnvironmentDaemonCommand>,
          200
        >
      | Endpoint<PathId & { query: InternalSessionCommandsQuery }, undefined, 204>;
  };
  "/environments/:id/env-daemon/session/messages": {
    $post:
      | Endpoint<
          PathId & { json: InternalSessionMessageWithAck },
          EnvironmentDaemonSessionEventAckMessage,
          200
        >
      | Endpoint<
          PathId & { json: InternalSessionMessageWithProviderResponse },
          EnvironmentDaemonSessionProviderResponseMessage,
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
