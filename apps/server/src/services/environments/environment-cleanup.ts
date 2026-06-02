import type {
  EnvironmentOperationKind,
  WorkspaceProvisionType,
} from "@bb/domain";
import {
  isActiveLifecycleOperationState,
  resolveEnvironmentMergeBaseBranch,
  threadScope,
} from "@bb/domain";
import {
  cancelCommandInTransaction,
  countLiveThreadsInEnvironment,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  getEnvironmentOperationByCommandId,
  getActiveSession,
  getPendingEnvironmentCommand,
  hasPendingThreadShutdownInEnvironment,
  listLiveThreadsInEnvironment,
  queueCommand,
  type HostDaemonCommandRow,
  type DbNotifier,
  type DbConnection,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import {
  cancelEnvironmentOperationRecord,
  clearEnvironmentCleanupRequestRecord,
  markEnvironmentOperationRecordCompleted,
  markEnvironmentOperationRecordFailed,
  markEnvironmentOperationRecordQueued,
  recordEnvironmentCleanupRequest,
  setEnvironmentRecordDestroyed,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-lifecycle";
import { type HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  emptyCommandResultSideEffects,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { queueCommandAndWait } from "../hosts/command-wait.js";
import { scheduleAfterDaemonIngressResponse } from "../hosts/daemon-ingress-scheduler.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { appendSystemErrorEventInTransaction } from "../threads/thread-events.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import { workspaceContextFromPath } from "./workspace-command-target.js";

export interface EnvironmentDestroyTarget {
  hostId: string;
  id: string;
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

export interface AdvanceEnvironmentCleanupArgs {
  environmentId: string;
}

export interface RequestEnvironmentCleanupAdvanceArgs {
  environmentId: string | null | undefined;
}

export interface RequestEnvironmentCleanupArgs {
  environmentId: string | null | undefined;
}

export interface RequestEnvironmentCleanupAndAdvanceArgs {
  environmentId: string | null | undefined;
}

export interface CancelPendingEnvironmentCleanupArgs {
  environmentId: string | null | undefined;
}

export type CancelPendingEnvironmentCleanupResult =
  | "cancelled"
  | "in_progress"
  | "not_requested";

export interface EnvironmentCleanupCommandMutationArgs {
  commandId: string;
}

type EnvironmentDestroyCommand =
  HostDaemonCommandForType<"environment.destroy">;
type EnvironmentDestroyCommandResultReport =
  CommandResultReportForType<"environment.destroy">;

export interface SettleEnvironmentDestroyCommandResultArgs {
  command: EnvironmentDestroyCommand;
  commandRow: HostDaemonCommandRow;
  deps: EnvironmentCleanupSettlementDeps;
  report: EnvironmentDestroyCommandResultReport;
}

export interface FailEnvironmentCleanupForCommandArgs extends EnvironmentCleanupCommandMutationArgs {
  failureReason: string;
}

export interface WouldCleanupEnvironmentArgs {
  environmentId: string | null | undefined;
  excludeThreadId: string;
}

export interface WouldCleanupEnvironmentWithNoLiveThreadsArgs {
  environmentId: string | null | undefined;
}

interface EnvironmentCleanupReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentCleanupWriteDeps extends EnvironmentCleanupReadDeps {
  hub: DbNotifier;
}

interface EnvironmentCleanupCancellationDeps
  extends Omit<EnvironmentCleanupWriteDeps, "db"> {
  db: DbConnection;
}

interface EnvironmentCleanupSettlementDeps extends EnvironmentCleanupWriteDeps {
  db: DbTransaction;
}

type EnvironmentCleanupDecisionDeps = Pick<AppDeps, "db">;
type EnvironmentCleanupPreflightResult =
  HostDaemonCommandResult<"environment.cleanup_preflight">;

function hasConnectedHostSession(
  deps: Pick<AppDeps, "db">,
  hostId: string,
): boolean {
  const session = getActiveSession(deps.db, hostId);
  return session !== null && session.leaseExpiresAt > Date.now();
}

function cleanupPreflightAllowsDestroy(
  result: EnvironmentCleanupPreflightResult,
): boolean {
  switch (result.outcome) {
    case "safe_to_destroy":
    case "already_missing":
    case "not_inspectable":
      return true;
    case "blocked_by_changes":
    case "probe_failed":
      return false;
  }
}

async function workspaceCanBeSafelyCleaned(
  deps: LoggedWorkSessionDeps,
  environmentId: string,
): Promise<boolean> {
  const environment = getEnvironment(deps.db, environmentId);
  if (
    !environment ||
    !environment.managed ||
    environment.status !== "ready" ||
    !environment.path
  ) {
    return false;
  }

  if (!hasConnectedHostSession(deps, environment.hostId)) {
    return false;
  }

  if (!environment.isGitRepo) {
    return true;
  }

  if (
    getPendingEnvironmentCommand(deps.db, {
      environmentId: environment.id,
      type: "environment.cleanup_preflight",
    })
  ) {
    return false;
  }

  const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(environment);
  if (!mergeBaseBranch) {
    return false;
  }

  const result = await queueCommandAndWait(deps, {
    hostId: environment.hostId,
    timeoutMs: 30_000,
    command: {
      type: "environment.cleanup_preflight",
      environmentId: environment.id,
      workspaceContext: workspaceContextFromPath({
        path: environment.path,
        workspaceProvisionType: environment.workspaceProvisionType,
      }),
      mergeBaseBranch,
    },
  });
  return cleanupPreflightAllowsDestroy(result);
}

function canRequestCleanup(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
): boolean {
  return environment.managed && environment.status !== "destroyed";
}

function hasDestroyOperationRequest(
  deps: EnvironmentCleanupReadDeps,
  environmentId: string,
): boolean {
  const operation = getEnvironmentOperation(deps.db, {
    environmentId,
    kind: "destroy",
  });

  if (operation && isActiveLifecycleOperationState(operation.state)) {
    return true;
  }

  const environment = getEnvironment(deps.db, environmentId);
  return environment !== null && environment.cleanupMode !== null;
}

function getActiveDestroyOperationByCommandId(
  deps: EnvironmentCleanupReadDeps,
  commandId: string,
) {
  const operation = getEnvironmentOperationByCommandId(deps.db, commandId);
  if (
    !operation ||
    operation.kind !== "destroy" ||
    !isActiveLifecycleOperationState(operation.state)
  ) {
    return null;
  }

  return operation;
}

function restoreEnvironmentAfterCleanupCancellation(
  deps: EnvironmentCleanupWriteDeps,
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
): void {
  if (environment.status !== "destroying") {
    return;
  }

  setEnvironmentStatus(deps.db, deps.hub, environment.id, {
    status: environment.path ? "ready" : "error",
  });
}

function markLiveThreadsErroredAfterDestroySuccess(
  deps: EnvironmentCleanupSettlementDeps,
  environmentId: string,
): void {
  const liveThreads = listLiveThreadsInEnvironment(deps.db, { environmentId });
  for (const thread of liveThreads) {
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId,
      code: "environment_workspace_destroyed",
      message:
        "The workspace for this thread was destroyed before the thread could be stopped.",
      scope: threadScope(),
    });
    tryTransitionInTransaction(deps.db, deps.hub, thread.id, "error");
  }
}

export function hasActiveEnvironmentDestroyOperationForCommand(
  deps: EnvironmentCleanupReadDeps,
  args: EnvironmentCleanupCommandMutationArgs,
): boolean {
  return getActiveDestroyOperationByCommandId(deps, args.commandId) !== null;
}

export function completeEnvironmentDestroyForCommand(
  deps: EnvironmentCleanupSettlementDeps,
  args: EnvironmentCleanupCommandMutationArgs,
): boolean {
  const operation = getActiveDestroyOperationByCommandId(deps, args.commandId);
  if (!operation) {
    return false;
  }

  const environment = getEnvironment(deps.db, operation.environmentId);
  if (!environment) {
    return false;
  }

  if (environment.status === "destroying") {
    setEnvironmentRecordDestroyed(deps.db, deps.hub, operation.environmentId);
  } else if (environment.status !== "destroyed") {
    return false;
  }

  markLiveThreadsErroredAfterDestroySuccess(deps, operation.environmentId);
  markEnvironmentOperationRecordCompleted(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
  });
  return true;
}

export function failEnvironmentDestroyForCommand(
  deps: EnvironmentCleanupWriteDeps,
  args: FailEnvironmentCleanupForCommandArgs,
): boolean {
  const operation = getActiveDestroyOperationByCommandId(deps, args.commandId);
  if (!operation) {
    return false;
  }

  markEnvironmentOperationRecordFailed(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
    failureReason: args.failureReason,
  });

  const environment = getEnvironment(deps.db, operation.environmentId);
  if (environment && environment.status === "destroying") {
    setEnvironmentStatus(deps.db, deps.hub, operation.environmentId, {
      status: environment.path ? "ready" : "error",
    });
  }

  return true;
}

