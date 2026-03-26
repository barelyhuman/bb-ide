import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  requireThreadEnvironment,
} from "../services/entity-lookup.js";
import {
  getLastExecutionOptions,
  getLastProviderThreadId,
} from "../services/thread-events.js";
import { resolveThreadRuntimeConfig } from "../services/thread-runtime-config.js";
import type { AppDeps } from "../types.js";
import { requireActiveSession } from "./session-state.js";

export function registerInternalThreadRuntimeRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  app.get("/threads/:id/runtime", (context) => {
    const session = requireActiveSession(deps.db, context.req.query("sessionId") ?? "");
    const { environment, thread } = requireThreadEnvironment(
      deps.db,
      context.req.param("id"),
    );

    if (environment.hostId !== session.hostId) {
      throw new ApiError(
        403,
        "invalid_request",
        "Thread does not belong to the active session host",
      );
    }
    if (environment.status !== "ready" || !environment.path) {
      throw new ApiError(
        409,
        "invalid_request",
        "Environment is not ready",
      );
    }

    const providerThreadId = getLastProviderThreadId(deps, thread.id);
    const executionOptions = getLastExecutionOptions(deps, thread.id);
    const runtimeConfig = resolveThreadRuntimeConfig(deps, {
      environment: {
        path: environment.path,
      },
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        type: thread.type,
      },
    });
    const options =
      executionOptions || runtimeConfig.instructions
        ? {
            ...(executionOptions ?? {}),
            ...(runtimeConfig.instructions
              ? { instructions: runtimeConfig.instructions }
              : {}),
          }
        : undefined;

    return context.json({
      workspacePath: environment.path,
      projectId: thread.projectId,
      providerId: thread.providerId,
      ...(providerThreadId ? { providerThreadId } : {}),
      ...(options ? { options } : {}),
      ...(runtimeConfig.dynamicTools
        ? { dynamicTools: runtimeConfig.dynamicTools }
        : {}),
    });
  });
}
