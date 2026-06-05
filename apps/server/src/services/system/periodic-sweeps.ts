import { and, eq, isNull } from "drizzle-orm";
import {
  CLOSED_SESSION_ROW_RETENTION_MS,
  compactDatabase,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  DATABASE_COMPACTION_MIN_RECLAIMABLE_BYTES,
  DATABASE_COMPACTION_MIN_RECLAIMABLE_RATIO,
  DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
  DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
  DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
  DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE,
  getDatabaseAutoVacuumMode,
  getDatabaseCompactionStats,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  listStopRequestedThreads,
  environments,
  pruneClosedSessions,
  runIncrementalVacuum,
  shouldCompactDatabase,
  shouldRunIncrementalVacuum,
  sweepDestroyingEnvironments,
  sweepExpiredLeases,
  sweepManagedEnvironments,
  threads,
  truncateCompletedEventItemOutputs,
} from "@bb/db";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { sweepDueAutomations } from "../scheduling/automation-sweep.js";
import { advanceEnvironmentCleanup } from "../environments/environment-cleanup-internal.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { advanceEnvironmentProvisioning } from "../environments/environment-provisioning-internal.js";
import { handleExpiredHostSessionLeases } from "../../internal/session-owner-side-effects.js";
import { sweepDueThreadSchedules } from "../scheduling/thread-schedule-sweep.js";
import {
  advanceProjectDeletion,
  listProjectsPendingDeletion,
} from "../projects/project-deletion.js";
import {
  finalizeStoppedThreadAndAdvanceCleanup,
  hasLiveThreadStartInFlight,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import { advanceThreadProvisioning } from "../threads/thread-provisioning.js";
import { runQueuedMessageAutoSendSweep } from "../threads/queued-messages.js";
import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";

export type EvaluateManagedEnvironmentArchiveCleanupFn =
  typeof advanceEnvironmentCleanup;
export type DatabaseMaintenanceSweepDeps = Pick<AppDeps, "db" | "logger">;

const DATABASE_MAINTENANCE_CHECK_INTERVAL_MS = 60 * 60_000;
const STOP_REQUESTED_THREAD_SWEEP_BATCH_SIZE = 50;

let lastDatabaseMaintenanceCheckAt = 0;
let databaseMaintenanceRunning = false;

export function runDatabaseMaintenanceSweep(
  deps: DatabaseMaintenanceSweepDeps,
  now: number = Date.now(),
): void {
  if (databaseMaintenanceRunning) {
    return;
  }

  if (
    now - lastDatabaseMaintenanceCheckAt <
    DATABASE_MAINTENANCE_CHECK_INTERVAL_MS
  ) {
    return;
  }

  lastDatabaseMaintenanceCheckAt = now;

  const autoVacuumMode = getDatabaseAutoVacuumMode(deps.db);

  if (autoVacuumMode === "incremental") {
    const freelistStats = getDatabaseFreelistStats(deps.db);
    if (
      !shouldRunIncrementalVacuum({
        minFreelistPages: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
        stats: freelistStats,
      })
    ) {
      // Incremental vacuum only reclaims freelist pages. It does not defragment
      // internal page slack reported by dbstat.unused, and checking dbstat here
      // would add an expensive scan to busy servers that cannot act on it.
      deps.logger.debug(
        { freelistStats },
        "Incremental database vacuum skipped below freelist threshold",
      );
      return;
    }
    // This steady-state path may write and checkpoint, but each attempt is
    // capped by page count and DB busy timeout so active app work can proceed.
    databaseMaintenanceRunning = true;
    try {
      const result = runIncrementalVacuum(deps.db, {
        maxPages: DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
      });
      deps.logger.info({ result }, "Incremental database vacuum completed");
    } catch (error) {
      deps.logger.warn({ err: error }, "Incremental database vacuum failed");
    } finally {
      databaseMaintenanceRunning = false;
    }
    return;
  }

  // Non-incremental databases need a full VACUUM to reclaim dbstat-reported
  // internal slack and convert legacy auto_vacuum=NONE databases to
  // incremental mode. A full VACUUM rewrites the file, so only compute the
  // expensive dbstat-based compaction stats after the instance is idle.
  const activity = getDatabaseMaintenanceActivity(deps.db);
  if (!isDatabaseMaintenanceIdle(activity)) {
    deps.logger.debug(
      { activity },
      "Database maintenance skipped while app work is active",
    );
    return;
  }

  const stats = getDatabaseCompactionStats(deps.db);
  if (
    !shouldCompactDatabase({
      minReclaimableBytes: DATABASE_COMPACTION_MIN_RECLAIMABLE_BYTES,
      minReclaimableRatio: DATABASE_COMPACTION_MIN_RECLAIMABLE_RATIO,
      stats,
    })
  ) {
    deps.logger.debug(
      { stats },
      "Database maintenance skipped below compaction threshold",
    );
    return;
  }

  databaseMaintenanceRunning = true;
  try {
    const result = compactDatabase(deps.db);
    deps.logger.info({ result }, "Database compaction completed");
  } catch (error) {
    deps.logger.warn({ err: error }, "Database compaction failed");
  } finally {
    databaseMaintenanceRunning = false;
  }
}

export async function runManagedEnvironmentArchiveCleanupSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  evaluateCleanup: EvaluateManagedEnvironmentArchiveCleanupFn,
): Promise<void> {
  for (const environment of sweepManagedEnvironments(deps.db)) {
    try {
      await evaluateCleanup(deps, {
        environmentId: environment.id,
      });
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        deps.logger.debug(
          {
            environmentId: environment.id,
            ...runtimeErrorLogFields(deps.config, error),
          },
          "Managed environment archive cleanup deferred by host timeout",
        );
        continue;
      }
      deps.logger.warn(
        {
          environmentId: environment.id,
          err: error,
        },
        "Managed environment archive cleanup sweep failed",
      );
    }
  }
}

