import {
  getActiveSession,
  getDefaultProjectSource,
  getProject,
  queueCommand,
  transitionThreadStatus,
} from "@bb/db";
import type {
  PromptInput,
  Thread,
  ThreadExecutionOptions,
} from "@bb/domain";
import type { HostDaemonExecutionOptions } from "@bb/host-daemon-contract";
import type {
  CreateThreadRequest,
  SendMessageRequest,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireConnectedHostSession } from "./entity-lookup.js";
import { getLastProviderThreadId } from "./thread-events.js";

export function buildExecutionOptions(
  request:
    | Pick<CreateThreadRequest, "model" | "reasoningLevel" | "sandboxMode" | "serviceTier">
    | Pick<SendMessageRequest, "model" | "reasoningLevel" | "sandboxMode" | "serviceTier">,
  source: "client/thread/start" | "client/turn/requested" | "client/turn/start",
): ThreadExecutionOptions {
  return {
    ...(request.model ? { model: request.model } : {}),
    ...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
    ...(request.reasoningLevel ? { reasoningLevel: request.reasoningLevel } : {}),
    ...(request.sandboxMode ? { sandboxMode: request.sandboxMode } : {}),
    source,
  };
}

export async function queueThreadStartCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence?: number;
    environment: {
      hostId: string;
      id: string;
      path: string | null;
    };
    execution: HostDaemonExecutionOptions;
    input: PromptInput[];
    projectId: string;
    providerId: string;
    thread: Thread;
  },
): Promise<void> {
  const runtimeContext = await buildThreadRuntimeContext(deps, {
    thread: args.thread,
    environment: args.environment,
    execution: args.execution,
  });
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "thread.start",
    payload: JSON.stringify({
      type: "thread.start",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      workspacePath: runtimeContext.workspacePath,
      projectId: args.projectId,
      projectName: runtimeContext.projectName,
      projectRootPath: runtimeContext.projectRootPath,
      providerId: args.providerId,
      threadType: runtimeContext.threadType,
      ...(args.eventSequence !== undefined
        ? { eventSequence: args.eventSequence }
        : {}),
      input: args.input,
      ...(runtimeContext.options ? { options: runtimeContext.options } : {}),
    }),
  });
}

interface ThreadCommandEnvironment {
  hostId: string;
  id: string;
  path: string | null;
}

interface ReadyThreadCommandEnvironment {
  hostId: string;
  id: string;
  path: string;
}

interface ThreadRuntimeContext {
  options?: HostDaemonExecutionOptions;
  projectId: string;
  projectName: string;
  projectRootPath: string;
  providerId: string;
  providerThreadId?: string;
  threadType: Thread["type"];
  workspacePath: string;
}

function requireEnvironmentPath(
  environment: ThreadCommandEnvironment,
): string {
  if (!environment.path) {
    throw new ApiError(409, "invalid_request", "Environment is not ready");
  }

  return environment.path;
}

