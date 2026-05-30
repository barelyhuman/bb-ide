import {
  hostDaemonEnvironmentChangeRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireEnvironment } from "../services/lib/entity-lookup.js";
import { runWithDaemonCommandWaitForbidden } from "../services/hosts/command-wait-context.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

export function registerInternalEnvironmentChangeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/environment-change",
    hostDaemonEnvironmentChangeRequestSchema,
    (context, payload) =>
      runWithDaemonCommandWaitForbidden({
        reason: "/session/environment-change",
        work: async () => {
          const session = requireAuthenticatedDaemonSession({
            context,
            db: deps.db,
            sessionId: payload.sessionId,
          });
          const environment = requireEnvironment(
            deps.db,
            payload.environmentId,
          );
          if (environment.hostId !== session.hostId) {
            throw new ApiError(
              403,
              "invalid_request",
              "Environment does not belong to the session host",
            );
          }
          if (environment.status === "destroyed") {
            throw new ApiError(
              410,
              "environment_destroyed",
              "Environment has been destroyed",
              { retryable: false },
            );
          }

          deps.hub.notifyEnvironment(environment.id, [payload.change]);
          return context.json({ ok: true });
        },
      }),
  );
}
