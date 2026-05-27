import type { Hono } from "hono";
import { z } from "zod";
import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
} from "@bb/host-daemon-contract";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import {
  typedRoutes,
  type PublicApiSchema,
  type StatusStateBroadcastMessage,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { queueCommandAndWait } from "../../services/hosts/command-wait.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../../services/lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../../services/lib/lifecycle-api-errors.js";
import {
  STATUS_DATA_NO_STORE_CACHE_CONTROL,
  STATUS_STATE_CLIENT_HEADER,
  STATUS_STATE_OPERATION_HEADER,
  createStatusDataEtag,
  createStatusDataGetResponse,
  parseStatusDataKey,
} from "../../services/threads/status-data-files.js";

interface BrowserStatusStateSetPayload {
  value: JsonValue;
}

interface RequireThreadStatusDataTargetArgs {
  threadId: string;
}

interface PutBrowserStatusStateArgs {
  headers: Headers;
  key: string;
  payload: BrowserStatusStateSetPayload;
  threadId: string;
}

interface DeleteBrowserStatusStateArgs {
  headers: Headers;
  key: string;
  threadId: string;
}

interface ThreadStatusDataTarget {
  hostId: string;
  threadId: string;
}

type StatusDataCommandType =
  | "host.status_data.list"
  | "host.status_data.get"
  | "host.status_data.set"
  | "host.status_data.delete";

interface QueueStatusDataCommandArgs<TType extends StatusDataCommandType> {
  command: Extract<HostDaemonCommand, { type: TType }>;
  hostId: string;
}

const browserStatusStateSetPayloadSchema = z
  .object({
    value: jsonValueSchema,
  })
  .strict();

async function requireThreadStatusDataTarget(
  deps: AppDeps,
  args: RequireThreadStatusDataTargetArgs,
): Promise<ThreadStatusDataTarget> {
  const thread = requirePublicThread(deps.db, args.threadId);
  if (!thread.environmentId) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  const environment = requireEnvironment(deps.db, thread.environmentId);
  return {
    hostId: environment.hostId,
    threadId: thread.id,
  };
}

async function parseBrowserStatusStateSetPayload(
  request: Request,
): Promise<BrowserStatusStateSetPayload> {
  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    throw new ApiError(400, "invalid_request", "Request body must be JSON");
  }
  const parsed = browserStatusStateSetPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid status state payload");
  }
  return parsed.data;
}

function remapStatusDataCommandError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }

  if (error.body.code === "ENOENT") {
    throw new ApiError(
      404,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_path") {
    throw new ApiError(
      400,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_json") {
    throw new ApiError(
      422,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  throw error;
}

async function queueStatusDataCommand<TType extends StatusDataCommandType>(
  deps: AppDeps,
  args: QueueStatusDataCommandArgs<TType>,
): Promise<HostDaemonCommandResult<TType>> {
  try {
    return await queueCommandAndWait(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: args.command,
    });
  } catch (error) {
    remapStatusDataCommandError(error);
  }
}

async function putBrowserStatusState(
  deps: AppDeps,
  args: PutBrowserStatusStateArgs,
): Promise<Response> {
  const key = parseStatusDataKey(args.key);
  const target = await requireThreadStatusDataTarget(deps, {
    threadId: args.threadId,
  });
  const writeResult = await queueStatusDataCommand(deps, {
    hostId: target.hostId,
    command: {
      type: "host.status_data.set",
      threadId: target.threadId,
      key,
      value: args.payload.value,
    },
  });

  const message: StatusStateBroadcastMessage = {
    type: "status-data.changed",
    threadId: args.threadId,
    key,
    value: writeResult.value,
    deleted: false,
    previousValue: writeResult.previousValue,
    previousValuePresent: writeResult.previousValuePresent,
    version: writeResult.version,
    writerClientId: args.headers.get(STATUS_STATE_CLIENT_HEADER),
    operationId: args.headers.get(STATUS_STATE_OPERATION_HEADER),
  };
  deps.hub.notifyThreadStatusData(message);

  return new Response(
    JSON.stringify(createStatusDataGetResponse(writeResult)),
    {
      status: 200,
      headers: {
        "cache-control": STATUS_DATA_NO_STORE_CACHE_CONTROL,
        "content-type": "application/json",
        etag: createStatusDataEtag(writeResult.version),
      },
    },
  );
}

async function deleteBrowserStatusState(
  deps: AppDeps,
  args: DeleteBrowserStatusStateArgs,
): Promise<Response> {
  const key = parseStatusDataKey(args.key);
  const target = await requireThreadStatusDataTarget(deps, {
    threadId: args.threadId,
  });
  const deleteResult = await queueStatusDataCommand(deps, {
    hostId: target.hostId,
    command: {
      type: "host.status_data.delete",
      threadId: target.threadId,
      key,
    },
  });
  if (deleteResult.deleted) {
    const message: StatusStateBroadcastMessage = {
      type: "status-data.changed",
      threadId: args.threadId,
      key,
      value: null,
      deleted: true,
      previousValue: deleteResult.previousValue,
      previousValuePresent: deleteResult.previousValuePresent,
      version: null,
      writerClientId: args.headers.get(STATUS_STATE_CLIENT_HEADER),
      operationId: args.headers.get(STATUS_STATE_OPERATION_HEADER),
    };
    deps.hub.notifyThreadStatusData(message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "cache-control": STATUS_DATA_NO_STORE_CACHE_CONTROL,
      "content-type": "application/json",
    },
  });
}

export function registerThreadStatusDataRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/status-data", async (context) => {
    const target = await requireThreadStatusDataTarget(deps, {
      threadId: context.req.param("id"),
    });
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    return context.json(
      await queueStatusDataCommand(deps, {
        hostId: target.hostId,
        command: {
          type: "host.status_data.list",
          threadId: target.threadId,
        },
      }),
    );
  });

  get("/threads/:id/status-data/:key", async (context) => {
    const target = await requireThreadStatusDataTarget(deps, {
      threadId: context.req.param("id"),
    });
    const key = parseStatusDataKey(context.req.param("key"));
    const entry = await queueStatusDataCommand(deps, {
      hostId: target.hostId,
      command: {
        type: "host.status_data.get",
        threadId: target.threadId,
        key,
      },
    });
    context.header("cache-control", STATUS_DATA_NO_STORE_CACHE_CONTROL);
    context.header("etag", createStatusDataEtag(entry.version));
    return context.json(createStatusDataGetResponse(entry));
  });

  // Contract-private, not network-private: the injected same-origin
  // window.bbStatusState client uses this endpoint for browser mutations.
  app.put("/threads/:id/status-state/:key", async (context) => {
    return putBrowserStatusState(deps, {
      threadId: context.req.param("id"),
      key: context.req.param("key"),
      headers: context.req.raw.headers,
      payload: await parseBrowserStatusStateSetPayload(context.req.raw),
    });
  });

  app.delete("/threads/:id/status-state/:key", async (context) => {
    return deleteBrowserStatusState(deps, {
      threadId: context.req.param("id"),
      key: context.req.param("key"),
      headers: context.req.raw.headers,
    });
  });
}
