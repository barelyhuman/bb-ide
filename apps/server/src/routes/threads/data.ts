import { hostDaemonCommandResultSchemaByType } from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import {
  threadEventWaitQuerySchema,
  threadEventsQuerySchema,
  threadTimelineQuerySchema,
  threadWorkspaceFileQuerySchema,
  threadWorkspaceFilesQuerySchema,
  timelineToolDetailsQuerySchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  requireReadyEnvironment,
  requireThread,
} from "../../services/entity-lookup.js";
import { queueCommandAndWait } from "../../services/command-wait.js";
import { buildThreadTimeline, buildTimelineToolDetails } from "../../services/timeline.js";
import {
  findThreadEvent,
  getLastThreadOutput,
  listThreadEventRows,
} from "../../services/thread-data.js";
import { getLastExecutionOptions } from "../../services/thread-events.js";
import { parseOptionalInteger } from "../../services/validation.js";

function validateFilePath(filePath: string): void {
  if (
    filePath.startsWith("/") ||
    filePath.split("/").includes("..") ||
    filePath.split("\\").includes("..")
  ) {
    throw new ApiError(400, "invalid_request", "Invalid file path");
  }
}

export function registerThreadDataRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/timeline", threadTimelineQuerySchema, (context, query) =>
    context.json(
      buildThreadTimeline(deps.db, requireThread(deps.db, context.req.param("id")), {
        limit: parseOptionalInteger(query.limit, "limit"),
        includeManagerDebugView: query.includeManagerDebugView === "true",
        includeToolGroupMessages: query.includeToolGroupMessages === "true",
      }),
    ),
  );

  get("/threads/:id/timeline/tool-details", timelineToolDetailsQuerySchema, (context, query) =>
    context.json(
      buildTimelineToolDetails(
        deps.db,
        requireThread(deps.db, context.req.param("id")),
        {
          sourceSeqStart: parseOptionalInteger(query.sourceSeqStart, "sourceSeqStart") ?? 0,
          sourceSeqEnd: parseOptionalInteger(query.sourceSeqEnd, "sourceSeqEnd") ?? 0,
          includeManagerDebugView: query.includeManagerDebugView === "true",
        },
      ),
    ),
  );

  get("/threads/:id/output", (context) => {
    requireThread(deps.db, context.req.param("id"));
    return context.json({ output: getLastThreadOutput(deps.db, context.req.param("id")) });
  });

  get("/threads/:id/events", threadEventsQuerySchema, (context, query) => {
    requireThread(deps.db, context.req.param("id"));
    return context.json(
      listThreadEventRows(deps.db, {
        threadId: context.req.param("id"),
        afterSeq: parseOptionalInteger(query.afterSeq, "afterSeq"),
        limit: parseOptionalInteger(query.limit, "limit") ?? 100,
      }),
    );
  });

  get("/threads/:id/events/wait", threadEventWaitQuerySchema, async (context, query) => {
    const threadId = context.req.param("id");
    requireThread(deps.db, threadId);

    const afterSeq = parseOptionalInteger(query.afterSeq, "afterSeq");
    const waitMs = Math.min(parseOptionalInteger(query.waitMs, "waitMs") ?? 30_000, 60_000);
    const eventType = query.type;

    const findMatch = () => findThreadEvent(deps.db, { threadId, type: eventType, afterSeq });

    const deadline = Date.now() + waitMs;
    let match = findMatch();
    while (!match) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const waiter = deps.hub.registerThreadEventWaiter(threadId, remaining);
      match = findMatch();
      if (match) {
        waiter.cancel();
        break;
      }
      await waiter.promise;
      match = findMatch();
    }

    if (!match) {
      return new Response(null, { status: 204 });
    }

    return context.json(match);
  });

  get("/threads/:id/default-execution-options", (context) => {
    requireThread(deps.db, context.req.param("id"));
    return context.json(getLastExecutionOptions(deps, context.req.param("id")));
  });

  get("/threads/:id/workspace/files", threadWorkspaceFilesQuerySchema, async (context, query) => {
    const thread = requireThread(deps.db, context.req.param("id"));
    if (!thread.environmentId) {
      throw new ApiError(409, "invalid_request", "Thread has no environment");
    }
    const readyEnvironment = requireReadyEnvironment(deps.db, thread.environmentId);
    const limit = Math.min(parseOptionalInteger(query.limit, "limit") ?? 1000, 10000);
    if (limit <= 0) {
      throw new ApiError(400, "invalid_request", "limit must be a positive integer");
    }
    const rawResult = await queueCommandAndWait(deps, {
      hostId: readyEnvironment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.list_files",
        environmentId: readyEnvironment.id,
        workspaceContext: {
          workspacePath: readyEnvironment.path,
          workspaceProvisionType: readyEnvironment.workspaceProvisionType,
        },
        ...(query.query ? { query: query.query } : {}),
        limit,
      },
    });
    const result = hostDaemonCommandResultSchemaByType["workspace.list_files"].parse(rawResult);
    return context.json({ files: result.files, truncated: result.truncated });
  });

  get("/threads/:id/workspace/file", threadWorkspaceFileQuerySchema, async (context, query) => {
    validateFilePath(query.path);
    const thread = requireThread(deps.db, context.req.param("id"));
    if (!thread.environmentId) {
      throw new ApiError(409, "invalid_request", "Thread has no environment");
    }
    const readyEnvironment = requireReadyEnvironment(deps.db, thread.environmentId);
    const rawResult = await queueCommandAndWait(deps, {
      hostId: readyEnvironment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.read_file",
        environmentId: readyEnvironment.id,
        workspaceContext: {
          workspacePath: readyEnvironment.path,
          workspaceProvisionType: readyEnvironment.workspaceProvisionType,
        },
        path: query.path,
      },
    });
    return context.json(
      hostDaemonCommandResultSchemaByType["workspace.read_file"].parse(rawResult),
    );
  });
}
