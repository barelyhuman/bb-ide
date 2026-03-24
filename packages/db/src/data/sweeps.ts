import { eq, and, sql, lt, ne, isNull } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  hostDaemonCommands,
  hostDaemonSessions,
  threads,
  environments,
} from "../schema.js";

/** Standard command TTL: 60 seconds */
const STANDARD_COMMAND_TTL_MS = 60_000;

/** Provision command TTL: 5 minutes */
const PROVISION_COMMAND_TTL_MS = 5 * 60_000;

/**
 * Sweep expired commands (fetched but not completed past TTL).
 *
 * - retryCount 0: re-queue (set state="pending", fetchedAt=null, retryCount=1)
 * - retryCount >= 1: error the command and transition the associated thread to error
 *
 * Returns { requeued: number; errored: number }
 */
export function sweepExpiredCommands(
  db: DbConnection,
  notifier: DbNotifier,
  now?: number,
) {
  const currentTime = now ?? Date.now();
  let requeued = 0;
  let errored = 0;

  // Find all fetched commands
  const fetchedCommands = db
    .select()
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.state, "fetched"))
    .all();

  for (const cmd of fetchedCommands) {
    if (cmd.fetchedAt == null) continue;

    const ttl =
      cmd.type === "environment.provision"
        ? PROVISION_COMMAND_TTL_MS
        : STANDARD_COMMAND_TTL_MS;

    if (currentTime - cmd.fetchedAt < ttl) continue;

    if (cmd.retryCount === 0) {
      // Re-queue: set back to pending with retryCount=1
      db.update(hostDaemonCommands)
        .set({
          state: "pending",
          fetchedAt: null,
          retryCount: 1,
        })
        .where(eq(hostDaemonCommands.id, cmd.id))
        .run();
      requeued++;
    } else {
      // Error the command
      db.update(hostDaemonCommands)
        .set({
          state: "error",
          completedAt: currentTime,
          resultPayload: JSON.stringify({
            error: "Command expired after retry",
          }),
        })
        .where(eq(hostDaemonCommands.id, cmd.id))
        .run();
      errored++;

      // Try to extract threadId from payload and error the thread
      try {
        const payload = JSON.parse(cmd.payload);
        if (payload.threadId) {
          const thread = db
            .select()
            .from(threads)
            .where(eq(threads.id, payload.threadId))
            .get();
          if (thread && thread.status !== "error") {
            db.update(threads)
              .set({ status: "error", updatedAt: currentTime })
              .where(eq(threads.id, payload.threadId))
              .run();
            notifier.notifyThread(payload.threadId, ["status-changed"]);
          }
        }
      } catch {
        // payload may not contain threadId, that's fine
      }
    }
  }

  return { requeued, errored };
}

/**
 * Sweep expired leases: sessions past lease timeout.
 * - Close the session (status="closed", closeReason="expired")
 * - Error all active/idle threads on that host
 *
 * Returns { sessionsClosed: number; threadsErrored: number }
 */
export function sweepExpiredLeases(
  db: DbConnection,
  notifier: DbNotifier,
  now?: number,
) {
  const currentTime = now ?? Date.now();
  let sessionsClosed = 0;
  let threadsErrored = 0;

  // Find active sessions past their lease
  const expiredSessions = db
    .select()
    .from(hostDaemonSessions)
    .where(
      and(
        eq(hostDaemonSessions.status, "active"),
        lt(hostDaemonSessions.leaseExpiresAt, currentTime),
      ),
    )
    .all();

  for (const session of expiredSessions) {
    // Close the session
    db.update(hostDaemonSessions)
      .set({
        status: "closed",
        closedAt: currentTime,
        closeReason: "expired",
        updatedAt: currentTime,
      })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();
    sessionsClosed++;

    notifier.notifySystem(["host-disconnected"]);

    // Find environments on this host
    const hostEnvironments = db
      .select()
      .from(environments)
      .where(eq(environments.hostId, session.hostId))
      .all();

    // Error all active/idle threads in those environments
    for (const env of hostEnvironments) {
      const activeThreads = db
        .select()
        .from(threads)
        .where(
          and(
            eq(threads.environmentId, env.id),
            sql`${threads.status} IN ('active', 'idle', 'provisioning')`,
          ),
        )
        .all();

      for (const thread of activeThreads) {
        db.update(threads)
          .set({ status: "error", updatedAt: currentTime })
          .where(eq(threads.id, thread.id))
          .run();
        threadsErrored++;
        notifier.notifyThread(thread.id, ["status-changed"]);
      }
    }
  }

  return { sessionsClosed, threadsErrored };
}

/**
 * Sweep managed environments with zero non-archived threads.
 * Returns the list of environment records that are candidates for cleanup.
 * The caller decides what to do (e.g., queue destroy commands).
 */
export function sweepManagedEnvironments(db: DbConnection) {
  // Find managed environments
  const managedEnvs = db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.managed, true),
        ne(environments.status, "destroying"),
      ),
    )
    .all();

  const candidates = [];
  for (const env of managedEnvs) {
    // Count non-archived threads referencing this environment
    const nonArchivedThreads = db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, env.id),
          isNull(threads.archivedAt),
        ),
      )
      .all();

    if (nonArchivedThreads.length === 0) {
      candidates.push(env);
    }
  }

  return candidates;
}