export function settleEnvironmentDestroyCommandResult(
  args: SettleEnvironmentDestroyCommandResultArgs,
): CommandResultSideEffectsResult {
  if (
    !hasActiveEnvironmentDestroyOperationForCommand(args.deps, {
      commandId: args.commandRow.id,
    })
  ) {
    return emptyCommandResultSideEffects();
  }

  if (!args.report.ok) {
    failEnvironmentDestroyForCommand(args.deps, {
      commandId: args.commandRow.id,
      failureReason: args.report.errorMessage,
    });
    return emptyCommandResultSideEffects();
  }

  const environment = getEnvironment(args.deps.db, args.command.environmentId);
  if (!environment) {
    return emptyCommandResultSideEffects();
  }
  if (
    !completeEnvironmentDestroyForCommand(args.deps, {
      commandId: args.commandRow.id,
    })
  ) {
    return emptyCommandResultSideEffects();
  }

  return {
    postCommitActions: [
      {
        name: "Terminal cleanup after environment destroy",
        context: {
          environmentId: environment.id,
        },
        run: (deps) =>
          deps.terminalSessions.closeDestroyedEnvironmentTerminals({
            environmentId: environment.id,
          }),
      },
    ],
  };
}

export function requestEnvironmentCleanup(
  deps: EnvironmentCleanupWriteDeps,
  args: RequestEnvironmentCleanupArgs,
): void {
  if (!args.environmentId) {
    return;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || !canRequestCleanup(environment)) {
    return;
  }

  upsertEnvironmentOperationRecord(deps.db, {
    environmentId: environment.id,
    kind: "destroy",
    payload: JSON.stringify({}),
    requestedAt: environment.cleanupRequestedAt ?? undefined,
  });
  recordEnvironmentCleanupRequest(deps.db, deps.hub, environment.id, {});
}

