import {
  archiveThread,
  createDraft,
  deleteDraft,
  getDraft,
  unarchiveThread,
  updateThread,
} from "@bb/db";
import { hostDaemonCommandResultSchemaByType } from "@bb/host-daemon-contract";
import {
  createDraftRequestSchema,
  sendDraftRequestSchema,
  sendMessageRequestSchema,
} from "@bb/server-contract";
import type {
  PromptInput,
  Thread,
  ThreadExecutionOptions,
} from "@bb/domain";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { encodeDraftContent, toQueuedMessage } from "../../services/drafts.js";
import { maybeCleanupEnvironment } from "../../services/environment-cleanup.js";
import { requireThreadEnvironment } from "../../services/entity-lookup.js";
import { queueCommandAndWait } from "../../services/command-wait.js";
import {
  buildExecutionOptions,
  queueThreadStartCommand,
  queueTurnRunCommand,
  queueTurnSteerCommand,
} from "../../services/thread-commands.js";
import {
  appendClientTurnEvent,
  getLastProviderThreadId,
  getLastTurnId,
} from "../../services/thread-events.js";
import { tryTransition } from "../../services/thread-transitions.js";
import { parseJsonBody } from "../../services/validation.js";

interface QueueStartOrRunArgs {
  environment: {
    hostId: string;
    id: string;
    path: string | null;
  };
  eventSequence: number;
  execution: ThreadExecutionOptions;
  input: PromptInput[];
  thread: Thread;
}

function ensureThreadIsWritable(thread: Thread): void {
  if (thread.archivedAt) {
    throw new ApiError(409, "invalid_request", "Thread is archived");
  }
}

function queueStartOrRunCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: QueueStartOrRunArgs,
): void {
  const providerThreadId = getLastProviderThreadId(deps, args.thread.id);
  if (providerThreadId) {
    queueTurnRunCommand(deps, {
      thread: args.thread,
      input: args.input,
      eventSequence: args.eventSequence,
      execution: args.execution,
      environment: {
        id: args.environment.id,
        hostId: args.environment.hostId,
      },
    });
    return;
  }

  if (!args.environment.path) {
    throw new ApiError(409, "invalid_request", "Environment is not ready");
  }

  queueThreadStartCommand(deps, {
    thread: args.thread,
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      path: args.environment.path,
    },
    input: args.input,
    eventSequence: args.eventSequence,
    execution: args.execution,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
  });
  if (args.thread.status === "idle") {
    tryTransition(deps.db, deps.hub, args.thread.id, "active");
  }
}

function resolveSendMode(
  threadStatus: string,
  requestedMode: "auto" | "start" | "steer" | undefined,
): "start" | "steer" {
  if (requestedMode === "start") {
    if (threadStatus === "active") {
      throw new ApiError(409, "invalid_request", "Thread is already active");
    }
    return "start";
  }
  if (requestedMode === "steer") {
    if (threadStatus !== "active") {
      throw new ApiError(409, "invalid_request", "Thread is not active");
    }
    return "steer";
  }
  if (threadStatus === "active") {
    return "steer";
  }
  return "start";
}

