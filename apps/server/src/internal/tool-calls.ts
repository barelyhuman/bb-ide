import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  createThread,
  hostDaemonSessions,
} from "@bb/db";
import {
  hostDaemonToolCallRequestSchema,
} from "@bb/host-daemon-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";

export function createToolCallRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.post("/tool-call", async (c) => {
    const body = await c.req.json();
    const parsed = hostDaemonToolCallRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.message);
    }

    // Validate session
    const session = deps.db
      .select()
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.id, parsed.data.sessionId))
      .get();

    if (!session || session.status !== "active") {
      throw new ApiError(401, "inactive_session", "Session not found or inactive");
    }

    const toolCall = parsed.data;

    // Handle known tool types
    switch (toolCall.tool) {
      case "spawn_thread": {
        const input = (toolCall.arguments ?? {}) as {
          projectId?: string;
          title?: string;
          parentThreadId?: string;
        };

        if (!input.projectId) {
          return c.json({
            requestId: toolCall.requestId,
            ok: false,
            errorCode: "invalid_input",
            errorMessage: "Missing projectId",
          });
        }

        const thread = createThread(deps.db, deps.hub, {
          projectId: input.projectId,
          providerId: "default",
          type: "standard",
          title: input.title ?? null,
          parentThreadId: input.parentThreadId ?? null,
          status: "created",
        });

        return c.json({
          requestId: toolCall.requestId,
          ok: true,
          result: { threadId: thread.id },
        });
      }
      default: {
        return c.json({
          requestId: toolCall.requestId,
          ok: false,
          errorCode: "unknown_tool",
          errorMessage: `Unknown tool: ${toolCall.tool}`,
        });
      }
    }
  });

  return app;
}
