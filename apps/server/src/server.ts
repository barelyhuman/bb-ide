import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServerDeps } from "./deps.js";
import { ApiError } from "./errors.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createThreadRoutes } from "./routes/threads.js";
import { createEnvironmentRoutes } from "./routes/environments.js";
import { createHostRoutes } from "./routes/hosts.js";
import { createSystemRoutes } from "./routes/system.js";
import { createSessionRoutes } from "./internal/session.js";
import { createCommandRoutes } from "./internal/commands.js";
import { createEventRoutes } from "./internal/events.js";
import { createToolCallRoutes } from "./internal/tool-calls.js";

function createAuthMiddleware(secretToken: string) {
  return async (c: { req: { header(name: string): string | undefined }; json: (body: unknown, status: number) => Response }, next: () => Promise<void>) => {
    const auth = c.req.header("authorization");
    const expected = `Bearer ${secretToken}`;
    if (!auth || auth !== expected) {
      return c.json({ code: "inactive_session", message: "Invalid or missing auth token" }, 401);
    }
    await next();
  };
}

export function createApp(deps: ServerDeps) {
  const app = new Hono();

  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toJSON(), err.status);
    }
    deps.logger.error({ err }, "unhandled error");
    return c.json(
      { code: "internal_error", message: "Internal server error" },
      500,
    );
  });

  // Public API routes
  const api = new Hono();
  api.route("/projects", createProjectRoutes(deps));
  api.route("/threads", createThreadRoutes(deps));
  api.route("/environments", createEnvironmentRoutes(deps));
  api.route("/hosts", createHostRoutes(deps));
  api.route("/system", createSystemRoutes(deps));
  app.route("/api/v1", api);

  // Internal daemon API routes (auth required)
  const internal = new Hono();
  if (deps.secretToken) {
    internal.use("*", createAuthMiddleware(deps.secretToken));
  }
  internal.route("/session", createSessionRoutes(deps));
  internal.route("/session", createCommandRoutes(deps));
  internal.route("/session", createEventRoutes(deps));
  internal.route("/session", createToolCallRoutes(deps));
  app.route("/internal", internal);

  return app;
}
