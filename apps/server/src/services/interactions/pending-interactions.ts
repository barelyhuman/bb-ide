import {
  createPendingInteraction,
  deleteQueuedCommandInTransaction,
  getActivePendingInteractionForThread,
  getEnvironment,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  interruptPendingInteractionsForSessionIds,
  getThread,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listPendingInteractionsByThread,
  queueCommandInTransaction,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
  type PendingInteractionRow,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import {
  isApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionCreate,
  type PendingInteractionResolution,
  type ThreadChangeMetadata,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { productionErrorLogFields } from "../lib/error-log-fields.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import {
  appendPendingInteractionTimelineEvent,
  appendPendingInteractionTimelineEventInTransaction,
} from "./pending-interaction-timeline.js";
import {
  PendingInteractionSerializationError,
  toPendingInteraction,
} from "./pending-interaction-serialization.js";
import {
  pendingInteractionResolutionEquals,
  validatePendingInteractionResolution,
} from "./pending-interaction-validation.js";

export type RegisterPendingInteractionResult =
  | {
      outcome: "created" | "existing";
      interaction: PendingInteraction;
    }
  | {
      outcome: "rejected";
      reason: string;
    };

interface RegisterPendingInteractionArgs {
  interaction: PendingInteractionCreate;
  sessionId: string;
}

interface ResolvePendingInteractionArgs {
  interactionId: string;
  resolution: PendingInteractionResolution;
  threadId: string;
}

interface QueueInteractionResolutionCommandArgs {
  interaction: PendingInteraction;
  resolution: PendingInteractionResolution;
  sessionId: string;
}

interface CompleteResolvingInteractionArgs {
  interactionId: string;
  resolution: PendingInteractionResolution;
}

interface BuildInteractiveResolveCommandArgs {
  environmentId: string;
  interaction: PendingInteraction;
  resolution: PendingInteractionResolution;
}

interface GetThreadInteractionArgs {
  interactionId: string;
  threadId: string;
}

interface InterruptPendingInteractionArgs {
  interactionId: string;
  reason: string;
}

interface PendingInteractionTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface BuildInteractionChangeMetadataArgs {
  db: AppDeps["db"] | DbTransaction;
  hasPendingInteraction: boolean;
  threadId: string;
}

interface InteractionChangeNotificationDeps {
  db: AppDeps["db"] | DbTransaction;
  hub: DbNotifier;
}

interface NotifyInteractionChangedArgs {
  deps: InteractionChangeNotificationDeps;
  hasPendingInteraction: boolean;
  threadId: string;
}

interface InterruptPendingInteractionsForThreadsLifecycleArgs {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

interface InterruptPendingInteractionsForThreadIdsLifecycleArgs {
  reason: string;
  threadIds: readonly string[];
}

interface InterruptPendingInteractionsForSessionIdsLifecycleArgs {
  reason: string;
  sessionIds: readonly string[];
}

interface CreateLifecycleDeps {
  db: AppDeps["db"];
  hub: AppDeps["hub"];
  logger: AppDeps["logger"];
}

function buildResolveConflictError(interaction: PendingInteraction): ApiError {
  return new ApiError(
    409,
    "invalid_request",
    `Pending interaction ${interaction.id} is already ${interaction.status}`,
  );
}

function getUnsupportedPendingInteractionReason(
  interaction: PendingInteractionCreate,
): string | null {
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return null;
  }
  if (interaction.payload.availableDecisions.length === 0) {
    return "Approvals must include at least one available decision";
  }

  return null;
}

function buildInteractiveResolveCommand(
  args: BuildInteractiveResolveCommandArgs,
): Extract<HostDaemonCommand, { type: "interactive.resolve" }> {
  return {
    type: "interactive.resolve",
    environmentId: args.environmentId,
    threadId: args.interaction.threadId,
    interactionId: args.interaction.id,
    providerId: args.interaction.providerId,
    providerThreadId: args.interaction.providerThreadId,
    providerRequestId: args.interaction.providerRequestId,
    resolution: args.resolution,
  };
}

type PendingInteractionLifecycleArgs = CreateLifecycleDeps;

function buildInteractionChangeMetadata({
  db,
  hasPendingInteraction,
  threadId,
}: BuildInteractionChangeMetadataArgs): ThreadChangeMetadata | undefined {
  const thread = getThread(db, threadId);
  if (!thread) {
    return undefined;
  }
  return {
    hasPendingInteraction,
    projectId: thread.projectId,
  };
}

function notifyInteractionChanged({
  deps,
  hasPendingInteraction,
  threadId,
}: NotifyInteractionChangedArgs): void {
  deps.hub.notifyThread(
    threadId,
    ["interactions-changed"],
    buildInteractionChangeMetadata({
      db: deps.db,
      hasPendingInteraction,
      threadId,
    }),
  );
}

/**
 * Owns the server-side pending interaction lifecycle: registration, resolution
 * command queuing, terminal state transitions, and timeline events.
 */
export class PendingInteractionLifecycle {
  private readonly deps: CreateLifecycleDeps;
  private started = false;

  constructor(args: PendingInteractionLifecycleArgs) {
    this.deps = {
      db: args.db,
      hub: args.hub,
      logger: args.logger,
    };
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
  }

  listThreadInteractions(threadId: string): PendingInteraction[] {
    return this.parseListRows(
      listPendingInteractionsByThread(this.deps.db, { threadId }),
    );
  }

  listPendingThreadInteractions(threadId: string): PendingInteraction[] {
    return this.parseListRows(
      listPendingInteractionsByThread(this.deps.db, {
        threadId,
        statuses: ["pending", "resolving"],
      }),
    );
  }

  getThreadInteraction(args: GetThreadInteractionArgs): PendingInteraction {
    const interaction = this.requireInteraction(args.interactionId);
    if (interaction.threadId !== args.threadId) {
      throw new ApiError(
        404,
        "invalid_request",
        "Pending interaction not found",
      );
    }
    return interaction;
  }

  hasPendingThreadInteraction(threadId: string): boolean {
    return (
      getActivePendingInteractionForThread(this.deps.db, threadId) !== null
    );
  }

  registerPendingInteraction(
    args: RegisterPendingInteractionArgs,
  ): RegisterPendingInteractionResult {
    const { interaction } = args;
    const thread = getThread(this.deps.db, interaction.threadId);
    if (!thread || thread.deletedAt !== null) {
      return {
        outcome: "rejected",
        reason: "Thread does not exist",
      };
    }
    if (thread.providerId !== interaction.providerId) {
      return {
        outcome: "rejected",
        reason: `Thread ${interaction.threadId} belongs to provider ${thread.providerId}, not ${interaction.providerId}`,
      };
    }
    const unsupportedReason =
      getUnsupportedPendingInteractionReason(interaction);
    if (unsupportedReason) {
      return {
        outcome: "rejected",
        reason: unsupportedReason,
      };
    }

    const registered = this.deps.db.transaction((tx) => {
      const existing = getPendingInteractionByProviderRequest(tx, {
        providerId: interaction.providerId,
        providerThreadId: interaction.providerThreadId,
        providerRequestId: interaction.providerRequestId,
        sessionId: args.sessionId,
      });
      if (existing) {
        if (existing.status !== "pending" && existing.status !== "resolving") {
          return {
            outcome: "rejected" as const,
            reason: `Provider request ${interaction.providerRequestId} was already handled and cannot be reused`,
          };
        }

        return {
          outcome: "existing" as const,
          row: existing,
        };
      }

      const pendingForThread = getActivePendingInteractionForThread(
        tx,
        interaction.threadId,
      );
      if (pendingForThread) {
        return {
          outcome: "rejected" as const,
          reason: `Thread ${interaction.threadId} is already awaiting user interaction`,
        };
      }

      return {
        outcome: "created" as const,
        row: createPendingInteraction(tx, {
          threadId: interaction.threadId,
          turnId: interaction.turnId,
          providerId: interaction.providerId,
          providerThreadId: interaction.providerThreadId,
          providerRequestId: interaction.providerRequestId,
          sessionId: args.sessionId,
          payload: JSON.stringify(interaction.payload),
        }),
      };
    });

    if (registered.outcome === "rejected") {
      return registered;
    }

    const pendingInteraction = toPendingInteraction(registered.row);

    if (registered.outcome === "created") {
      appendPendingInteractionTimelineEvent(this.deps, pendingInteraction);
      notifyInteractionChanged({
        deps: this.deps,
        hasPendingInteraction: true,
        threadId: pendingInteraction.threadId,
      });
    }

    return {
      outcome: registered.outcome,
      interaction: pendingInteraction,
    };
  }

  resolvePendingInteraction(
    args: ResolvePendingInteractionArgs,
  ): PendingInteraction {
    const currentRow = this.requireInteractionRow(args.interactionId);
    const current = toPendingInteraction(currentRow);
    if (current.threadId !== args.threadId) {
      throw new ApiError(
        404,
        "invalid_request",
        "Pending interaction not found",
      );
    }
    if (current.status !== "pending") {
      if (
        (current.status === "resolving" || current.status === "resolved") &&
        pendingInteractionResolutionEquals(current.resolution, args.resolution)
      ) {
        return current;
      }

      throw buildResolveConflictError(current);
    }
    validatePendingInteractionResolution(current, args.resolution);

    const updated = this.queueInteractionResolutionCommand({
      interaction: current,
      resolution: args.resolution,
      sessionId: currentRow.sessionId,
    });
    if (!updated) {
      const latest = this.getThreadInteraction({
        threadId: args.threadId,
        interactionId: args.interactionId,
      });
      if (
        (latest.status === "resolving" || latest.status === "resolved") &&
        pendingInteractionResolutionEquals(latest.resolution, args.resolution)
      ) {
        return latest;
      }

      throw buildResolveConflictError(latest);
    }

    const interaction = toPendingInteraction(updated);
    this.settleInteractionTerminalState(interaction);
    return interaction;
  }

  completeResolvingInteraction(
    args: CompleteResolvingInteractionArgs,
  ): PendingInteraction | null {
    const updated = setPendingInteractionResolved(this.deps.db, {
      id: args.interactionId,
      resolution: JSON.stringify(args.resolution),
    });
    if (!updated) {
      return null;
    }

    const interaction = toPendingInteraction(updated);
    this.settleInteractionTerminalState(interaction);
    return interaction;
  }

  completeResolvingInteractionInTransaction(
    deps: PendingInteractionTransactionDeps,
    args: CompleteResolvingInteractionArgs,
  ): PendingInteraction | null {
    const updated = setPendingInteractionResolved(deps.db, {
      id: args.interactionId,
      resolution: JSON.stringify(args.resolution),
    });
    if (!updated) {
      return null;
    }

    const interaction = toPendingInteraction(updated);
    this.settleInteractionTerminalStateInTransaction(deps, interaction);
    return interaction;
  }

  interruptPendingInteraction(
    args: InterruptPendingInteractionArgs,
  ): PendingInteraction | null {
    const updated = setPendingInteractionInterrupted(this.deps.db, {
      id: args.interactionId,
      statusReason: args.reason,
    });
    if (!updated) {
      return null;
    }

    const interaction = toPendingInteraction(updated);
    this.settleInteractionTerminalState(interaction);
    return interaction;
  }

  interruptPendingInteractionInTransaction(
    deps: PendingInteractionTransactionDeps,
    args: InterruptPendingInteractionArgs,
  ): PendingInteraction | null {
    const updated = setPendingInteractionInterrupted(deps.db, {
      id: args.interactionId,
      statusReason: args.reason,
    });
    if (!updated) {
      return null;
    }

    const interaction = toPendingInteraction(updated);
    this.settleInteractionTerminalStateInTransaction(deps, interaction);
    return interaction;
  }

  interruptPendingInteractionsForThreads(
    args: InterruptPendingInteractionsForThreadsLifecycleArgs,
  ): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForThreads(this.deps.db, {
        providerId: args.providerId,
        threadIds: args.threadIds,
        statusReason: args.reason,
      }),
    );
  }

  interruptPendingInteractionsForThreadIds(
    args: InterruptPendingInteractionsForThreadIdsLifecycleArgs,
  ): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForThreadIds(this.deps.db, {
        threadIds: args.threadIds,
        statusReason: args.reason,
      }),
    );
  }

  interruptPendingInteractionsForThreadIdsInTransaction(
    deps: PendingInteractionTransactionDeps,
    args: InterruptPendingInteractionsForThreadIdsLifecycleArgs,
  ): PendingInteraction[] {
    return this.settleInterruptedRowsInTransaction(
      deps,
      interruptPendingInteractionsForThreadIds(deps.db, {
        threadIds: args.threadIds,
        statusReason: args.reason,
      }),
    );
  }

  interruptPendingInteractionsForSessionIds(
    args: InterruptPendingInteractionsForSessionIdsLifecycleArgs,
  ): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForSessionIds(this.deps.db, {
        sessionIds: args.sessionIds,
        statusReason: args.reason,
      }),
    );
  }

  private settleInterruptedRows(
    rows: PendingInteractionRow[],
  ): PendingInteraction[] {
    const interactions = rows.map(toPendingInteraction);
    for (const interaction of interactions) {
      this.settleInteractionTerminalState(interaction);
    }
    return interactions;
  }

  private settleInterruptedRowsInTransaction(
    deps: PendingInteractionTransactionDeps,
    rows: PendingInteractionRow[],
  ): PendingInteraction[] {
    const interactions = rows.map(toPendingInteraction);
    for (const interaction of interactions) {
      this.settleInteractionTerminalStateInTransaction(deps, interaction);
    }
    return interactions;
  }

  private queueInteractionResolutionCommand(
    args: QueueInteractionResolutionCommandArgs,
  ): PendingInteractionRow | null {
    const thread = getThread(this.deps.db, args.interaction.threadId);
    if (!thread?.environmentId) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    }

    const environment = getEnvironment(this.deps.db, thread.environmentId);
    if (!environment) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("destroyed", null),
      );
    }

    const command = buildInteractiveResolveCommand({
      environmentId: environment.id,
      interaction: args.interaction,
      resolution: args.resolution,
    });
    const resolutionJson = JSON.stringify(args.resolution);
    const commandPayload = JSON.stringify(command);
    const updated = this.deps.db.transaction((tx) => {
      const queuedCommand = queueCommandInTransaction(tx, {
        hostId: environment.hostId,
        sessionId: args.sessionId,
        type: command.type,
        payload: commandPayload,
      });
      const resolving = setPendingInteractionResolving(tx, {
        commandId: queuedCommand.id,
        id: args.interaction.id,
        resolution: resolutionJson,
      });
      if (resolving) {
        return resolving;
      }
      deleteQueuedCommandInTransaction(tx, {
        commandId: queuedCommand.id,
      });
      return null;
    });

    if (updated) {
      this.deps.hub.notifyCommand(environment.hostId);
    }

    return updated;
  }

  private requireInteraction(interactionId: string): PendingInteraction {
    return toPendingInteraction(this.requireInteractionRow(interactionId));
  }

  private parseListRows(rows: PendingInteractionRow[]): PendingInteraction[] {
    const interactions: PendingInteraction[] = [];
    for (const row of rows) {
      try {
        interactions.push(toPendingInteraction(row));
      } catch (error) {
        if (error instanceof PendingInteractionSerializationError) {
          this.deps.logger.warn(
            {
              field: error.field,
              interactionId: error.interactionId,
              ...productionErrorLogFields(error),
            },
            "Skipping corrupt pending interaction row",
          );
          continue;
        }
        throw error;
      }
    }
    return interactions;
  }

  private requireInteractionRow(interactionId: string): PendingInteractionRow {
    const interaction = getPendingInteraction(this.deps.db, interactionId);
    if (!interaction) {
      throw new ApiError(
        404,
        "invalid_request",
        "Pending interaction not found",
      );
    }

    return interaction;
  }

  private settleInteractionTerminalState(
    interaction: PendingInteraction,
  ): void {
    appendPendingInteractionTimelineEvent(this.deps, interaction);
    notifyInteractionChanged({
      deps: this.deps,
      hasPendingInteraction: false,
      threadId: interaction.threadId,
    });
  }

  private settleInteractionTerminalStateInTransaction(
    deps: PendingInteractionTransactionDeps,
    interaction: PendingInteraction,
  ): void {
    appendPendingInteractionTimelineEventInTransaction(deps, interaction);
    notifyInteractionChanged({
      deps,
      hasPendingInteraction: false,
      threadId: interaction.threadId,
    });
  }
}
