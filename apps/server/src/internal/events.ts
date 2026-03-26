import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  insertEvents,
  getHighWaterMarks,
  getThread,
  transitionThreadStatus,
  hostDaemonSessions,
} from "@bb/db";
import type { ThreadEventType } from "@bb/domain";
import {
  hostDaemonEventBatchRequestSchema,
} from "@bb/host-daemon-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";

export function createEventRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.post("/events", async (c) => {
    const body = await c.req.json();
    const parsed = hostDaemonEventBatchRequestSchema.safeParse(body);
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

    const eventInputs = parsed.data.events.map((e) => ({
      threadId: e.threadId,
      environmentId: e.environmentId,
      turnId: (e.event as { turnId?: string }).turnId ?? null,
      providerThreadId: (e.event as { providerThreadId?: string }).providerThreadId ?? null,
      sequence: e.sequence,
      type: e.event.type as ThreadEventType,
      data: JSON.stringify(e.event),
    }));

    insertEvents(deps.db, deps.hub, eventInputs);

    // Handle status transitions from events
    for (const e of parsed.data.events) {
      if (e.event.type === "turn/completed") {
        const thread = getThread(deps.db, e.threadId);
        if (thread && thread.status === "active") {
          transitionThreadStatus(deps.db, deps.hub, e.threadId, "idle");
        }
      }
      if (e.event.type === "error") {
        const thread = getThread(deps.db, e.threadId);
        if (thread && thread.status !== "error") {
          try {
            transitionThreadStatus(deps.db, deps.hub, e.threadId, "error");
          } catch {
            // Transition may be invalid
          }
        }
      }
    }

    // Return high-water marks
    const threadIds = [...new Set(parsed.data.events.map((e) => e.threadId))];
    const threadHighWaterMarks = getHighWaterMarks(deps.db, threadIds);

    return c.json({ threadHighWaterMarks });
  });

  return app;
}