async function buildThreadRuntimeContext(
  deps: Pick<AppDeps, "db">,
  args: {
    environment: ThreadCommandEnvironment;
    execution?: ThreadExecutionOptions;
    providerThreadId?: string;
    thread: Thread;
  },
): Promise<ThreadRuntimeContext> {
  const workspacePath = requireEnvironmentPath(args.environment);
  const project = getProject(deps.db, args.thread.projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  const defaultSource = getDefaultProjectSource(deps.db, args.thread.projectId);

  return {
    workspacePath,
    projectId: args.thread.projectId,
    projectName: project.name,
    projectRootPath: defaultSource?.path ?? workspacePath,
    providerId: args.thread.providerId,
    threadType: args.thread.type,
    ...(args.providerThreadId
      ? { providerThreadId: args.providerThreadId }
      : {}),
    ...(args.execution ? { options: args.execution } : {}),
  };
}

export async function queueReadyThreadTurnCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: ReadyThreadCommandEnvironment;
    eventSequence: number;
    execution: ThreadExecutionOptions;
    input: PromptInput[];
    thread: Thread;
  },
): Promise<void> {
  const providerThreadId = getLastProviderThreadId(deps, args.thread.id);
  if (providerThreadId) {
    await queueTurnRunCommand(deps, {
      thread: args.thread,
      input: args.input,
      eventSequence: args.eventSequence,
      execution: args.execution,
      environment: {
        id: args.environment.id,
        hostId: args.environment.hostId,
        path: args.environment.path,
      },
      providerThreadId,
    });
    return;
  }

  await queueThreadStartCommand(deps, {
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
}

export async function queueTurnRunCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence: number;
    environment: ThreadCommandEnvironment;
    execution: ThreadExecutionOptions;
    input: PromptInput[];
    providerThreadId?: string;
    thread: Thread;
  },
): Promise<void> {
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  const providerThreadId =
    args.providerThreadId ?? getLastProviderThreadId(deps, args.thread.id) ?? undefined;
  const runtimeContext = await buildThreadRuntimeContext(deps, {
    thread: args.thread,
    environment: args.environment,
    execution: args.execution,
    providerThreadId,
  });
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "turn.run",
    payload: JSON.stringify({
      type: "turn.run",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      eventSequence: args.eventSequence,
      workspacePath: runtimeContext.workspacePath,
      projectId: runtimeContext.projectId,
      projectName: runtimeContext.projectName,
      projectRootPath: runtimeContext.projectRootPath,
      providerId: runtimeContext.providerId,
      threadType: runtimeContext.threadType,
      ...(runtimeContext.providerThreadId
        ? { providerThreadId: runtimeContext.providerThreadId }
        : {}),
      input: args.input,
      ...(runtimeContext.options ? { options: runtimeContext.options } : {}),
    }),
  });

  if (args.thread.status === "idle") {
    transitionThreadStatus(deps.db, deps.hub, args.thread.id, "active");
  }
}

export async function queueTurnSteerCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence: number;
    environment: ThreadCommandEnvironment;
    execution: ThreadExecutionOptions;
    expectedTurnId: string;
    input: PromptInput[];
    providerThreadId?: string;
    thread: Thread;
  },
): Promise<void> {
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  const providerThreadId =
    args.providerThreadId ?? getLastProviderThreadId(deps, args.thread.id) ?? undefined;
  const runtimeContext = await buildThreadRuntimeContext(deps, {
    thread: args.thread,
    environment: args.environment,
    execution: args.execution,
    providerThreadId,
  });
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "turn.steer",
    payload: JSON.stringify({
      type: "turn.steer",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      eventSequence: args.eventSequence,
      workspacePath: runtimeContext.workspacePath,
      projectId: runtimeContext.projectId,
      projectName: runtimeContext.projectName,
      projectRootPath: runtimeContext.projectRootPath,
      providerId: runtimeContext.providerId,
      threadType: runtimeContext.threadType,
      ...(runtimeContext.providerThreadId
        ? { providerThreadId: runtimeContext.providerThreadId }
        : {}),
      expectedTurnId: args.expectedTurnId,
      input: args.input,
      ...(runtimeContext.options ? { options: runtimeContext.options } : {}),
    }),
  });
}

export function queueThreadRenameCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: {
      hostId: string;
      id: string;
    };
    threadId: string;
    title: string;
  },
): void {
  const session = getActiveSession(deps.db, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session?.id ?? null,
    type: "thread.rename",
    payload: JSON.stringify({
      type: "thread.rename",
      environmentId: args.environment.id,
      threadId: args.threadId,
      title: args.title,
    }),
  });
}

export function queueThreadStopCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: {
      hostId: string;
      id: string;
    };
    threadId: string;
  },
): void {
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "thread.stop",
    payload: JSON.stringify({
      type: "thread.stop",
      environmentId: args.environment.id,
      threadId: args.threadId,
    }),
  });
}
