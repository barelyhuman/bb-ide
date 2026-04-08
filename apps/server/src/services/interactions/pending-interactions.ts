import {
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  getThread,
  interruptPendingInteractionsForThreads,
  listPendingInteractionsByThread,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  type PendingInteractionRow,
} from "@bb/db";
import {
  pendingInteractionPayloadSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
  type PendingInteraction,
  type PendingInteractionCommandApprovalDecision,
  type PendingInteractionCreate,
  type PendingInteractionResolution,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { appendThreadEvent } from "../threads/thread-events.js";

interface PendingInteractionWaiter {
  resolve: (outcome: PendingInteractionWaitOutcome) => void;
}

interface WaitForTerminalStateArgs {
  abortReason?: string;
  interactionId: string;
  signal?: AbortSignal;
}

export type PendingInteractionWaitOutcome =
  | {
      outcome: "expired" | "interrupted" | "rejected";
      interaction: PendingInteraction;
      reason: string;
    }
  | {
      outcome: "resolved";
      interaction: PendingInteraction;
      resolution: PendingInteractionResolution;
    };

export type RegisterPendingInteractionResult =
  | {
      outcome: "created" | "existing";
      interaction: PendingInteraction;
    }
  | {
      outcome: "rejected";
      reason: string;
    };

interface ResolvePendingInteractionArgs {
  interactionId: string;
  resolution: PendingInteractionResolution;
  threadId: string;
}

interface InterruptPendingInteractionArgs {
  interactionId: string;
  reason: string;
}

interface InterruptPendingInteractionsForThreadsLifecycleArgs {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

interface CreateLifecycleDeps {
  db: AppDeps["db"];
  hub: AppDeps["hub"];
}

function parseStoredPendingInteractionJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(500, "internal_error", "Stored pending interaction JSON is invalid");
  }
}

function toPendingInteraction(row: PendingInteractionRow): PendingInteraction {
  const payload = pendingInteractionPayloadSchema.parse(
    parseStoredPendingInteractionJson(row.payload),
  );
  const resolution =
    row.resolution === null
      ? null
      : pendingInteractionResolutionSchema.parse(
          parseStoredPendingInteractionJson(row.resolution),
        );

  return pendingInteractionSchema.parse({
    id: row.id,
    threadId: row.threadId,
    turnId: row.turnId,
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    providerRequestId: row.providerRequestId,
    providerRequestMethod: row.providerRequestMethod,
    status: row.status,
    payload,
    resolution,
    statusReason: row.statusReason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  });
}

function requireWaitableOutcome(
  interaction: PendingInteraction,
): PendingInteractionWaitOutcome | null {
  switch (interaction.status) {
    case "pending":
      return null;
    case "resolved":
      if (interaction.resolution === null) {
        throw new ApiError(
          500,
          "internal_error",
          `Pending interaction ${interaction.id} is resolved without a resolution payload`,
        );
      }
      return {
        outcome: "resolved",
        interaction,
        resolution: interaction.resolution,
      };
    case "interrupted":
    case "expired":
    case "rejected":
      return {
        outcome: interaction.status,
        interaction,
        reason: interaction.statusReason ?? `Pending interaction ${interaction.id} ${interaction.status}`,
      };
    default:
      throw new Error(`Unsupported pending interaction status: ${interaction.status}`);
  }
}

function notifyInteractionChanged(
  deps: CreateLifecycleDeps,
  threadId: string,
): void {
  deps.hub.notifyThread(threadId, ["interactions-changed"]);
}

function commandApprovalDecisionEquals(
  left: PendingInteractionCommandApprovalDecision,
  right: PendingInteractionCommandApprovalDecision,
): boolean {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }

  if (left.kind !== right.kind) {
    return false;
  }

  if (
    left.kind === "accept_with_exec_policy_amendment"
    && right.kind === "accept_with_exec_policy_amendment"
  ) {
    return (
      left.execPolicyAmendment.length === right.execPolicyAmendment.length
      && left.execPolicyAmendment.every(
        (entry, index) => entry === right.execPolicyAmendment[index],
      )
    );
  }

  if (
    left.kind === "apply_network_policy_amendment"
    && right.kind === "apply_network_policy_amendment"
  ) {
    return (
      left.networkPolicyAmendment.host === right.networkPolicyAmendment.host
      && left.networkPolicyAmendment.action === right.networkPolicyAmendment.action
    );
  }

  return false;
}

