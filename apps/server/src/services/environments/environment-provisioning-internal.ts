import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  type HostDaemonCommandRow,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type EnvironmentOperationRow,
  getActiveSession,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  getEnvironmentOperationByCommandId,
  getThreadOperation,
  listStoredThreadProvisioningRowsByProvisioningId,
  queueCommand,
  threadOperations,
  threads,
} from "@bb/db";
import {
  applyProvisionedEnvironmentRecord,
  markEnvironmentOperationRecordCompleted,
  markEnvironmentOperationRecordFailed,
  markEnvironmentOperationRecordQueued,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import type {
  Environment,
  EnvironmentOperationKind,
  ProvisioningTranscriptEntry,
  SystemThreadProvisioningStatus,
  ThreadProvisioningStage,
} from "@bb/domain";
import {
  activeLifecycleOperationStates,
  isActiveLifecycleOperationState,
  systemThreadProvisioningEventDataSchema,
  threadScope,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  SETUP_TIMEOUT_MS,
  requireSourceForHost,
  storedBaseBranchNameToSpec,
} from "../threads/thread-create-helpers.js";
import {
  resolveManagedTargetPath,
  resolvePersonalTargetPath,
} from "../threads/worktree-paths.js";
import {
  buildDirectEnvironmentProvisionRequest,
  environmentProvisionRequestSchema,
  type EnvironmentProvisionRequest,
} from "./environment-provision-request.js";
import { parseJsonWithSchema } from "../lib/json-parsing.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import { readThreadProvisioningIdFromRecord } from "../threads/thread-provisioning-context.js";
import {
  advanceThreadProvisioning,
  recordThreadProvisionWorkspaceReadyInTransaction,
} from "../threads/thread-provisioning.js";
import {
  finalizeStoppedThreadAndRequestCleanupAdvance,
  finalizeStoppedThreadInTransaction,
} from "../threads/thread-lifecycle.js";
import { runEnvironmentCleanupAdvance } from "./environment-cleanup-internal.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";

type EnvironmentProvisionOperationKind = Extract<
  EnvironmentOperationKind,
  "provision" | "reprovision"
>;

type EnvironmentProvisionCommand =
  HostDaemonCommandForType<"environment.provision">;
type EnvironmentProvisionCommandResultReport =
  CommandResultReportForType<"environment.provision">;

interface EnvironmentProvisionReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionWriteDeps extends EnvironmentProvisionReadDeps {
  hub: DbNotifier;
}

interface EnvironmentProvisionTransactionDeps extends EnvironmentProvisionWriteDeps {
  db: DbTransaction;
  pendingInteractions: AppDeps["pendingInteractions"];
}

export interface RequestEnvironmentProvisionArgs {
  environmentId: string;
  request: EnvironmentProvisionRequest;
}

export interface RequestEnvironmentReprovisionArgs
  extends RequestEnvironmentProvisionArgs {}

export interface AdvanceEnvironmentProvisioningArgs {
  environmentId: string | null | undefined;
}

export interface EnvironmentProvisioningCommandMutationArgs {
  commandId: string;
}

export interface EnvironmentProvisioningCommandLookupArgs {
  commandId: string;
}

export interface SettleEnvironmentProvisionCommandResultArgs {
  command: EnvironmentProvisionCommand;
  commandRow: HostDaemonCommandRow;
  deps: EnvironmentProvisionTransactionDeps;
  report: EnvironmentProvisionCommandResultReport;
}

export interface FailEnvironmentProvisioningForCommandArgs extends EnvironmentProvisioningCommandMutationArgs {
  failureReason: string;
}

interface QueueEnvironmentProvisionCommandArgs {
  command: EnvironmentProvisionCommand;
  environment: Environment;
  kind: EnvironmentProvisionOperationKind;
}

interface FailEnvironmentProvisioningDurablyArgs {
  commandId?: string;
  environmentId: string;
  failureEntry: ProvisioningTranscriptEntry;
  failureReason: string;
}

interface LiveEnvironmentThread {
  id: string;
  provisionEventSequence: number | null;
  provisionOperationProvisioningEnvironmentId: string | null;
  provisionOperationProvisioningId: string | null;
  provisionOperationProvisioningStage: ThreadProvisioningStage | null;
  workspaceReadyEventSequence: number | null;
}

interface AppendThreadProvisioningEventToEnvironmentThreadsArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  fallbackProvisioningId: string;
  status: SystemThreadProvisioningStatus;
  threads?: LiveEnvironmentThread[];
}

function listLiveEnvironmentThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): LiveEnvironmentThread[] {
  return deps.db
    .select({
      id: threads.id,
      provisionEventSequence: threadOperations.provisionEventSequence,
      provisionOperationProvisioningEnvironmentId:
        threadOperations.provisioningEnvironmentId,
      provisionOperationProvisioningId: threadOperations.provisioningId,
      provisionOperationProvisioningStage: threadOperations.provisioningStage,
      workspaceReadyEventSequence: threadOperations.workspaceReadyEventSequence,
    })
    .from(threads)
    .leftJoin(
      threadOperations,
      and(
        eq(threadOperations.threadId, threads.id),
        eq(threadOperations.kind, "provision"),
        inArray(threadOperations.state, [...activeLifecycleOperationStates]),
      ),
    )
    .where(
      and(eq(threads.environmentId, environmentId), isNull(threads.deletedAt)),
    )
    .all();
}

function resolveLiveThreadProvisioningId(
  thread: LiveEnvironmentThread,
  fallbackProvisioningId: string,
): string {
  if (
    thread.provisionOperationProvisioningId === null &&
    thread.provisionOperationProvisioningStage === null
  ) {
    return fallbackProvisioningId;
  }
  return readThreadProvisioningIdFromRecord({
    provisionEventSequence: thread.provisionEventSequence,
    provisioningEnvironmentId:
      thread.provisionOperationProvisioningEnvironmentId,
    provisioningId: thread.provisionOperationProvisioningId,
    provisioningStage: thread.provisionOperationProvisioningStage,
    workspaceReadyEventSequence: thread.workspaceReadyEventSequence,
  });
}

function appendThreadProvisioningEventToEnvironmentThreadsInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: AppendThreadProvisioningEventToEnvironmentThreadsArgs,
): void {
  const liveThreads =
    args.threads ?? listLiveEnvironmentThreads(deps, args.environmentId);

  for (const thread of liveThreads) {
    const provisioningId = resolveLiveThreadProvisioningId(
      thread,
      args.fallbackProvisioningId,
    );
    appendThreadProvisioningEventInTransaction(deps.db, {
      entries: args.entries,
      environmentId: args.environmentId,
      provisioningId,
      status: args.status,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
}

function queueEnvironmentProvisionCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: QueueEnvironmentProvisionCommandArgs,
): string | null {
  const session = getActiveSession(deps.db, args.environment.hostId);
  if (!session || session.leaseExpiresAt <= Date.now()) {
    return null;
  }

  const queuedCommand = queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: args.command.type,
    payload: JSON.stringify(args.command),
  });

  markEnvironmentOperationRecordQueued(deps.db, {
    environmentId: args.environment.id,
    kind: args.kind,
    commandId: queuedCommand.id,
  });

  return queuedCommand.id;
}

function getActiveProvisionOperation(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
):
  | (EnvironmentOperationRow & { kind: EnvironmentProvisionOperationKind })
  | null {
  for (const kind of ["reprovision", "provision"] as const) {
    const operation = getEnvironmentOperation(deps.db, {
      environmentId,
      kind,
    });
    if (operation && isActiveLifecycleOperationState(operation.state)) {
      return {
        ...operation,
        kind,
      };
    }
  }

  return null;
}

