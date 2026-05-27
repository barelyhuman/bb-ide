import {
  hostDaemonStatusDataChangeRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../services/lib/entity-lookup.js";
import { runWithDaemonCommandWaitForbidden } from "../services/hosts/command-wait-context.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

export function registerInternalStatusDataChangeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/status-data-change",
    hostDaemonStatusDataChangeRequestSchema,
    (context, payload) =>
      runWithDaemonCommandWaitForbidden({
        reason: "/session/status-data-change",
        work: async () => {
          const session = requireAuthenticatedDaemonSession({
            context,
            db: deps.db,
            sessionId: payload.sessionId,
          });
          const thread = requirePublicThread(deps.db, payload.threadId);
          if (!thread.environmentId) {
            throw new ApiError(
              403,
              "invalid_request",
              "Thread does not belong to an environment",
            );
          }
          const environment = requireEnvironment(deps.db, thread.environmentId);
          if (environment.hostId !== session.hostId) {
            throw new ApiError(
              403,
              "invalid_request",
              "Thread does not belong to the session host",
            );
          }

          deps.hub.notifyThreadStatusData({
            type: "status-data.changed",
            threadId: payload.threadId,
            key: payload.key,
            value: payload.value,
            deleted: payload.deleted,
            previousValue: payload.previousValue,
            previousValuePresent: payload.previousValuePresent,
            version: payload.version,
            writerClientId: null,
            operationId: null,
          });
          return context.json({ ok: true });
        },
      }),
  );
}
