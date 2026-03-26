import type { Hono } from "hono";
import { getThread, listEvents } from "@bb/db";
import {
  toViewMessages,
  buildTimelineRows,
  extractThreadContextWindowUsage,
} from "@bb/core-ui";
import type { ThreadEventWithMeta } from "@bb/core-ui";
import type { ServerDeps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { queueCommandAndWait } from "../../command-wait.js";
import { getEnvironment } from "@bb/db";

function dbEventsToMeta(events: Array<{ id: string; data: string; sequence: number; createdAt: number }>): ThreadEventWithMeta[] {
  return events.map((e) => ({
    event: JSON.parse(e.data),
    meta: { id: e.id, seq: e.sequence, createdAt: e.createdAt },
  }));
}

export function registerThreadData(app: Hono, deps: ServerDeps): void {
  app.get("/:id/timeline", (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const includeManagerDebugView = c.req.query("includeManagerDebugView") === "true";

    const events = listEvents(deps.db, { threadId, limit });
    const viewMessages = toViewMessages(dbEventsToMeta(events));
    const rows = buildTimelineRows(viewMessages, { includeToolGroupMessages: includeManagerDebugView });
    const lastEvent = events[events.length - 1];
    const contextWindowUsage = lastEvent ? extractThreadContextWindowUsage(JSON.parse(lastEvent.data)) : null;

    return c.json({ rows, contextWindowUsage });
  });

  app.get("/:id/timeline/tool-details", (c) => {
    const threadId = c.req.param("id");
    const turnId = c.req.query("turnId");
    const sourceSeqStart = parseInt(c.req.query("sourceSeqStart") ?? "0", 10);
    const sourceSeqEnd = parseInt(c.req.query("sourceSeqEnd") ?? "0", 10);
    if (!turnId) throw new ApiError(400, "invalid_request", "Missing turnId");

    const events = listEvents(deps.db, {
      threadId,
      afterSequence: sourceSeqStart > 0 ? sourceSeqStart - 1 : undefined,
      limit: sourceSeqEnd - sourceSeqStart + 1,
    });

    const messages = toViewMessages(dbEventsToMeta(events));
    return c.json({ messages });
  });

  app.get("/:id/output", (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const events = listEvents(deps.db, { threadId, limit: 50 });
    let output: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const data = JSON.parse(events[i].data);
      if (data.type === "assistant_message" || data.type === "text") {
        const text = data.text ?? data.content;
        if (typeof text === "string") { output = text; break; }
      }
    }
    return c.json({ output });
  });

  app.get("/:id/events", (c) => {
    const threadId = c.req.param("id");
    const afterSeq = c.req.query("afterSeq");
    const limit = c.req.query("limit");
    const events = listEvents(deps.db, {
      threadId,
      afterSequence: afterSeq ? parseInt(afterSeq, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return c.json(events);
  });

  app.get("/:id/default-execution-options", (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const events = listEvents(deps.db, { threadId, limit: 100 });
    for (let i = events.length - 1; i >= 0; i--) {
      const data = JSON.parse(events[i].data);
      if (data.options) return c.json(data.options);
    }
    return c.json(null);
  });

  app.get("/:id/workspace/files", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
    if (!thread.environmentId) throw new ApiError(400, "invalid_request", "Thread has no environment");

    const env = getEnvironment(deps.db, thread.environmentId);
    if (!env) throw new ApiError(400, "invalid_request", "Environment not found");

    const result = await queueCommandAndWait({
      db: deps.db, hub: deps.hub, hostId: env.hostId,
      command: { type: "workspace.list_files" as const, environmentId: env.id, query: c.req.query("query") },
    });
    if (!result.ok) throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Failed to list files");

    const data = result.result as { files: Array<{ path: string; name: string }> };
    return c.json(data.files);
  });

  app.get("/:id/workspace/file", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
    if (!thread.environmentId) throw new ApiError(400, "invalid_request", "Thread has no environment");

    const env = getEnvironment(deps.db, thread.environmentId);
    if (!env) throw new ApiError(400, "invalid_request", "Environment not found");

    const path = c.req.query("path");
    if (!path) throw new ApiError(400, "invalid_request", "Missing path parameter");

    const result = await queueCommandAndWait({
      db: deps.db, hub: deps.hub, hostId: env.hostId,
      command: { type: "workspace.read_file" as const, environmentId: env.id, path },
    });
    if (!result.ok) throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Failed to read file");

    const data = result.result as { path: string; content: string };
    return c.json(data);
  });
}