function getActiveProvisionOperationByCommandId(
  deps: EnvironmentProvisionReadDeps,
  commandId: string,
) {
  const operation = getEnvironmentOperationByCommandId(deps.db, commandId);
  if (
    !operation ||
    (operation.kind !== "provision" && operation.kind !== "reprovision") ||
    !isActiveLifecycleOperationState(operation.state)
  ) {
    return null;
  }

  return operation;
}

function readEnvironmentProvisioningIdFromOperation(
  operation: EnvironmentOperationRow,
): string {
  return parseJsonWithSchema(
    operation.payload,
    environmentProvisionRequestSchema,
  ).provisioningId;
}

export function getEnvironmentProvisioningIdForCommand(
  deps: EnvironmentProvisionReadDeps,
  args: EnvironmentProvisioningCommandLookupArgs,
): string | null {
  const operation = getActiveProvisionOperationByCommandId(
    deps,
    args.commandId,
  );
  if (!operation) {
    return null;
  }
  return readEnvironmentProvisioningIdFromOperation(operation);
}

function isWorkspaceProvisioningTranscriptEntry(
  entry: ProvisioningTranscriptEntry,
): boolean {
  return WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS.has(entry.key);
}

const WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS = new Set([
  "git-checkout-completed",
  "git-checkout-failed",
  "git-checkout-started",
  "git-clone-completed",
  "git-clone-failed",
  "git-clone-started",
  "git-worktree-command",
  "git-worktree-completed",
  "git-worktree-failed",
  "git-worktree-started",
  "setup-completed",
  "setup-failed",
  "setup-started",
  "workspace-branch",
  "workspace-path",
  "workspace-source",
  "workspace-target",
]);

function hasStreamedProvisioningTranscript(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
  provisioningId: string,
): boolean {
  const rows = listStoredThreadProvisioningRowsByProvisioningId(deps.db, {
    threadId,
    provisioningId,
  });

  return rows.some((row) => {
    const eventData = systemThreadProvisioningEventDataSchema.parse(
      JSON.parse(row.data),
    );
    return (
      eventData.provisioningId === provisioningId &&
      eventData.entries.some(isWorkspaceProvisioningTranscriptEntry)
    );
  });
}

function hasActiveThreadProvisionOperation(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId,
    kind: "provision",
  });
  return Boolean(operation && isActiveLifecycleOperationState(operation.state));
}

interface ProvisionedEnvironmentBranchMetadata {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
}

function resolveProvisionedEnvironmentBranchMetadata(
  command: EnvironmentProvisionCommand,
): ProvisionedEnvironmentBranchMetadata {
  if (command.workspaceProvisionType !== "unmanaged") {
    return {};
  }

  if (!command.checkout) {
    return {};
  }

  if (command.checkout.kind === "new") {
    return {
      baseBranch: null,
      mergeBaseBranch: command.checkout.baseBranch,
    };
  }

  return {
    baseBranch: null,
    mergeBaseBranch: null,
  };
}

function hasQueuedProvisionCommand(
  deps: EnvironmentProvisionReadDeps,
  commandId: string | null,
): boolean {
  if (!commandId) {
    return false;
  }

  const command = getCommand(deps.db, commandId);
  return (
    command !== null &&
    (command.state === "pending" || command.state === "fetched")
  );
}

export function completeEnvironmentProvisioning(
  deps: EnvironmentProvisionReadDeps,
  args: { environmentId: string },
): boolean {
  const operation = getActiveProvisionOperation(deps, args.environmentId);
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordCompleted(deps.db, {
    environmentId: args.environmentId,
    kind: operation.kind,
  });
  return true;
}

export function hasActiveEnvironmentProvisionOperationForCommand(
  deps: EnvironmentProvisionReadDeps,
  args: EnvironmentProvisioningCommandMutationArgs,
): boolean {
  return getActiveProvisionOperationByCommandId(deps, args.commandId) !== null;
}

export function completeEnvironmentProvisioningForCommand(
  deps: EnvironmentProvisionReadDeps,
  args: EnvironmentProvisioningCommandMutationArgs,
): boolean {
  const operation = getActiveProvisionOperationByCommandId(
    deps,
    args.commandId,
  );
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordCompleted(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
  });
  return true;
}

