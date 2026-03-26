import { Hono } from "hono";
import { getThread, listThreads } from "@bb/db";
import type { ThreadType } from "@bb/domain";
import { createThreadRequestSchema } from "@bb/server-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { createThreadWithEnvironment } from "./thread-create.js";
import { registerThreadActions } from "./threads/actions.js";
import { registerThreadData } from "./threads/data.js";
import { registerThreadDrafts } from "./threads/drafts.js";

export function createThreadRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/", (c) => {
    const query = c.req.query();
    const threads = listThreads(deps.db, {
      projectId: query.projectId,
      type: query.type as ThreadType | undefined,
      parentThreadId: query.parentThreadId,
      archived: query.archived === "true" ? true : query.archived === "false" ? false : undefined,
    });
    return c.json(threads);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createThreadRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);
    const thread = await createThreadWithEnvironment(deps, parsed.data);
    return c.json(thread, 201);
  });

  app.get("/:id", (c) => {
    const thread = getThread(deps.db, c.req.param("id"));
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
    return c.json(thread);
  });

  registerThreadActions(app, deps);
  registerThreadData(app, deps);
  registerThreadDrafts(app, deps);

  return app;
}