export function cancelPendingEnvironmentCleanup(
  deps: EnvironmentCleanupCancellationDeps,
  args: CancelPendingEnvironmentCleanupArgs,
): CancelPendingEnvironmentCleanupResult {
  if (!args.environmentId) {
    return "not_requested";
  }

  const environmentId = args.environmentId;
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const txDeps = {
        db: tx,
        hub: notificationBuffer,
      };
      const environment = getEnvironment(tx, environmentId);
      if (!environment || environment.cleanupMode === null) {
        return "not_requested";
      }

      const operation = getEnvironmentOperation(tx, {
        environmentId: environment.id,
        kind: "destroy",
      });
      if (operation?.commandId) {
        const command = getCommand(tx, operation.commandId);
        if (command?.state === "fetched") {
          return "in_progress";
        }
        if (command?.state === "pending") {
          cancelCommandInTransaction(tx, {
            commandId: command.id,
            resultPayload: JSON.stringify({
              errorCode: "environment_cleanup_cancelled",
              errorMessage: "Environment cleanup was cancelled",
            }),
          });
        }
      }

      if (operation) {
        cancelEnvironmentOperationRecord(tx, {
          environmentId: environment.id,
          kind: "destroy",
        });
      }
      clearEnvironmentCleanupRequestRecord(tx, notificationBuffer, environment.id);
      restoreEnvironmentAfterCleanupCancellation(txDeps, environment);
      return "cancelled";
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}

function queueEnvironmentDestroyCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  environment: EnvironmentDestroyTarget,
) {
  const pendingCommand = getPendingEnvironmentCommand(deps.db, {
    environmentId: environment.id,
    type: "environment.destroy",
  });
  if (pendingCommand) {
    return pendingCommand.id;
  }

  const session = getActiveSession(deps.db, environment.hostId);
  const queuedCommand = queueCommand(deps.db, deps.hub, {
    hostId: environment.hostId,
    sessionId: session?.id ?? null,
    type: "environment.destroy",
    payload: JSON.stringify({
      type: "environment.destroy",
      environmentId: environment.id,
      workspaceContext: workspaceContextFromPath(environment),
    }),
  });

  return queuedCommand.id;
}

function queueDestroyAndMarkDestroying(
  deps: Pick<AppDeps, "db" | "hub">,
  environment: EnvironmentDestroyTarget & {
    operationKind: Extract<EnvironmentOperationKind, "destroy">;
    status: NonNullable<ReturnType<typeof getEnvironment>>["status"];
  },
): void {
  const commandId = queueEnvironmentDestroyCommand(deps, environment);
  markEnvironmentOperationRecordQueued(deps.db, {
    environmentId: environment.id,
    kind: environment.operationKind,
    commandId,
  });
  if (environment.status !== "destroying") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "destroying",
    });
  }
}

