import {
  getThread,
  transitionThreadStatusInTransaction,
  type DbTransaction,
} from "@bb/db";
import type {
  PromptInput,
  PromptMentionResource,
  PromptTextMention,
  ResolvedThreadExecutionOptions,
  Thread,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
  type PreparedTurnSubmitCommandPayload,
} from "./thread-commands.js";
import {
  ensureThreadCanStartRequest,
  prepareReadyThreadTurnCommand,
  prepareReadyThreadTurnDispatchInTransaction,
} from "./thread-lifecycle.js";
import {
  appendClientTurnEventInTransaction,
  appendPreparedClientTurnRequestedEventInTransaction,
  createClientTurnRequestId,
  getActiveTurnId,
} from "./thread-events.js";
import {
  dispatchTurnDuringReprovision,
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
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";

const MANAGER_SYSTEM_MESSAGE_SOURCE = "tell";

interface QueueManagerSystemMessageArgs {
  input: PromptInput[];
  managerThreadId: string;
}

export interface ManagerSystemRenderedMention {
  resource: PromptMentionResource;
  serializedText: string;
}

interface BuildManagerSystemInputArgs {
  mentions: readonly ManagerSystemRenderedMention[];
  text: string;
}

interface ManagerSystemTextSegment {
  kind: "text";
  text: string;
}

interface ManagerSystemMentionSegment {
  kind: "mention";
  mention: ManagerSystemRenderedMention;
}

export type ManagerSystemInputSegment =
  | ManagerSystemTextSegment
  | ManagerSystemMentionSegment;

interface BuildManagerSystemInputFromSegmentsArgs {
  segments: readonly ManagerSystemInputSegment[];
}

interface BuildManagerSystemInputFromTemplateSlotArgs {
  renderedText: string;
  segments: readonly ManagerSystemInputSegment[];
  slot: string;
}

interface BuildPlainManagerSystemInputArgs {
  text: string;
}

interface BuildManagerSystemThreadMentionArgs {
  thread: Thread;
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

interface QueueActiveManagerSystemMessageResult {
  command: Extract<HostDaemonCommand, { type: "turn.submit" }> | null;
  queued: boolean;
}

interface RenderedManagerSystemSlotParts {
  prefix: string;
  suffix: string;
}

function splitRenderedManagerSystemSlot(
  args: BuildManagerSystemInputFromTemplateSlotArgs,
): RenderedManagerSystemSlotParts {
  const start = args.renderedText.indexOf(args.slot);
  if (start === -1) {
    throw new Error("Manager system template slot was not found in message");
  }
  const next = args.renderedText.indexOf(args.slot, start + args.slot.length);
  if (next !== -1) {
    throw new Error("Manager system template slot must be unique in message");
  }

  return {
    prefix: args.renderedText.slice(0, start),
    suffix: args.renderedText.slice(start + args.slot.length),
  };
}

export function buildPlainManagerSystemInput(
  args: BuildPlainManagerSystemInputArgs,
): PromptInput[] {
  return [{ type: "text", text: args.text, mentions: [] }];
}

export function buildManagerSystemInput(
  args: BuildManagerSystemInputArgs,
): PromptInput[] {
  let searchStart = 0;
  const promptMentions: PromptTextMention[] = [];
  for (const mention of args.mentions) {
    if (mention.serializedText.length === 0) {
      throw new Error("Manager system mention text must not be empty");
    }
    const start = args.text.indexOf(mention.serializedText, searchStart);
    if (start === -1) {
      throw new Error("Manager system mention text was not found in message");
    }
    const end = start + mention.serializedText.length;
    promptMentions.push({
      start,
      end,
      resource: mention.resource,
    });
    searchStart = end;
  }

  return [{ type: "text", text: args.text, mentions: promptMentions }];
}

export function buildManagerSystemInputFromSegments(
  args: BuildManagerSystemInputFromSegmentsArgs,
): PromptInput[] {
  let text = "";
  const promptMentions: PromptTextMention[] = [];

  for (const segment of args.segments) {
    if (segment.kind === "text") {
      text += segment.text;
      continue;
    }

    if (segment.mention.serializedText.length === 0) {
      throw new Error("Manager system mention text must not be empty");
    }
    const start = text.length;
    text += segment.mention.serializedText;
    promptMentions.push({
      start,
      end: text.length,
      resource: segment.mention.resource,
    });
  }

  return [{ type: "text", text, mentions: promptMentions }];
}

export function buildManagerSystemInputFromTemplateSlot(
  args: BuildManagerSystemInputFromTemplateSlotArgs,
): PromptInput[] {
  const parts = splitRenderedManagerSystemSlot(args);
  return buildManagerSystemInputFromSegments({
    segments: [
      { kind: "text", text: parts.prefix },
      ...args.segments,
      { kind: "text", text: parts.suffix },
    ],
  });
}

export function buildManagerSystemThreadMention(
  args: BuildManagerSystemThreadMentionArgs,
): ManagerSystemRenderedMention {
  const label = args.thread.title?.trim() || args.thread.id;
  return {
    serializedText: `@thread:${args.thread.id}`,
    resource: {
      kind: "thread",
      label,
      projectId: args.thread.projectId,
      threadId: args.thread.id,
      threadType: args.thread.type,
    },
  };
}

function queueActiveManagerSystemMessageInTransaction(
  tx: DbTransaction,
  args: QueueActiveManagerSystemMessageInTransactionArgs,
): QueueActiveManagerSystemMessageResult {
  const currentThread = getThread(tx, args.thread.id);
  if (
    !currentThread ||
    currentThread.type !== "manager" ||
    currentThread.environmentId !== args.environment.id ||
    currentThread.status !== "active" ||
    currentThread.archivedAt !== null ||
    currentThread.deletedAt !== null ||
    currentThread.stopRequestedAt !== null
  ) {
    return { command: null, queued: false };
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
  return {
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
    queued: true,
  };
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
  if (!queued.queued || !queued.command) {
    return false;
  }

  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["client/turn/requested"],
  });
  startLiveHostCommand(deps, {
    command: queued.command,
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: (error) => {
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        "Live active manager system message command failed",
      );
    },
  });
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
    syncGeneratedTitle: false,
  });
  let transitioned = false;
  deps.db.transaction(
    (tx) => {
      ensureThreadCanStartRequest(args.thread);
      appendPreparedClientTurnRequestedEventInTransaction(tx, {
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
      const dispatchKind = prepareReadyThreadTurnDispatchInTransaction(tx, {
        command,
        thread: args.thread,
      });
      if (dispatchKind === "turn.submit") {
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
  startLiveHostCommand(deps, {
    command: command.command,
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: (error) => {
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        "Live manager system message command failed",
      );
    },
  });
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
          input: args.input,
          thread: managerThread,
        });

      if (
        await dispatchTurnDuringReprovision({
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