export function failEnvironmentProvisioningForCommand(
  deps: EnvironmentProvisionWriteDeps,
  args: FailEnvironmentProvisioningForCommandArgs,
): boolean {
  const operation = getActiveProvisionOperationByCommandId(
    deps,
    args.commandId,
  );
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordFailed(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
    failureReason: args.failureReason,
  });

  const environment = getEnvironment(deps.db, operation.environmentId);
  if (
    environment &&
    environment.status !== "destroyed" &&
    environment.status !== "error"
  ) {
    setEnvironmentStatus(deps.db, deps.hub, operation.environmentId, {
      status: "error",
    });
  }

  return true;
}

export function failEnvironmentProvisioning(
  deps: EnvironmentProvisionWriteDeps,
  args: { environmentId: string; failureReason: string },
): boolean {
  const operation = getActiveProvisionOperation(deps, args.environmentId);
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordFailed(deps.db, {
    environmentId: args.environmentId,
    kind: operation.kind,
    failureReason: args.failureReason,
  });

  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    environment &&
    environment.status !== "destroyed" &&
    environment.status !== "error"
  ) {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "error",
    });
  }

  return true;
}

export function recordEnvironmentProvisioningFailureInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: FailEnvironmentProvisioningDurablyArgs,
): boolean {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return false;
  }
  const operation = args.commandId
    ? getActiveProvisionOperationByCommandId(deps, args.commandId)
    : getActiveProvisionOperation(deps, environment.id);
  if (!operation) {
    return false;
  }
  const liveThreads = listLiveEnvironmentThreads(deps, environment.id);
  const provisioningId = readEnvironmentProvisioningIdFromOperation(operation);

  if (args.commandId) {
    failEnvironmentProvisioningForCommand(deps, {
      commandId: args.commandId,
      failureReason: args.failureReason,
    });
  } else {
    failEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      failureReason: args.failureReason,
    });
  }

  appendThreadProvisioningEventToEnvironmentThreadsInTransaction(deps, {
    environmentId: environment.id,
    fallbackProvisioningId: provisioningId,
    status: "failed",
    threads: liveThreads,
    entries: [args.failureEntry],
  });

  for (const thread of liveThreads) {
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId: environment.id,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.failureReason,
      scope: threadScope(),
    });
    tryTransitionInTransaction(deps.db, deps.hub, thread.id, "error");
  }

  return true;
}

