import {
  createThread,
  getThread,
  createEnvironment,
  getEnvironment,
  getDefaultProjectSource,
  queueCommand,
  getActiveSession,
  updateThread,
} from "@bb/db";
import type { Thread, ThreadType } from "@bb/domain";
import { deriveThreadTitleFromInput } from "@bb/core-ui";
import type { CreateThreadRequest } from "@bb/server-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { generateTitle } from "../title-generation.js";

export interface CreateThreadOptions {
  projectId: string;
  providerId: string;
  type?: ThreadType;
  title?: string;
  input?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  model?: string;
  serviceTier?: string;
  reasoningLevel?: string;
  sandboxMode?: string;
  environment: CreateThreadRequest["environment"];
  parentThreadId?: string;
  spawnInitiator?: string;
}

export async function createThreadWithEnvironment(
  deps: ServerDeps,
  opts: CreateThreadOptions,
): Promise<Thread> {
  const { db, hub } = deps;

  // Create thread record
  const titleFallback = opts.input
    ? deriveThreadTitleFromInput(opts.input as unknown as import("@bb/domain").PromptInput[])
    : undefined;

  const thread = createThread(db, hub, {
    projectId: opts.projectId,
    providerId: opts.providerId,
    type: opts.type ?? "standard",
    title: opts.title ?? null,
    status: "created",
    parentThreadId: opts.parentThreadId,
  });

  // Set titleFallback if we derived one
  if (titleFallback) {
    updateThread(db, hub, thread.id, { title: titleFallback });
  }

  // Handle environment setup
  const env = opts.environment;

  switch (env.type) {
    case "reuse": {
      const existing = getEnvironment(db, env.environmentId);
      if (!existing) throw new ApiError(404, "not_found", "Environment not found");

      updateThread(db, hub, thread.id, { environmentId: existing.id });

      if (opts.input && opts.input.length > 0) {
        // Queue thread.start immediately
        queueStartCommand(deps, thread, existing.id, existing.path!, opts);
      }
      break;
    }

    case "host": {
      const workspace = env.workspace;
      const isManaged = workspace.type !== "unmanaged";

      const environment = createEnvironment(db, hub, {
        projectId: opts.projectId,
        hostId: env.hostId,
        path: workspace.type === "unmanaged" ? workspace.path : null,
        managed: isManaged,
        workspaceProvisionType: workspace.type,
        status: "provisioning",
      });

      updateThread(db, hub, thread.id, { environmentId: environment.id });

      // Build the provision command
      const source = getDefaultProjectSource(db, opts.projectId);
      const provisionPayload: Record<string, unknown> = {
        type: "environment.provision",
        environmentId: environment.id,
        projectId: opts.projectId,
        workspaceProvisionType: workspace.type,
      };

      if (workspace.type === "unmanaged") {
        provisionPayload.path = workspace.path;
      } else {
        provisionPayload.sourcePath = source?.path;
        provisionPayload.targetPath = source?.path
          ? `${source.path}-${thread.id.slice(0, 8)}`
          : undefined;
      }

      const session = getActiveSession(db, env.hostId);
      queueCommand(db, hub, {
        hostId: env.hostId,
        sessionId: session?.id ?? null,
        type: "environment.provision",
        payload: JSON.stringify(provisionPayload),
      });
      hub.notifyCommand(env.hostId);
      break;
    }

    case "sandbox-host": {
      throw new ApiError(501, "unsupported_operation", "Sandbox host threads are not yet supported");
    }

    default: {
      const _exhaustive: never = env;
      throw new ApiError(400, "invalid_request", `Unknown environment type: ${(_exhaustive as { type: string }).type}`);
    }
  }

  // Fire-and-forget title generation
  if (opts.input && !opts.title) {
    generateTitle(deps, thread.id, opts.input).catch((err) => {
      deps.logger.warn({ err, threadId: thread.id }, "title generation failed");
    });
  }

  // Return the latest thread state
  return (getThread(db, thread.id) ?? thread) as Thread;
}

function queueStartCommand(
  deps: ServerDeps,
  thread: { id: string },
  environmentId: string,
  workspacePath: string,
  opts: CreateThreadOptions,
): void {
  // Find the host from the environment
  const env = getEnvironment(deps.db, environmentId);
  if (!env) return;

  const activeSession = getActiveSession(deps.db, env.hostId);

  const command = {
    type: "thread.start" as const,
    environmentId,
    threadId: thread.id,
    workspacePath,
    projectId: opts.projectId,
    providerId: opts.providerId,
    input: opts.input,
    options: buildExecutionOptions(opts),
  };

  queueCommand(deps.db, deps.hub, {
    hostId: env.hostId,
    sessionId: activeSession?.id ?? null,
    type: "thread.start",
    payload: JSON.stringify(command),
  });
  deps.hub.notifyCommand(env.hostId);
}

function buildExecutionOptions(opts: CreateThreadOptions) {
  const options: Record<string, unknown> = {};
  if (opts.model) options.model = opts.model;
  if (opts.serviceTier) options.serviceTier = opts.serviceTier;
  if (opts.reasoningLevel) options.reasoningLevel = opts.reasoningLevel;
  if (opts.sandboxMode) options.sandboxMode = opts.sandboxMode;
  return Object.keys(options).length > 0 ? options : undefined;
}