export function registerThreadActionRoutes(app: Hono, deps: AppDeps): void {
  app.post("/threads/:id/send", async (context) => {
    const payload = await parseJsonBody(context, sendMessageRequestSchema);
    const { environment, thread } = requireThreadEnvironment(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    if (environment.status !== "ready" || !environment.path) {
      throw new ApiError(409, "invalid_request", "Environment is not ready");
    }

    const mode = resolveSendMode(thread.status, payload.mode);
    const execution = buildExecutionOptions(payload, "client/turn/requested");
    const eventSequence = appendClientTurnEvent(
      deps,
      thread.id,
      environment.id,
      "client/turn/requested",
      {
      input: payload.input,
      execution,
      initiator: "user",
      requestMethod: "turn/start",
      source: "tell",
      },
    );

    if (mode === "start") {
      queueStartOrRunCommand(deps, {
        thread,
        input: payload.input,
        eventSequence,
        execution,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
        },
      });
    } else {
      const expectedTurnId = getLastTurnId(deps, thread.id);
      if (!expectedTurnId) {
        throw new ApiError(409, "invalid_request", "No active turn to steer");
      }
      queueTurnSteerCommand(deps, {
        thread,
        input: payload.input,
        eventSequence,
        expectedTurnId,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
        },
      });
    }

    return context.json({ ok: true });
  });

  app.post("/threads/:id/drafts", async (context) => {
    const payload = await parseJsonBody(context, createDraftRequestSchema);
    const draft = createDraft(deps.db, deps.hub, {
      threadId: context.req.param("id"),
      content: encodeDraftContent(payload.input),
      mode: "auto",
      reasoningLevel: payload.reasoningLevel ?? "medium",
      sandboxMode: payload.sandboxMode ?? "danger-full-access",
    });
    return context.json(toQueuedMessage(draft), 201);
  });

  app.post("/threads/:id/drafts/:draftId/send", async (context) => {
    const payload = await parseJsonBody(context, sendDraftRequestSchema);
    const draft = getDraft(deps.db, context.req.param("draftId"));
    if (!draft || draft.threadId !== context.req.param("id")) {
      throw new ApiError(404, "invalid_request", "Draft not found");
    }
    const queuedMessage = toQueuedMessage(draft);
    const { environment, thread } = requireThreadEnvironment(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    const mode = resolveSendMode(thread.status, payload.mode ?? queuedMessage.mode);
    const execution: ThreadExecutionOptions = {
      source: "client/turn/requested",
      reasoningLevel: queuedMessage.reasoningLevel,
      sandboxMode: queuedMessage.sandboxMode,
    };

    const eventSequence = appendClientTurnEvent(
      deps,
      thread.id,
      environment.id,
      "client/turn/requested",
      {
      input: queuedMessage.content,
      execution,
      initiator: "user",
      requestMethod: "turn/start",
      source: "tell",
      },
    );

    if (mode === "start") {
      queueStartOrRunCommand(deps, {
        thread,
        input: queuedMessage.content,
        eventSequence,
        execution,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
        },
      });
    } else {
      const expectedTurnId = getLastTurnId(deps, thread.id);
      if (!expectedTurnId) {
        throw new ApiError(409, "invalid_request", "No active turn to steer");
      }
      queueTurnSteerCommand(deps, {
        thread,
        input: queuedMessage.content,
        eventSequence,
        expectedTurnId,
        environment: { id: environment.id, hostId: environment.hostId },
      });
    }

    deleteDraft(deps.db, deps.hub, draft.id);
    return context.json({ ok: true, queuedMessage });
  });

  app.delete("/threads/:id/drafts/:draftId", (context) => {
    const draft = getDraft(deps.db, context.req.param("draftId"));
    if (!draft || draft.threadId !== context.req.param("id")) {
      throw new ApiError(404, "invalid_request", "Draft not found");
    }
    const deleted = deleteDraft(deps.db, deps.hub, context.req.param("draftId"));
    if (!deleted) {
      throw new ApiError(404, "invalid_request", "Draft not found");
    }
    return context.json({ ok: true });
  });

  app.post("/threads/:id/stop", async (context) => {
    const { environment, thread } = requireThreadEnvironment(deps.db, context.req.param("id"));
    await queueCommandAndWait(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "thread.stop",
        environmentId: environment.id,
        threadId: thread.id,
      },
    });
    return context.json({ ok: true });
  });

  app.post("/threads/:id/archive", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const force =
      !!body &&
      typeof body === "object" &&
      "force" in body &&
      body.force === true;
    const { environment, thread } = requireThreadEnvironment(deps.db, context.req.param("id"));
    if (!force && environment.status === "ready" && environment.path) {
      const status = hostDaemonCommandResultSchemaByType["workspace.status"].parse(
        await queueCommandAndWait(deps, {
          hostId: environment.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.status",
            environmentId: environment.id,
            ...(thread.mergeBaseBranch
              ? { mergeBaseBranch: thread.mergeBaseBranch }
              : {}),
          },
        }),
      );
      if (
        status.workspaceStatus?.hasUncommittedChanges ||
        status.workspaceStatus?.hasCommittedUnmergedChanges
      ) {
        throw new ApiError(
          409,
          "invalid_request",
          "Thread has uncommitted or unmerged changes",
        );
      }
    }
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
    archiveThread(deps.db, deps.hub, thread.id);
    await maybeCleanupEnvironment(deps, thread.environmentId);
    return context.json({ ok: true });
  });

  app.post("/threads/:id/unarchive", (context) => {
    unarchiveThread(deps.db, deps.hub, context.req.param("id"));
    return context.json({ ok: true });
  });

  app.post("/threads/:id/read", (context) => {
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: Date.now(),
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(thread);
  });

  app.post("/threads/:id/unread", (context) => {
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: null,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(thread);
  });
}
