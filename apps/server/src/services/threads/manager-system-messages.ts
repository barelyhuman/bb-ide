import {
  getThread,
  hasPendingHostCommandForThread,
  transitionThreadStatusInTransaction,
  type DbTransaction,
} from "@bb/db";
import type {
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  ensureThreadNativeArchiveSettled,
  prepareTurnSubmitCommandPayload,
  queueTurnSubmitCommandInTransaction,
  type PreparedTurnSubmitCommandPayload,
} from "./thread-commands.js";
import {
  ensureThreadCanQueueStartRequest,
  prepareReadyThreadTurnCommand,
  queuePreparedReadyThreadTurnCommandInTransaction,
} from "./thread-lifecycle.js";
import {
  appendClientTurnEventInTransaction,
  appendPreparedClientTurnRequestedEventInTransaction,
  createClientTurnRequestId,
  getActiveTurnId,
} from "./thread-events.js";
import {
  queueTurnDuringReprovision,
  requireReadyThreadEnvironment,
  type ReadyThreadEnvironment,
} from "./thread-turn-dispatch.js";
import {
  type ManagerDynamicFileDeliveryStateUpdate,
  prependManagerPreferencesSystemMessageIfChanged,
  recordManagerDynamicFileDelivery,
  recordManagerDynamicFileDeliveryInTransaction,
  withManagerPreferencesDeliveryLock,
} from "./manager-dynamic-file-delivery.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

const MANAGER_SYSTEM_MESSAGE_SOURCE = "tell";

interface QueueManagerSystemMessageArgs {
  managerThreadId: string;
  messageText: string;
}

interface QueueReadyManagerSystemMessageArgs {
  environment: ReadyThreadEnvironment;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  stateUpdate: ManagerDynamicFileDeliveryStateUpdate | null;
  thread: Thread;
}

interface QueueActiveManagerSystemMessageInTransactionArgs
  extends QueueReadyManagerSystemMessageArgs {
  sessionId: string;
  preparedCommand: PreparedTurnSubmitCommandPayload;
}

function buildSystemInput(messageText: string): PromptInput[] {
  return [{ type: "text", text: messageText }];
}

function hasPendingActiveManagerCommand(
  db: DbTransaction,
  args: QueueReadyManagerSystemMessageArgs,
): boolean {
  return (
    hasPendingHostCommandForThread(db, {
      hostId: args.environment.hostId,
      threadId: args.thread.id,
      type: "turn.submit",
    }) ||
    hasPendingHostCommandForThread(db, {
      hostId: args.environment.hostId,
      threadId: args.thread.id,
      type: "thread.archive",
    }) ||
    hasPendingHostCommandForThread(db, {
      hostId: args.environment.hostId,
      threadId: args.thread.id,
      type: "thread.stop",
    })
  );
}

function queueActiveManagerSystemMessageInTransaction(
  tx: DbTransaction,
  args: QueueActiveManagerSystemMessageInTransactionArgs,
): boolean {
  const currentThread = getThread(tx, args.thread.id);
  if (
    !currentThread ||
    currentThread.type !== "manager" ||
    currentThread.environmentId !== args.environment.id ||
    currentThread.status !== "active" ||
    currentThread.archivedAt !== null ||
    currentThread.deletedAt !== null ||
    currentThread.stopRequestedAt !== null ||
    hasPendingActiveManagerCommand(tx, args)
  ) {
    return false;
  }

  const expectedSteerTurnId = getActiveTurnId({ db: tx }, args.thread.id);
  const request = appendClientTurnEventInTransaction(tx, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    type: "client/turn/requested",
    input: args.input,
    execution: args.execution,
    initiator: "system",
    senderThreadId: null,
    requestMethod: "turn/start",
    source: MANAGER_SYSTEM_MESSAGE_SOURCE,
    target: {
      kind: "auto",
      expectedTurnId: expectedSteerTurnId,
    },
  });
  recordManagerDynamicFileDeliveryInTransaction(tx, args.stateUpdate);
  queueTurnSubmitCommandInTransaction(tx, {
    command: addRequestIdToTurnSubmitCommandPayload({
      requestId: request.requestId,
      preparedCommand: {
        ...args.preparedCommand,
        target: {
          mode: "auto",
          expectedTurnId: expectedSteerTurnId,
        },
      },
    }),
    hostId: args.environment.hostId,
    requestEventSequence: request.sequence,
    sessionId: args.sessionId,
  });
  return true;
}

