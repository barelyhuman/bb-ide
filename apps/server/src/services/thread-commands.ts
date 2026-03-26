import { getActiveSession, queueCommand, transitionThreadStatus } from "@bb/db";
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
import { resolveThreadRuntimeConfig } from "./thread-runtime-config.js";
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

export function queueThreadStartCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence?: number;
    environment: {
      hostId: string;
      id: string;
      path: string | null;
    };
    execution: HostDaemonExecutionOptions;
    input?: PromptInput[];
    projectId: string;
    providerId: string;
    thread: Thread;
  },
): void {
  if (!args.environment.path) {
    throw new ApiError(409, "invalid_request", "Environment is not ready");
  }

  const runtimeConfig = resolveThreadRuntimeConfig(deps, {
    environment: {
      path: args.environment.path,
    },
    thread: {
      id: args.thread.id,
      projectId: args.thread.projectId,
      type: args.thread.type,
    },
  });
  const options: HostDaemonExecutionOptions = {
    ...args.execution,
    ...(runtimeConfig.instructions
      ? { instructions: runtimeConfig.instructions }
      : {}),
  };
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "thread.start",
    payload: JSON.stringify({
      type: "thread.start",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      workspacePath: args.environment.path,
      projectId: args.projectId,
      providerId: args.providerId,
      ...(args.eventSequence !== undefined
        ? { eventSequence: args.eventSequence }
        : {}),
      ...(args.input ? { input: args.input } : {}),
      options,
      ...(runtimeConfig.dynamicTools
        ? { dynamicTools: runtimeConfig.dynamicTools }
        : {}),
    }),
  });
}

export function queueStartOrRunCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: {
      hostId: string;
      id: string;
      path: string | null;
    };
    eventSequence: number;
    execution: ThreadExecutionOptions;
    input: PromptInput[];
    projectId: string;
    providerId: string;
    thread: Thread;
  },
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
    projectId: args.projectId,
    providerId: args.providerId,
  });
}

export function queueTurnRunCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence?: number;
    environment: {
      hostId: string;
      id: string;
    };
    execution: ThreadExecutionOptions;
    input: PromptInput[];
    thread: Thread;
  },
): void {
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "turn.run",
    payload: JSON.stringify({
      type: "turn.run",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      ...(args.eventSequence !== undefined
        ? { eventSequence: args.eventSequence }
        : {}),
      input: args.input,
      options: args.execution,
    }),
  });

  if (args.thread.status === "idle") {
    transitionThreadStatus(deps.db, deps.hub, args.thread.id, "active");
  }
}

export function queueTurnSteerCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    eventSequence?: number;
    environment: {
      hostId: string;
      id: string;
    };
    expectedTurnId: string;
    input: PromptInput[];
    thread: Thread;
  },
): void {
  const session = requireConnectedHostSession(deps, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "turn.steer",
    payload: JSON.stringify({
      type: "turn.steer",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      ...(args.eventSequence !== undefined
        ? { eventSequence: args.eventSequence }
        : {}),
      expectedTurnId: args.expectedTurnId,
      input: args.input,
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