function formatCommandApprovalDecisionLabel(
  decision: PendingInteractionCommandApprovalDecision,
): string {
  if (typeof decision === "string") {
    return decision;
  }

  switch (decision.kind) {
    case "accept_with_exec_policy_amendment":
      return decision.kind;
    case "apply_network_policy_amendment":
      return decision.kind;
  }
}

function formatCommandApprovalResolutionMessage(
  decision: PendingInteractionCommandApprovalDecision,
): string {
  if (typeof decision === "string") {
    switch (decision) {
      case "accept":
        return "Command approved";
      case "accept_for_session":
        return "Command approved for this session";
      case "decline":
        return "Command declined";
      case "cancel":
        return "Command request cancelled";
    }
  }

  switch (decision.kind) {
    case "accept_with_exec_policy_amendment":
      return "Command approved with exec policy amendment";
    case "apply_network_policy_amendment":
      return "Command approved with network policy amendment";
  }
}

function formatPendingInteractionLifecycleMessage(
  interaction: PendingInteraction,
): string {
  switch (interaction.status) {
    case "pending": {
      switch (interaction.payload.kind) {
        case "command_approval":
          return interaction.payload.command
            ? `Awaiting approval for command: ${interaction.payload.command}`
            : "Awaiting command approval";
        case "file_change_approval":
          return interaction.payload.reason ?? "Awaiting file-change approval";
        case "permission_request":
          return interaction.payload.reason ?? "Awaiting permission approval";
        case "user_input_request":
          return `Awaiting answers to ${interaction.payload.questions.length} question(s)`;
      }
      const exhaustivePayload: never = interaction.payload;
      throw new Error(`Unsupported pending interaction payload: ${String(exhaustivePayload)}`);
    }
    case "resolved":
      if (interaction.resolution === null) {
        return "Interaction resolved";
      }
      switch (interaction.resolution.kind) {
        case "command_approval":
          return formatCommandApprovalResolutionMessage(interaction.resolution.decision);
        case "file_change_approval":
          switch (interaction.resolution.decision) {
            case "accept":
              return "File changes approved";
            case "accept_for_session":
              return "File changes approved for this session";
            case "decline":
              return "File changes declined";
            case "cancel":
              return "File-change request cancelled";
          }
        case "permission_request":
          return `Permissions granted for ${interaction.resolution.scope}`;
        case "user_input_request":
          return `Answered ${Object.keys(interaction.resolution.answers).length} question(s)`;
      }
      const exhaustiveResolution: never = interaction.resolution;
      throw new Error(
        `Unsupported pending interaction resolution: ${String(exhaustiveResolution)}`,
      );
    case "rejected":
      return interaction.statusReason ?? "Interaction rejected";
    case "interrupted":
      return interaction.statusReason ?? "Interaction interrupted";
    case "expired":
      return interaction.statusReason ?? "Interaction expired";
  }

  const exhaustiveStatus: never = interaction.status;
  throw new Error(`Unsupported pending interaction status: ${String(exhaustiveStatus)}`);
}

function toPendingInteractionOperationStatus(
  interaction: PendingInteraction,
): "completed" | "failed" | "started" {
  switch (interaction.status) {
    case "pending":
      return "started";
    case "resolved":
      return "completed";
    case "rejected":
    case "interrupted":
    case "expired":
      return "failed";
  }
}

function appendPendingInteractionTimelineEvent(
  deps: CreateLifecycleDeps,
  interaction: PendingInteraction,
): void {
  const thread = getThread(deps.db, interaction.threadId);

  appendThreadEvent(deps, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/operation",
    data: {
      operation: interaction.payload.kind,
      status: toPendingInteractionOperationStatus(interaction),
      operationId: interaction.id,
      message: formatPendingInteractionLifecycleMessage(interaction),
      metadata: {
        interactionId: interaction.id,
        providerId: interaction.providerId,
        providerRequestId: interaction.providerRequestId,
      },
    },
  });
}

