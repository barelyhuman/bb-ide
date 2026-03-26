import type { Hono } from "hono";
import {
  getThread,
  listEvents,
  createDraft,
  getDraft,
  deleteDraft,
  queueCommand,
  getEnvironment,
  getActiveSession,
} from "@bb/db";
import {
  createDraftRequestSchema,
  sendDraftRequestSchema,
} from "@bb/server-contract";
import type { ServerDeps } from "../../deps.js";
import { ApiError } from "../../errors.js";

export function registerThreadDrafts(app: Hono, deps: ServerDeps): void {
  app.post("/:id/drafts", async (c) => {
    const threadId = c.req.param("id");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const body = await c.req.json();
    const parsed = createDraftRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const draft = createDraft(deps.db, deps.hub, {
      threadId,
      content: JSON.stringify(parsed.data.input),
      mode: "auto",
      reasoningLevel: parsed.data.reasoningLevel ?? "medium",
      sandboxMode: parsed.data.sandboxMode ?? "danger-full-access",
    });

    return c.json(draft, 201);
  });

  app.post("/:id/drafts/:draftId/send", async (c) => {
    const threadId = c.req.param("id");
    const draftId = c.req.param("draftId");
    const thread = getThread(deps.db, threadId);
    if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");

    const draft = getDraft(deps.db, draftId);
    if (!draft || draft.threadId !== threadId) throw new ApiError(404, "not_found", "Draft not found");

    const body = await c.req.json().catch(() => ({}));
    const parsed = sendDraftRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    if (!thread.environmentId) throw new ApiError(400, "invalid_request", "Thread has no environment");

    const env = getEnvironment(deps.db, thread.environmentId);
    if (!env) throw new ApiError(400, "invalid_request", "Environment not found");

    const input = JSON.parse(draft.content);
    const mode = parsed.data.mode ?? "auto";
    const shouldSteer = mode === "steer" || (mode === "auto" && thread.status === "active");

    if (shouldSteer) {
      const events = listEvents(deps.db, { threadId, limit: 1 });
      const expectedTurnId = events[0]?.turnId ?? "";
      const session = getActiveSession(deps.db, env.hostId);
      queueCommand(deps.db, deps.hub, {
        hostId: env.hostId, sessionId: session?.id ?? null, type: "turn.steer",
        payload: JSON.stringify({ type: "turn.steer", environmentId: env.id, threadId, expectedTurnId, input }),
      });
      deps.hub.notifyCommand(env.hostId);
    } else {
      const session = getActiveSession(deps.db, env.hostId);
      queueCommand(deps.db, deps.hub, {
        hostId: env.hostId, sessionId: session?.id ?? null, type: "turn.run",
        payload: JSON.stringify({
          type: "turn.run", environmentId: env.id, threadId, input,
          options: { reasoningLevel: draft.reasoningLevel, sandboxMode: draft.sandboxMode },
        }),
      });
      deps.hub.notifyCommand(env.hostId);
    }

    deleteDraft(deps.db, deps.hub, draftId);
    return c.json({ ok: true, queuedMessage: draft });
  });

  app.delete("/:id/drafts/:draftId", (c) => {
    const deleted = deleteDraft(deps.db, deps.hub, c.req.param("draftId"));
    if (!deleted) throw new ApiError(404, "not_found", "Draft not found");
    return c.json({ ok: true });
  });
}
