import {
  createThread,
  getEnvironment,
  listConnectedHostIds,
  queueCommand,
} from "@bb/db";
import { hostDaemonCommandResultSchemaByType } from "@bb/host-daemon-contract";
import {
  replayRunRequestSchema,
  typedRoutes,
  type PublicApiSchema,
  type ReplayCaptureDetail,
  type ReplayCaptureHostSummary,
} from "@bb/server-contract";
import {
  isReplayCaptureId,
  type ReplayCaptureManifest,
} from "@bb/replay-capture";
import type { Hono } from "hono";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { queueCommandAndWait } from "../services/hosts/command-wait.js";
import { ensureHostSessionReadyForWork } from "../services/hosts/host-lifecycle.js";

interface ResolvedReplayCapture {
  environmentId: string;
  hostId: string;
  projectId: string;
  providerId: string;
  title: string | null;
}

function toDetail(
  hostId: string,
  manifest: ReplayCaptureManifest,
): ReplayCaptureDetail {
  return {
    ...manifest,
    hostId,
  };
}

function requireReplayCaptureId(captureId: string): void {
  if (!isReplayCaptureId(captureId)) {
    throw new ApiError(400, "invalid_request", "Invalid replay capture id");
  }
}

function resolveManifestReplayTarget(
  manifest: ReplayCaptureDetail,
): ResolvedReplayCapture {
  return {
    environmentId: manifest.environmentId,
    hostId: manifest.hostId,
    projectId: manifest.projectId,
    providerId: manifest.providerId,
    title: manifest.title,
  };
}

function parseReplayCaptureListResult(value: unknown) {
  return hostDaemonCommandResultSchemaByType["replay.capture_list"].parse(
    value,
  );
}

function parseReplayCaptureGetResult(value: unknown): ReplayCaptureManifest {
  return hostDaemonCommandResultSchemaByType["replay.capture_get"].parse(value);
}

function isReplayCaptureNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError && error.body.code === "replay_capture_not_found"
  );
}

async function listHostCaptures(
  deps: AppDeps,
  hostId: string,
): Promise<ReplayCaptureHostSummary[]> {
  const result = parseReplayCaptureListResult(
    await queueCommandAndWait(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "replay.capture_list",
      },
    }),
  );
  return result.captures.map(
    (capture): ReplayCaptureHostSummary => ({
      ...capture,
      hostId,
    }),
  );
}

async function listCaptures(
  deps: AppDeps,
): Promise<ReplayCaptureHostSummary[]> {
  const hostIds = [...new Set(listConnectedHostIds(deps.db))];
  const perHostCaptures = await Promise.all(
    hostIds.map(async (hostId) => {
      try {
        return await listHostCaptures(deps, hostId);
      } catch (error) {
        deps.logger.warn(
          { err: error, hostId },
          "Skipping replay captures from host after capture list command failed",
        );
        return [];
      }
    }),
  );

  return perHostCaptures
    .flat()
    .sort((left, right) => right.capturedAt - left.capturedAt);
}

async function getHostCapture(
  deps: AppDeps,
  hostId: string,
  captureId: string,
): Promise<ReplayCaptureDetail> {
  const manifest = parseReplayCaptureGetResult(
    await queueCommandAndWait(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "replay.capture_get",
        captureId,
      },
    }),
  );
  return toDetail(hostId, manifest);
}

async function findCapture(
  deps: AppDeps,
  captureId: string,
): Promise<ReplayCaptureDetail> {
  requireReplayCaptureId(captureId);

  let firstUnexpectedError: Error | null = null;
  for (const hostId of new Set(listConnectedHostIds(deps.db))) {
    try {
      return await getHostCapture(deps, hostId, captureId);
    } catch (error) {
      if (isReplayCaptureNotFound(error)) {
        continue;
      }
      deps.logger.warn(
        { err: error, captureId, hostId },
        "Failed to resolve replay capture from host",
      );
      if (!firstUnexpectedError) {
        firstUnexpectedError =
          error instanceof Error
            ? error
            : new Error("Unexpected replay capture resolution failure");
      }
    }
  }

  if (firstUnexpectedError) {
    throw firstUnexpectedError;
  }
  throw new ApiError(
    404,
    "replay_capture_not_found",
    "Replay capture not found",
  );
}

export function registerDevelopmentOnlyReplayRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/development-only/replay/captures", async (context) => {
    return context.json({ captures: await listCaptures(deps) });
  });

  get("/development-only/replay/captures/:id", async (context) => {
    return context.json(await findCapture(deps, context.req.param("id")));
  });

  post(
    "/development-only/replay/captures/:id/runs",
    replayRunRequestSchema,
    async (context, payload) => {
      const manifest = await findCapture(deps, context.req.param("id"));
      const resolved = resolveManifestReplayTarget(manifest);
      const environment = getEnvironment(deps.db, resolved.environmentId);
      if (!environment) {
        throw new ApiError(
          404,
          "environment_not_found",
          "Replay environment not found",
        );
      }
      if (environment.hostId !== resolved.hostId) {
        throw new ApiError(
          409,
          "replay_capture_host_mismatch",
          "Replay capture belongs to a different host than its environment",
        );
      }
      if (environment.projectId !== resolved.projectId) {
        throw new ApiError(
          409,
          "replay_capture_project_mismatch",
          "Replay capture belongs to a different project than its environment",
        );
      }
      const session = await ensureHostSessionReadyForWork(deps, {
        hostId: resolved.hostId,
      });
      const replayThread = createThread(deps.db, deps.hub, {
        projectId: resolved.projectId,
        environmentId: resolved.environmentId,
        providerId: resolved.providerId,
        status: "created",
        title: `[Replay] ${resolved.title ?? manifest.captureId}`,
      });
      const command = queueCommand(deps.db, deps.hub, {
        hostId: resolved.hostId,
        sessionId: session.id,
        type: "replay.run",
        payload: JSON.stringify({
          type: "replay.run",
          captureId: manifest.captureId,
          environmentId: resolved.environmentId,
          threadId: replayThread.id,
          speed: payload.speed,
        }),
      });
      return context.json(
        {
          commandId: command.id,
          replayThreadId: replayThread.id,
          projectId: replayThread.projectId,
        },
        201,
      );
    },
  );
}
