import { and, eq, isNull, ne } from "drizzle-orm";
import {
  getEnvironment,
  threads,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import { setEnvironmentStatus } from "@bb/db/internal-environment-lifecycle";
import type { Environment } from "@bb/domain";

export interface EnvironmentProvisionCancellationReadDeps {
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

export function cancelEnvironmentProvisioningForThreadStopInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): EnvironmentProvisioningCancellationForThreadStopResult {
  if (hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)) {
    return "ready_to_finalize";
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return "ready_to_finalize";
  }

  restoreEnvironmentAfterProvisionCancellation(deps, environment);
  return "ready_to_finalize";
}
