import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  cancelCommandInTransaction,
  getCommand,
  getEnvironment,
  hostDaemonCommands,
  queueCommandInTransaction,
  threads,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import {
  cancelEnvironmentOperationRecord,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import type { Environment } from "@bb/domain";
import type { EnvironmentProvisionCancelCommand } from "@bb/host-daemon-contract";
import { getActiveEnvironmentProvisionOperation } from "./environment-provisioning-operations.js";

interface EnvironmentProvisionCancellationReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionCancellationWriteDeps extends EnvironmentProvisionCancellationReadDeps {
  hub: DbNotifier;
}

interface EnvironmentProvisionCancellationTransactionDeps extends EnvironmentProvisionCancellationWriteDeps {
  db: DbTransaction;
}

interface CancelEnvironmentProvisioningForThreadStopArgs {
  environmentId: string;
  threadId: string;
}

interface QueueEnvironmentProvisionCancelCommandArgs {
  environment: Environment;
  sessionId: string | null;
}

export type EnvironmentProvisioningCancellationForThreadStopResult =
  | "awaiting_host_cancel"
  | "ready_to_finalize";

function hasOtherLiveThreadDependingOnEnvironmentProvision(
  deps: EnvironmentProvisionCancellationReadDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): boolean {
  const row = deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        ne(threads.id, args.threadId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function restoreEnvironmentAfterProvisionCancellation(
  deps: EnvironmentProvisionCancellationWriteDeps,
  environment: Environment,
): void {
  if (environment.status !== "provisioning") {
    return;
  }
  setEnvironmentStatus(deps.db, deps.hub, environment.id, {
    status: environment.path ? "ready" : "error",
  });
}

function hasActiveEnvironmentProvisionCancelCommand(
  deps: EnvironmentProvisionCancellationReadDeps,
  environmentId: string,
): boolean {
  const row = deps.db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.type, "environment.provision.cancel"),
        inArray(hostDaemonCommands.state, ["pending", "fetched"]),
        sql`json_extract(${hostDaemonCommands.payload}, '$.environmentId') = ${environmentId}`,
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function queueEnvironmentProvisionCancelCommandInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: QueueEnvironmentProvisionCancelCommandArgs,
): void {
  if (hasActiveEnvironmentProvisionCancelCommand(deps, args.environment.id)) {
    return;
  }

  const command: EnvironmentProvisionCancelCommand = {
    type: "environment.provision.cancel",
    environmentId: args.environment.id,
    reason: "thread-stop",
  };
  queueCommandInTransaction(deps.db, {
    hostId: args.environment.hostId,
    sessionId: args.sessionId,
    type: command.type,
    payload: JSON.stringify(command),
  });
  deps.hub.notifyCommand(args.environment.hostId);
}

export function cancelEnvironmentProvisioningForThreadStopInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): EnvironmentProvisioningCancellationForThreadStopResult {
  const operation = getActiveEnvironmentProvisionOperation(
    deps,
    args.environmentId,
  );
  if (!operation) {
    return "ready_to_finalize";
  }

  if (hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)) {
    return "ready_to_finalize";
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return "ready_to_finalize";
  }

  if (operation.commandId !== null) {
    const command = getCommand(deps.db, operation.commandId);
    if (command?.state === "fetched") {
      queueEnvironmentProvisionCancelCommandInTransaction(deps, {
        environment,
        sessionId: command.sessionId,
      });
      return "awaiting_host_cancel";
    }
    if (command?.state === "pending") {
      cancelCommandInTransaction(deps.db, {
        commandId: command.id,
        resultPayload: JSON.stringify({
          errorCode: "environment_provision_cancelled",
          errorMessage: "Environment provisioning was cancelled",
        }),
      });
    }
  }

  cancelEnvironmentOperationRecord(deps.db, {
    environmentId: operation.environmentId,
    kind: operation.kind,
  });
  restoreEnvironmentAfterProvisionCancellation(deps, environment);
  return "ready_to_finalize";
}