function validateCommandApprovalResolution(
  interaction: PendingInteraction,
  resolution: PendingInteractionResolution,
): void {
  if (
    interaction.payload.kind !== "command_approval"
    || resolution.kind !== "command_approval"
  ) {
    return;
  }

  if (
    interaction.payload.availableDecisions.some((decision) =>
      commandApprovalDecisionEquals(decision, resolution.decision),
    )
  ) {
    return;
  }

  throw new ApiError(
    400,
    "invalid_request",
    `Command approval decision '${formatCommandApprovalDecisionLabel(resolution.decision)}' is not available for interaction ${interaction.id}`,
  );
}

function validateUserInputResolution(
  interaction: PendingInteraction,
  resolution: PendingInteractionResolution,
): void {
  if (
    interaction.payload.kind !== "user_input_request"
    || resolution.kind !== "user_input_request"
  ) {
    return;
  }

  const questions = new Map(
    interaction.payload.questions.map((question) => [question.id, question]),
  );
  const unknownQuestionIds = Object.keys(resolution.answers).filter(
    (questionId) => !questions.has(questionId),
  );
  if (unknownQuestionIds.length > 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unknown question ids: ${unknownQuestionIds.join(", ")}`,
    );
  }

  const missingQuestionIds = interaction.payload.questions
    .map((question) => question.id)
    .filter((questionId) => !(questionId in resolution.answers));
  if (missingQuestionIds.length > 0) {
    throw new ApiError(
      400,
      "invalid_request",
      `Missing answers for question ids: ${missingQuestionIds.join(", ")}`,
    );
  }

  for (const [questionId, answers] of Object.entries(resolution.answers)) {
    if (answers.length > 0) {
      continue;
    }
    throw new ApiError(
      400,
      "invalid_request",
      `Question '${questionId}' requires at least one answer`,
    );
  }
}

function validatePendingInteractionResolution(
  interaction: PendingInteraction,
  resolution: PendingInteractionResolution,
): void {
  if (interaction.payload.kind !== resolution.kind) {
    throw new ApiError(
      400,
      "invalid_request",
      "Pending interaction resolution kind does not match the interaction payload",
    );
  }

  validateCommandApprovalResolution(interaction, resolution);
  validateUserInputResolution(interaction, resolution);
}

export class PendingInteractionLifecycle {
  private readonly waiters = new Map<string, Set<PendingInteractionWaiter>>();

  constructor(private readonly deps: CreateLifecycleDeps) {}

  listThreadInteractions(threadId: string): PendingInteraction[] {
    return listPendingInteractionsByThread(this.deps.db, { threadId }).map(toPendingInteraction);
  }

  listPendingThreadInteractions(threadId: string): PendingInteraction[] {
    return listPendingInteractionsByThread(this.deps.db, {
      threadId,
      statuses: ["pending"],
    }).map(toPendingInteraction);
  }

  getThreadInteraction(args: {
    interactionId: string;
    threadId: string;
  }): PendingInteraction {
    const interaction = this.requireInteraction(args.interactionId);
    if (interaction.threadId !== args.threadId) {
      throw new ApiError(404, "invalid_request", "Pending interaction not found");
    }
    return interaction;
  }

  hasPendingThreadInteraction(threadId: string): boolean {
    return getActivePendingInteractionForThread(this.deps.db, threadId) !== null;
  }

  registerPendingInteraction(
    interaction: PendingInteractionCreate,
  ): RegisterPendingInteractionResult {
    const thread = getThread(this.deps.db, interaction.threadId);
    if (!thread || thread.deletedAt !== null) {
      return {
        outcome: "rejected",
        reason: "Thread does not exist",
      };
    }
    if (thread.parentThreadId !== null) {
      return {
        outcome: "rejected",
        reason: "Pending interactions are only supported on root threads",
      };
    }
    if (interaction.payload.kind === "permission_request") {
      return {
        outcome: "rejected",
        reason: "Permission requests are not supported yet",
      };
    }

    const registered = this.deps.db.transaction((tx) => {
      const existing = getPendingInteractionByProviderRequest(tx, {
        providerId: interaction.providerId,
        providerThreadId: interaction.providerThreadId,
        providerRequestId: interaction.providerRequestId,
      });
      if (existing) {
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
          providerRequestMethod: interaction.providerRequestMethod,
          kind: interaction.payload.kind,
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
      notifyInteractionChanged(this.deps, pendingInteraction.threadId);
    }

    return {
      outcome: registered.outcome,
      interaction: pendingInteraction,
    };
  }

  async waitForTerminalState(
    args: WaitForTerminalStateArgs,
  ): Promise<PendingInteractionWaitOutcome> {
    const interaction = this.requireInteraction(args.interactionId);
    const terminalOutcome = requireWaitableOutcome(interaction);
    if (terminalOutcome) {
      return terminalOutcome;
    }

    return new Promise<PendingInteractionWaitOutcome>((resolve) => {
      const waiter: PendingInteractionWaiter = {
        resolve: (outcome) => {
          this.removeWaiter(args.interactionId, waiter);
          resolve(outcome);
        },
      };

      const resolveCurrentTerminalOutcome = (): void => {
        const current = this.requireInteraction(args.interactionId);
        const currentOutcome = requireWaitableOutcome(current);
        if (!currentOutcome) {
          return;
        }
        waiter.resolve(currentOutcome);
      };

      const onAbort = (): void => {
        const interrupted = this.interruptPendingInteraction({
          interactionId: args.interactionId,
          reason:
            args.abortReason
            ?? "Daemon request ended while awaiting user interaction",
        });
        if (interrupted) {
          return;
        }
        resolveCurrentTerminalOutcome();
      };

      const waiters =
        this.waiters.get(args.interactionId) ?? new Set<PendingInteractionWaiter>();
      waiters.add(waiter);
      this.waiters.set(args.interactionId, waiters);

      if (args.signal) {
        args.signal.addEventListener("abort", onAbort, { once: true });
      }

      if (args.signal?.aborted) {
        onAbort();
        return;
      }

      resolveCurrentTerminalOutcome();
    });
  }

  resolvePendingInteraction(
    args: ResolvePendingInteractionArgs,
  ): PendingInteraction {
    const current = this.getThreadInteraction({
      threadId: args.threadId,
      interactionId: args.interactionId,
    });
    if (current.status !== "pending") {
      return current;
    }
    validatePendingInteractionResolution(current, args.resolution);

    const updated = setPendingInteractionResolved(this.deps.db, {
      id: args.interactionId,
      resolution: JSON.stringify(args.resolution),
    });
    const interaction = updated
      ? toPendingInteraction(updated)
      : this.getThreadInteraction({
          threadId: args.threadId,
          interactionId: args.interactionId,
        });
    this.finishInteraction(interaction);
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
    this.finishInteraction(interaction);
    return interaction;
  }

  interruptPendingInteractionsForThreads(
    args: InterruptPendingInteractionsForThreadsLifecycleArgs,
  ): PendingInteraction[] {
    const updated = interruptPendingInteractionsForThreads(this.deps.db, {
      providerId: args.providerId,
      threadIds: args.threadIds,
      statusReason: args.reason,
    }).map(toPendingInteraction);

    for (const interaction of updated) {
      this.finishInteraction(interaction);
    }

    return updated;
  }

  private requireInteraction(interactionId: string): PendingInteraction {
    const interaction = getPendingInteraction(this.deps.db, interactionId);
    if (!interaction) {
      throw new ApiError(404, "invalid_request", "Pending interaction not found");
    }

    return toPendingInteraction(interaction);
  }

  private removeWaiter(
    interactionId: string,
    waiter: PendingInteractionWaiter,
  ): void {
    const waiters = this.waiters.get(interactionId);
    if (!waiters) {
      return;
    }

    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.waiters.delete(interactionId);
    }
  }

  private finishInteraction(interaction: PendingInteraction): void {
    appendPendingInteractionTimelineEvent(this.deps, interaction);
    notifyInteractionChanged(this.deps, interaction.threadId);
    const outcome = requireWaitableOutcome(interaction);
    if (!outcome) {
      return;
    }

    const waiters = this.waiters.get(interaction.id);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      waiter.resolve(outcome);
    }
    this.waiters.delete(interaction.id);
  }
}
