import type { Hono } from "hono";
import {
  getThread,
  updateThread,
  deleteThread,
  archiveThread,
  unarchiveThread,
  listEvents,
  queueCommand,
  getEnvironment,
  getActiveSession,
} from "@bb/db";
import {
  sendMessageRequestSchema,
  updateThreadRequestSchema,
} from "@bb/server-contract";
import type { ServerDeps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { queueCommandAndWait } from "../../command-wait.js";
import { maybeCleanupEnvironment } from "../thread-cleanup.js";

export function registerThreadActions(app: Hono, deps: ServerDeps): void {
  app.patch("/:id", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const body = await c.req.json();
    const parsed = updateThreadRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;

    const updated = updateThread(deps.db, deps.hub, threadId, updates);
    if (!updated) throw new ApiError(404, "thread_not_found", "Thread not found");

    if (parsed.data.title && thread.environmentId) {
      const env = getEnvironment(deps.db, thread.environmentId);
      if (env) {
        const session = getActiveSession(deps.db, env.hostId);
        queueCommand(deps.db, deps.hub, {
          hostId: env.hostId,
          sessionId: session?.id ?? null,
          type: "thread.rename",
          payload: JSON.stringify({
            type: "thread.rename",
            environmentId: env.id,
            threadId,
            title: parsed.data.title,
          }),
        });
        deps.hub.notifyCommand(env.hostId);
      }
    }

    return c.json(updated);
  });

  app.delete("/:id", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const environmentId = thread.environmentId;
    deleteThread(deps.db, deps.hub, threadId);

    if (environmentId) {
      await maybeCleanupEnvironment(deps, environmentId);
    }

    return c.json({ ok: true });
  });

  app.post("/:id/send", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
    if (thread.archivedAt) throw new ApiError(400, "thread_archived", "Thread is archived");

    const body = await c.req.json();
    const parsed = sendMessageRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    if (!thread.environmentId) throw new ApiError(400, "invalid_request", "Thread has no environment");

    const env = getEnvironment(deps.db, thread.environmentId);
    if (!env) throw new ApiError(400, "invalid_request", "Thread environment not found");

    const mode = parsed.data.mode ?? "auto";
    const isActive = thread.status === "active";

    if (mode === "start" && isActive) throw new ApiError(400, "invalid_request", "Thread is active, cannot start new turn");
    if (mode === "steer" && !isActive) throw new ApiError(400, "no_active_turn", "Thread has no active turn to steer");

    const shouldSteer = mode === "steer" || (mode === "auto" && isActive);

    if (shouldSteer) {
      const events = listEvents(deps.db, { threadId, limit: 1 });
      const expectedTurnId = events[0]?.turnId ?? "";

      const session = getActiveSession(deps.db, env.hostId);
      queueCommand(deps.db, deps.hub, {
        hostId: env.hostId,
        sessionId: session?.id ?? null,
        type: "turn.steer",
        payload: JSON.stringify({
          type: "turn.steer", environmentId: env.id, threadId, expectedTurnId, input: parsed.data.input,
        }),
      });
      deps.hub.notifyCommand(env.hostId);
    } else {
      const options: Record<string, unknown> = {};
      if (parsed.data.model) options.model = parsed.data.model;
      if (parsed.data.serviceTier) options.serviceTier = parsed.data.serviceTier;
      if (parsed.data.reasoningLevel) options.reasoningLevel = parsed.data.reasoningLevel;
      if (parsed.data.sandboxMode) options.sandboxMode = parsed.data.sandboxMode;

      const session = getActiveSession(deps.db, env.hostId);
      queueCommand(deps.db, deps.hub, {
        hostId: env.hostId,
        sessionId: session?.id ?? null,
        type: "turn.run",
        payload: JSON.stringify({
          type: "turn.run", environmentId: env.id, threadId, input: parsed.data.input,
          options: Object.keys(options).length > 0 ? options : undefined,
        }),
      });
      deps.hub.notifyCommand(env.hostId);
    }

    return c.json({ ok: true });
  });

  app.post("/:id/stop", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    if (thread.environmentId) {
      const env = getEnvironment(deps.db, thread.environmentId);
      if (env) {
        await queueCommandAndWait({
          db: deps.db, hub: deps.hub, hostId: env.hostId,
          command: { type: "thread.stop" as const, environmentId: env.id, threadId },
        }).catch(() => { /* may fail if already idle */ });
      }
    }

    return c.json({ ok: true });
  });

  app.post("/:id/archive", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const body = await c.req.json().catch(() => ({}));
    const force = (body as { force?: boolean }).force ?? false;

    if (!force && thread.environmentId) {
      const env = getEnvironment(deps.db, thread.environmentId);
      if (env && deps.hub.isDaemonConnected(env.hostId)) {
        try {
          const statusResult = await queueCommandAndWait({
            db: deps.db, hub: deps.hub, hostId: env.hostId,
            command: { type: "workspace.status" as const, environmentId: env.id },
            timeoutMs: 10_000,
          });
          if (statusResult.ok) {
            const data = statusResult.result as { workspaceStatus?: { hasUncommittedChanges?: boolean; hasUnmergedChanges?: boolean } };
            const ws = data.workspaceStatus;
            if (ws?.hasUncommittedChanges || ws?.hasUnmergedChanges) {
              throw new ApiError(409, "invalid_request", "Cannot archive: workspace has uncommitted or unmerged changes. Use force=true to override.");
            }
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
        }
      }
    }

    if (thread.status === "active" && thread.environmentId) {
      const env = getEnvironment(deps.db, thread.environmentId);
      if (env) {
        await queueCommandAndWait({
          db: deps.db, hub: deps.hub, hostId: env.hostId,
          command: { type: "thread.stop" as const, environmentId: env.id, threadId },
          timeoutMs: 10_000,
        }).catch(() => {});
      }
    }

    archiveThread(deps.db, deps.hub, threadId);
    if (thread.environmentId) await maybeCleanupEnvironment(deps, thread.environmentId);
    return c.json({ ok: true });
  });

  app.post("/:id/unarchive", (c) => {
    const thread = unarchiveThread(deps.db, deps.hub, c.req.param("id"));
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
    return c.json({ ok: true });
  });

  app.post("/:id/read", (c) => {
    const updated = updateThread(deps.db, deps.hub, c.req.param("id"), { lastReadAt: Date.now() });
    if (!updated) throw new ApiError(404, "thread_not_found", "Thread not found");
    return c.json(updated);
  });

  app.post("/:id/unread", (c) => {
    const updated = updateThread(deps.db, deps.hub, c.req.param("id"), { lastReadAt: null });
    if (!updated) throw new ApiError(404, "thread_not_found", "Thread not found");
    return c.json(updated);
  });
}