export function settleEnvironmentProvisionCommandResult(
  args: SettleEnvironmentProvisionCommandResultArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  if (
    !hasActiveEnvironmentProvisionOperationForCommand(args.deps, {
      commandId: args.commandRow.id,
    })
  ) {
    return emptyCommandResultSideEffects();
  }

  const environmentProvisioningId = getEnvironmentProvisioningIdForCommand(
    args.deps,
    {
      commandId: args.commandRow.id,
    },
  );
  if (environmentProvisioningId === null) {
    return emptyCommandResultSideEffects();
  }

  const boundThreads = args.deps.db
    .select()
    .from(threads)
    .where(eq(threads.environmentId, args.command.environmentId))
    .all();

  if (args.report.ok) {
    applyProvisionedEnvironmentRecord(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        path: args.report.result.path,
        status: "ready",
        isGitRepo: args.report.result.isGitRepo,
        isWorktree: args.report.result.isWorktree,
        branchName: args.report.result.branchName,
        defaultBranch: args.report.result.defaultBranch,
        ...resolveProvisionedEnvironmentBranchMetadata(args.command),
      },
    );
    args.deps.hub.notifyEnvironment(args.command.environmentId, [
      "work-status-changed",
    ]);

    const cwdBranchEntries = buildCwdBranchEntries({
      path: args.report.result.path,
      branchName: args.report.result.branchName,
    });

    for (const thread of boundThreads) {
      if (thread.deletedAt !== null) {
        const finalized = finalizeStoppedThreadInTransaction(args.deps, {
          threadId: thread.id,
        });
        if (finalized) {
          postCommitActions.push({
            name: "Environment cleanup advance after deleted thread finalize",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) =>
              runEnvironmentCleanupAdvance(deps, {
                environmentId: args.command.environmentId,
              }),
          });
        } else {
          postCommitActions.push({
            name: "Deleted thread finalization retry after environment provision",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) => {
              finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
                threadId: thread.id,
              });
            },
          });
        }
        continue;
      }
      if (thread.archivedAt !== null || thread.stopRequestedAt !== null) {
        continue;
      }

      const isInitiator = thread.id === args.command.initiator?.threadId;
      const hasStreamedTranscript =
        isInitiator && args.command.initiator
          ? hasStreamedProvisioningTranscript(
              args.deps,
              thread.id,
              args.command.initiator.provisioningId,
            )
          : false;
      const entries = hasStreamedTranscript
        ? []
        : isInitiator && args.report.result.transcript.length > 0
          ? args.report.result.transcript
          : cwdBranchEntries;

      if (!hasActiveThreadProvisionOperation(args.deps, thread.id)) {
        appendThreadProvisioningEventInTransaction(args.deps.db, {
          threadId: thread.id,
          environmentId: args.command.environmentId,
          provisioningId: environmentProvisioningId,
          status: thread.status === "provisioning" ? "active" : "completed",
          entries,
        });
        args.deps.hub.notifyThread(thread.id, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
        continue;
      }

      recordThreadProvisionWorkspaceReadyInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      postCommitActions.push({
        name: "Thread provisioning advance after workspace ready",
        context: {
          environmentId: args.command.environmentId,
          threadId: thread.id,
        },
        run: (deps) => advanceThreadProvisioning(deps, { threadId: thread.id }),
      });
    }

    completeEnvironmentProvisioningForCommand(args.deps, {
      commandId: args.commandRow.id,
    });

    postCommitActions.push({
      name: "Environment cleanup advance after provision result",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
    return { postCommitActions };
  }

  const failureRecorded = recordEnvironmentProvisioningFailureInTransaction(
    args.deps,
    {
      commandId: args.commandRow.id,
      environmentId: args.command.environmentId,
      failureReason: args.report.errorMessage,
      failureEntry: {
        type: "step",
        key: "workspace-failed",
        text: "Workspace setup failed",
        status: "failed",
        startedAt: args.commandRow.createdAt,
        metadata: { durationMs: Date.now() - args.commandRow.createdAt },
      },
    },
  );
  if (failureRecorded) {
    postCommitActions.push({
      name: "Environment cleanup advance after provision failure",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
  }
  return { postCommitActions };
}

export function requestEnvironmentProvision(
  deps: EnvironmentProvisionWriteDeps,
  args: RequestEnvironmentProvisionArgs,
): void {
  upsertEnvironmentOperationRecord(deps.db, {
    environmentId: args.environmentId,
    kind: "provision",
    payload: JSON.stringify(args.request),
  });

  const environment = getEnvironment(deps.db, args.environmentId);
  if (environment && environment.status !== "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "provisioning",
    });
  }
}

export function requestEnvironmentReprovision(
  deps: EnvironmentProvisionWriteDeps,
  args: RequestEnvironmentReprovisionArgs,
): void {
  upsertEnvironmentOperationRecord(deps.db, {
    environmentId: args.environmentId,
    kind: "reprovision",
    payload: JSON.stringify(args.request),
  });

  const environment = getEnvironment(deps.db, args.environmentId);
  if (environment && environment.status !== "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "provisioning",
    });
  }
}

