import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { spawnThreadSchema, tellThreadSchema } from "@beanbag/core";
import { z } from "zod";
import type { ThreadManager } from "../thread-manager.js";
import type { TaskRepository } from "@beanbag/db";
import type { WSManager } from "../ws.js";
import { threadNotFoundError } from "../domain-errors.js";
import { sendRouteError } from "./error-response.js";

const listThreadsQuerySchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  taskRole: z.enum(["primary", "worker"]).optional(),
  parentThreadId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const eventsQuerySchema = z.object({
  afterSeq: z.string().optional(),
});

export function createThreadRoutes(
  threadManager: ThreadManager,
  taskRepo?: Pick<TaskRepository, "getById">,
  wsManager?: Pick<WSManager, "broadcast">,
) {
  return new Hono()
    .post("/", zValidator("json", spawnThreadSchema), async (c) => {
      try {
        const body = c.req.valid("json");
        if (taskRepo && body.taskId) {
          const task = taskRepo.getById(body.taskId);
          if (!task) {
            return c.json({ error: "Task not found" }, 404);
          }
          if (task.projectId !== body.projectId) {
            return c.json(
              { error: "Task must belong to the same project as the thread" },
              400,
            );
          }
        }

        const thread = await threadManager.spawn(body);
        if (body.taskId) {
          wsManager?.broadcast("task", body.taskId);
        }
        return c.json(thread, 201);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/", zValidator("query", listThreadsQuerySchema), async (c) => {
      try {
        const filters = c.req.valid("query");
        const includeArchived =
          filters.includeArchived === "true"
            ? true
            : filters.includeArchived === "false"
              ? false
              : undefined;
        const threads = threadManager.list({
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.taskId ? { taskId: filters.taskId } : {}),
          ...(filters.taskRole ? { taskRole: filters.taskRole } : {}),
          ...(filters.parentThreadId
            ? { parentThreadId: filters.parentThreadId }
            : {}),
          ...(includeArchived !== undefined ? { includeArchived } : {}),
        });
        return c.json(threads);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/:id", async (c) => {
      try {
        const thread = threadManager.getById(c.req.param("id"));
        if (!thread) {
          return sendRouteError(c, threadNotFoundError(c.req.param("id")));
        }
        return c.json(thread);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/:id/default-execution-options", async (c) => {
      try {
        const thread = threadManager.getById(c.req.param("id"));
        if (!thread) {
          return sendRouteError(c, threadNotFoundError(c.req.param("id")));
        }
        const options = threadManager.getDefaultExecutionOptions(
          c.req.param("id"),
        );
        return c.json(options ?? null);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .post(
      "/:id/tell",
      zValidator("json", tellThreadSchema),
      async (c) => {
        try {
          const { input, model, reasoningLevel, sandboxMode, mode } = c.req.valid("json");
          const thread = threadManager.getById(c.req.param("id"));
          if (!thread) {
            return sendRouteError(c, threadNotFoundError(c.req.param("id")));
          }
          const tellRequest = mode ? { input, mode } : { input };
          const options =
            model || reasoningLevel || sandboxMode
              ? { model, reasoningLevel, sandboxMode }
              : undefined;
          if (options) {
            await threadManager.tell(c.req.param("id"), tellRequest, options);
          } else {
            await threadManager.tell(c.req.param("id"), tellRequest);
          }
          return c.json({ ok: true });
        } catch (err) {
          return sendRouteError(c, err);
        }
      },
    )
    .post("/:id/stop", async (c) => {
      try {
        const thread = threadManager.getById(c.req.param("id"));
        if (!thread) {
          return sendRouteError(c, threadNotFoundError(c.req.param("id")));
        }
        threadManager.stop(c.req.param("id"));
        return c.json({ ok: true });
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .post("/:id/archive", async (c) => {
      try {
        const thread = threadManager.getById(c.req.param("id"));
        if (!thread) {
          return sendRouteError(c, threadNotFoundError(c.req.param("id")));
        }
        threadManager.archive(c.req.param("id"));
        return c.json({ ok: true });
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get(
      "/:id/events",
      zValidator("query", eventsQuerySchema),
      async (c) => {
        try {
          const thread = threadManager.getById(c.req.param("id"));
          if (!thread) {
            return sendRouteError(c, threadNotFoundError(c.req.param("id")));
          }

          const { afterSeq } = c.req.valid("query");
          const afterSeqNum = afterSeq ? parseInt(afterSeq, 10) : undefined;

          const events = threadManager.getEvents(
            c.req.param("id"),
            afterSeqNum,
          );
          return c.json(events);
        } catch (err) {
          return sendRouteError(c, err);
        }
      },
    )
    .get("/:id/output", async (c) => {
      try {
        const thread = threadManager.getById(c.req.param("id"));
        if (!thread) {
          return sendRouteError(c, threadNotFoundError(c.req.param("id")));
        }
        const output = threadManager.getOutput(c.req.param("id"));
        return c.json({ output: output ?? null });
      } catch (err) {
        return sendRouteError(c, err);
      }
    });
}
