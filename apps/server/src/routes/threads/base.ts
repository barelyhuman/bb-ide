import {
  deleteThread,
  listThreads,
  updateThread,
} from "@bb/db";
import {
  createThreadRequestSchema,
  threadListQuerySchema,
  updateThreadRequestSchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { maybeCleanupEnvironment } from "../../services/environment-cleanup.js";
import {
  requireEnvironment,
  requireThread,
  requireThreadEnvironment,
} from "../../services/entity-lookup.js";
import { queueCommandAndWait } from "../../services/command-wait.js";
import { queueThreadRenameCommand } from "../../services/thread-commands.js";
import { createThreadFromRequest } from "../../services/thread-create.js";
export function registerThreadBaseRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads", threadListQuerySchema, (context, query) => {
    return context.json(
      listThreads(deps.db, {
        projectId: query.projectId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.parentThreadId ? { parentThreadId: query.parentThreadId } : {}),
        archived: query.archived === undefined ? undefined : query.archived === "true",
      }),
    );
  });

  post("/threads", createThreadRequestSchema, async (context, payload) =>
    context.json(await createThreadFromRequest(deps, payload), 201),
  );

  get("/threads/:id", (context) =>
    context.json(requireThread(deps.db, context.req.param("id"))),
  );

  patch("/threads/:id", updateThreadRequestSchema, async (context, payload) => {
    const thread = requireThread(deps.db, context.req.param("id"));
    const updated = updateThread(deps.db, deps.hub, thread.id, payload);
    if (!updated) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }

    if (
      payload.title &&
      payload.title !== thread.title &&
      updated.environmentId
    ) {
      const environment = requireEnvironment(deps.db, updated.environmentId);
      if (environment.status === "ready" && environment.path) {
        queueThreadRenameCommand(deps, {
          environment: {
            id: environment.id,
            hostId: environment.hostId,
          },
          threadId: updated.id,
          title: payload.title,
        });
      }
    }

    return context.json(updated);
  });

  del("/threads/:id", async (context) => {
    const { environment, thread } = requireThreadEnvironment(deps.db, context.req.param("id"));
    if (thread.status === "active") {
      await queueCommandAndWait(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "thread.stop",
          environmentId: environment.id,
          threadId: thread.id,
        },
      });
    }
    deleteThread(deps.db, deps.hub, thread.id);
    await maybeCleanupEnvironment(deps, thread.environmentId);
    return context.json({ ok: true });
  });
}