export function wouldCleanupEnvironment(
  deps: EnvironmentCleanupDecisionDeps,
  args: WouldCleanupEnvironmentArgs,
): boolean {
  if (!args.environmentId) {
    return false;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || !environment.managed) {
    return false;
  }

  return (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: environment.id,
      excludeThreadId: args.excludeThreadId,
    }) === 0
  );
}

export function wouldCleanupEnvironmentWithNoLiveThreads(
  deps: EnvironmentCleanupDecisionDeps,
  args: WouldCleanupEnvironmentWithNoLiveThreadsArgs,
): boolean {
  if (!args.environmentId) {
    return false;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || !environment.managed) {
    return false;
  }

  return (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: environment.id,
    }) === 0
  );
}

export async function advanceEnvironmentCleanup(
  deps: LoggedWorkSessionDeps,
  args: AdvanceEnvironmentCleanupArgs,
): Promise<void> {
  const environment = getEnvironment(deps.db, args.environmentId);
  let destroyOperation = getEnvironmentOperation(deps.db, {
    environmentId: args.environmentId,
    kind: "destroy",
  });
  if (
    !environment ||
    !environment.managed ||
    environment.status === "destroyed" ||
    !hasDestroyOperationRequest(deps, args.environmentId)
  ) {
    return;
  }

  if (
    countLiveThreadsInEnvironment(deps.db, { environmentId: environment.id }) >
    0
  ) {
    return;
  }

  if (!destroyOperation) {
    destroyOperation = upsertEnvironmentOperationRecord(deps.db, {
      environmentId: environment.id,
      kind: "destroy",
      payload: JSON.stringify({}),
      requestedAt: environment.cleanupRequestedAt ?? undefined,
    });
  }

  if (
    hasPendingThreadShutdownInEnvironment(deps.db, {
      environmentId: environment.id,
    })
  ) {
    return;
  }

  if (!environment.path) {
    if (environment.status === "provisioning") {
      return;
    }

    if (destroyOperation) {
      markEnvironmentOperationRecordCompleted(deps.db, {
        environmentId: environment.id,
        kind: "destroy",
      });
    }
    setEnvironmentRecordDestroyed(deps.db, deps.hub, environment.id);
    return;
  }

  if (
    destroyOperation &&
    isActiveLifecycleOperationState(destroyOperation.state) &&
    destroyOperation.commandId &&
    getPendingEnvironmentCommand(deps.db, {
      environmentId: environment.id,
      type: "environment.destroy",
    })
  ) {
    return;
  }

  const canDestroyNow = await workspaceCanBeSafelyCleaned(deps, environment.id);
  if (!canDestroyNow) {
    return;
  }

  const refreshedEnvironment = getEnvironment(deps.db, environment.id);
  if (
    !refreshedEnvironment ||
    refreshedEnvironment.status !== "ready" ||
    !refreshedEnvironment.path
  ) {
    return;
  }

  if (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: refreshedEnvironment.id,
    }) > 0
  ) {
    return;
  }

  if (
    hasPendingThreadShutdownInEnvironment(deps.db, {
      environmentId: refreshedEnvironment.id,
    })
  ) {
    return;
  }

  queueDestroyAndMarkDestroying(deps, {
    hostId: refreshedEnvironment.hostId,
    id: refreshedEnvironment.id,
    operationKind: "destroy",
    path: refreshedEnvironment.path,
    status: refreshedEnvironment.status,
    workspaceProvisionType: refreshedEnvironment.workspaceProvisionType,
  });
}

export async function runEnvironmentCleanupAdvance(
  deps: LoggedWorkSessionDeps,
  args: AdvanceEnvironmentCleanupArgs,
): Promise<void> {
  await deps.lifecycleDedupers.environmentCleanupAdvance.run(
    args.environmentId,
    async () => {
      await advanceEnvironmentCleanup(deps, args);
    },
  );
}

export function requestEnvironmentCleanupAdvance(
  deps: LoggedWorkSessionDeps,
  args: RequestEnvironmentCleanupAdvanceArgs,
): void {
  if (!args.environmentId) {
    return;
  }
  const environmentId = args.environmentId;

  scheduleAfterDaemonIngressResponse({
    config: deps.config,
    context: {
      environmentId,
    },
    logger: deps.logger,
    name: "Environment cleanup advance request",
    work: () => runEnvironmentCleanupAdvance(deps, { environmentId }),
  });
}

export function requestEnvironmentCleanupAndAdvance(
  deps: LoggedWorkSessionDeps,
  args: RequestEnvironmentCleanupAndAdvanceArgs,
): void {
  requestEnvironmentCleanup(deps, args);
  requestEnvironmentCleanupAdvance(deps, args);
}