async function queueActiveManagerSystemMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueReadyManagerSystemMessageArgs,
): Promise<boolean> {
  const expectedSteerTurnId = getActiveTurnId(deps, args.thread.id);
  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    thread: args.thread,
    input: args.input,
    execution: args.execution,
    permissionEscalation,
    target: {
      mode: "auto",
      expectedTurnId: expectedSteerTurnId,
    },
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      cleanupRequestedAt: args.environment.cleanupRequestedAt,
      path: args.environment.path,
      status: args.environment.status,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
  });

  const queued = deps.db.transaction(
    (tx) =>
      queueActiveManagerSystemMessageInTransaction(tx, {
        ...args,
        preparedCommand,
        sessionId: session.id,
      }),
    { behavior: "immediate" },
  );
  if (!queued) {
    return false;
  }

  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["client/turn/requested"],
  });
  deps.hub.notifyCommand(args.environment.hostId);
  return true;
}

async function queueReadyManagerSystemMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueReadyManagerSystemMessageArgs,
): Promise<boolean> {
  if (args.thread.status === "active") {
    return queueActiveManagerSystemMessage(deps, args);
  }

  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const requestId = createClientTurnRequestId();

  const command = await prepareReadyThreadTurnCommand(deps, {
    thread: args.thread,
    input: args.input,
    requestId,
    execution: args.execution,
    permissionEscalation,
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      cleanupRequestedAt: args.environment.cleanupRequestedAt,
      path: args.environment.path,
      status: args.environment.status,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
  });
  let transitioned = false;
  deps.db.transaction(
    (tx) => {
      ensureThreadCanQueueStartRequest({ db: tx }, args.thread);
      const request = appendPreparedClientTurnRequestedEventInTransaction(tx, {
        threadId: args.thread.id,
        environmentId: args.environment.id,
        type: "client/turn/requested",
        input: args.input,
        execution: args.execution,
        initiator: "system",
        senderThreadId: null,
        requestMethod: "turn/start",
        source: MANAGER_SYSTEM_MESSAGE_SOURCE,
        target: { kind: "new-turn" },
        requestId,
      });
      const queuedMode = queuePreparedReadyThreadTurnCommandInTransaction(tx, {
        command,
        hostId: args.environment.hostId,
        requestEventSequence: request.sequence,
        thread: args.thread,
      });
      if (queuedMode === "turn.submit") {
        transitionThreadStatusInTransaction(tx, {
          id: args.thread.id,
          newStatus: "active",
        });
        transitioned = true;
      }
      recordManagerDynamicFileDeliveryInTransaction(tx, args.stateUpdate);
    },
    { behavior: "immediate" },
  );
  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["client/turn/requested"],
  });
  deps.hub.notifyCommand(args.environment.hostId);
  if (transitioned) {
    deps.hub.notifyThread(args.thread.id, ["status-changed"], {
      projectId: args.thread.projectId,
    });
  }
  return true;
}

export async function queueManagerSystemMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagerSystemMessageArgs,
): Promise<boolean> {
  const managerThread = getThread(deps.db, args.managerThreadId);
  if (
    !managerThread ||
    managerThread.type !== "manager" ||
    managerThread.archivedAt !== null ||
    managerThread.deletedAt !== null
  ) {
    return false;
  }
  if (deps.pendingInteractions.hasPendingThreadInteraction(managerThread.id)) {
    return false;
  }

  const { environment } = requireThreadEnvironment(
    deps.db,
    args.managerThreadId,
  );
  ensureThreadNativeArchiveSettled(deps, {
    environment,
    thread: managerThread,
  });
  const input = buildSystemInput(args.messageText);
  const execution = await buildExecutionOptions(
    deps,
    {},
    {
      threadId: managerThread.id,
    },
    "client/turn/requested",
  );
  return await withManagerPreferencesDeliveryLock(
    { thread: managerThread },
    async () => {
      const preparedInput =
        await prependManagerPreferencesSystemMessageIfChanged(deps, {
          hostId: environment.hostId,
          input,
          thread: managerThread,
        });

      if (
        await queueTurnDuringReprovision({
          deps,
          environment,
          execution,
          initiator: "system",
          input: preparedInput.input,
          senderThreadId: null,
          thread: managerThread,
        })
      ) {
        recordManagerDynamicFileDelivery(deps, preparedInput.stateUpdate);
        return true;
      }

      const readyEnvironment = requireReadyThreadEnvironment(environment);
      return await queueReadyManagerSystemMessage(deps, {
        thread: managerThread,
        input: preparedInput.input,
        stateUpdate: preparedInput.stateUpdate,
        execution,
        environment: readyEnvironment,
      });
    },
  );
}