export async function runProjectDeletionSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  for (const projectId of listProjectsPendingDeletion(deps)) {
    try {
      await advanceProjectDeletion(deps, { projectId });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          projectId,
        },
        "Project deletion sweep failed",
      );
    }
  }
}

export async function runEnvironmentProvisioningSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  const provisioningEnvironments = deps.db
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.status, "provisioning"))
    .all();

  for (const environment of provisioningEnvironments) {
    try {
      await advanceEnvironmentProvisioning(deps, {
        environmentId: environment.id,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          environmentId: environment.id,
        },
        "Environment provisioning sweep failed",
      );
    }
  }
}

export async function runThreadLifecycleSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  const provisioningThreads = deps.db
    .select({
      id: threads.id,
      status: threads.status,
    })
    .from(threads)
    .where(and(eq(threads.status, "provisioning"), isNull(threads.deletedAt)))
    .all();

  for (const thread of provisioningThreads) {
    try {
      if (hasLiveThreadStartInFlight(thread.id)) {
        continue;
      }
      await advanceThreadProvisioning(deps, {
        threadId: thread.id,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: thread.id,
        },
        "Thread provisioning sweep failed",
      );
    }
  }

  const stopRequestedThreads = listStopRequestedThreads(deps.db, {
    limit: STOP_REQUESTED_THREAD_SWEEP_BATCH_SIZE,
  });

  for (const thread of stopRequestedThreads) {
    try {
      if (
        thread.status === "active" ||
        thread.status === "created" ||
        thread.status === "provisioning"
      ) {
        requestThreadStopForCurrentState(
          deps,
          {
            environmentId: thread.environmentId,
            id: thread.threadId,
            status: thread.status,
            stopRequestedAt: thread.stopRequestedAt,
          },
          {
            hostId: thread.hostId,
            id: thread.environmentId,
          },
        );
        continue;
      }

      await finalizeStoppedThreadAndAdvanceCleanup(deps, {
        threadId: thread.threadId,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          threadId: thread.threadId,
        },
        "Thread stop sweep failed",
      );
    }
  }
}

export async function runStartupRecoverySweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  await runEnvironmentProvisioningSweep(deps);
  await runThreadLifecycleSweep(deps);
}

export async function runPeriodicSweeps(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  try {
    const now = Date.now();

    await deps.machineAuth.pruneExpiredKeys();
    truncateCompletedEventItemOutputs(deps.db, {
      createdBefore: now - COMPLETED_EVENT_OUTPUT_RETENTION_MS,
      limit: DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE,
      truncatedAt: now,
    });
    pruneClosedSessions(deps.db, {
      closedBefore: now - CLOSED_SESSION_ROW_RETENTION_MS,
      limit: DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
    });
    const expiredLeases = sweepExpiredLeases(deps.db, deps.hub);
    handleExpiredHostSessionLeases(deps, { expiredLeases });
    sweepDestroyingEnvironments(deps.db, deps.hub);
    await sweepDueAutomations(deps);
    await sweepDueThreadSchedules(deps);
    await runEnvironmentProvisioningSweep(deps);
    runProviderTurnWatchdogSweep(deps, { now });
    await runThreadLifecycleSweep(deps);
    await runQueuedMessageAutoSendSweep(deps);
    await runManagedEnvironmentArchiveCleanupSweep(
      deps,
      advanceEnvironmentCleanup,
    );
    await runProjectDeletionSweep(deps);
    runDatabaseMaintenanceSweep(deps, now);
  } catch (error) {
    deps.logger.error({ err: error }, "Periodic sweep failed");
  }
}