export async function advanceEnvironmentProvisioning(
  deps: LoggedWorkSessionDeps,
  args: AdvanceEnvironmentProvisioningArgs,
): Promise<string | null> {
  if (!args.environmentId) {
    return null;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status === "destroyed") {
    return null;
  }

  const operation = getActiveProvisionOperation(deps, environment.id);
  if (!operation) {
    return null;
  }

  if (hasQueuedProvisionCommand(deps, operation.commandId)) {
    return operation.commandId;
  }

  const request = parseJsonWithSchema(
    operation.payload,
    environmentProvisionRequestSchema,
  );

  await ensureHostSessionReadyForWork(deps, {
    hostId: environment.hostId,
  });
  return queueEnvironmentProvisionCommand(deps, {
    command: request.command,
    environment,
    kind: operation.kind,
  });
}

export const MANAGED_REPROVISION_QUEUED = "queued" as const;
export const MANAGED_REPROVISION_IN_PROGRESS = "already-provisioning" as const;
export interface QueuedManagedReprovision {
  provisionEventSequence: number;
  status: typeof MANAGED_REPROVISION_QUEUED;
}
export type ManagedReprovisionResult =
  | QueuedManagedReprovision
  | typeof MANAGED_REPROVISION_IN_PROGRESS;

export interface ActiveManagedEnvironmentProvisionArgs {
  environmentId: string;
}

export interface QueueManagedEnvironmentReprovisionArgs {
  environment: Environment;
  projectId: string;
  provisionEventSequence: number;
  provisioningId: string;
  threadId: string;
}

export function hasActiveManagedEnvironmentProvision(
  deps: Pick<AppDeps, "db">,
  args: ActiveManagedEnvironmentProvisionArgs,
): boolean {
  return Boolean(getActiveProvisionOperation(deps, args.environmentId));
}

export async function queueManagedEnvironmentReprovision(
  deps: WorkSessionDeps,
  args: QueueManagedEnvironmentReprovisionArgs,
): Promise<ManagedReprovisionResult> {
  const provisionType = args.environment.workspaceProvisionType;
  if (!args.environment.managed || provisionType === "unmanaged") {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cannot be reprovisioned automatically",
      {
        details: {
          managed: args.environment.managed,
          workspaceProvisionType: provisionType,
        },
      },
    );
  }

  const activeOperation = getActiveProvisionOperation(
    deps,
    args.environment.id,
  );
  if (activeOperation) {
    return MANAGED_REPROVISION_IN_PROGRESS;
  }

  const hostSession = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });

  const initiator = {
    threadId: args.threadId,
    provisioningId: args.provisioningId,
  };
  const command =
    provisionType === "personal"
      ? buildEnvironmentProvisionCommand({
          environmentId: args.environment.id,
          hostId: args.environment.hostId,
          initiator,
          targetPath:
            args.environment.path ??
            resolvePersonalTargetPath({
              dataDir: hostSession.dataDir,
              environmentId: args.environment.id,
            }),
          workspaceProvisionType: provisionType,
        })
      : (() => {
          const source = requireSourceForHost(
            deps,
            args.projectId,
            args.environment.hostId,
          );
          const targetPath =
            args.environment.path ??
            resolveManagedTargetPath({
              dataDir: hostSession.dataDir,
              environmentId: args.environment.id,
              sourcePath: source.path,
            });
          const branchName =
            args.environment.branchName ??
            buildManagedBranchName({ threadId: args.threadId });
          const baseBranch = storedBaseBranchNameToSpec(
            args.environment.baseBranch,
          );
          return buildEnvironmentProvisionCommand({
            branchName,
            baseBranch,
            environmentId: args.environment.id,
            hostId: args.environment.hostId,
            initiator,
            sourcePath: source.path,
            targetPath,
            workspaceProvisionType: provisionType,
            setupTimeoutMs: SETUP_TIMEOUT_MS,
          });
        })();

  requestEnvironmentReprovision(deps, {
    environmentId: args.environment.id,
    request: buildDirectEnvironmentProvisionRequest({
      command,
      provisioningId: args.provisioningId,
    }),
  });
  queueEnvironmentProvisionCommand(deps, {
    command,
    environment: args.environment,
    kind: "reprovision",
  });
  return {
    provisionEventSequence: args.provisionEventSequence,
    status: MANAGED_REPROVISION_QUEUED,
  };
}
