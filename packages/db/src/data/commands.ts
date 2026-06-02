import { and, eq, inArray, sql } from "drizzle-orm";
import type { HostDaemonDurableCommandType } from "@bb/host-daemon-contract";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  hostDaemonCommandAttempts,
  hostDaemonCommands,
  hosts,
} from "../schema.js";
import {
  createHostDaemonCommandAttemptId,
  createHostDaemonCommandId,
} from "../ids.js";

export interface QueueCommandInput {
  hostId: string;
  sessionId: string | null;
  type: HostDaemonDurableCommandType;
  payload: string;
}

type CommandWriteConnection = DbConnection | DbTransaction;
type CommandReadConnection = DbConnection | DbTransaction;
export type HostDaemonCommandAttemptRow =
  typeof hostDaemonCommandAttempts.$inferSelect;
export type HostDaemonCommandRow = typeof hostDaemonCommands.$inferSelect;
export type FetchedHostDaemonCommandRow = HostDaemonCommandRow & {
  attemptId: string;
  deliveredAt: number;
  leaseExpiresAt: number;
};

/** Standard command lease: 60 seconds */
const STANDARD_COMMAND_LEASE_MS = 60_000;

/** Provision command lease: 20 minutes */
const PROVISION_COMMAND_LEASE_MS = 20 * 60_000;

export interface HasPendingHostCommandForThreadArgs {
  hostId: string;
  threadId: string;
  type: "thread.archive" | "thread.stop" | "turn.submit";
}

export interface HasExistingThreadArchiveCommandArgs {
  hostId: string;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export interface GetPendingEnvironmentCommandArgs {
  environmentId: string;
  type: "environment.cleanup_preflight" | "environment.destroy";
}

export interface DeleteQueuedCommandInTransactionArgs {
  commandId: string;
}

export interface GetActiveCommandAttemptArgs {
  attemptId: string;
  commandId: string;
}

export interface GetCommandAttemptArgs extends GetActiveCommandAttemptArgs {}

export interface SettleCommandAttemptInTransactionArgs
  extends GetActiveCommandAttemptArgs {
  settledAt: number;
}

export function getHostDaemonCommandLeaseMs(type: string): number {
  return type === "environment.provision"
    ? PROVISION_COMMAND_LEASE_MS
    : STANDARD_COMMAND_LEASE_MS;
}

export function getCommand(db: CommandReadConnection, id: string) {
  return (
    db
      .select()
      .from(hostDaemonCommands)
      .where(eq(hostDaemonCommands.id, id))
      .get() ?? null
  );
}

export function getActiveCommandAttempt(
  db: CommandReadConnection,
  args: GetActiveCommandAttemptArgs,
): HostDaemonCommandAttemptRow | null {
  return (
    db
      .select()
      .from(hostDaemonCommandAttempts)
      .where(
        and(
          eq(hostDaemonCommandAttempts.id, args.attemptId),
          eq(hostDaemonCommandAttempts.commandId, args.commandId),
          eq(hostDaemonCommandAttempts.status, "active"),
        ),
      )
      .get() ?? null
  );
}

export function getCommandAttempt(
  db: CommandReadConnection,
  args: GetCommandAttemptArgs,
): HostDaemonCommandAttemptRow | null {
  return (
    db
      .select()
      .from(hostDaemonCommandAttempts)
      .where(
        and(
          eq(hostDaemonCommandAttempts.id, args.attemptId),
          eq(hostDaemonCommandAttempts.commandId, args.commandId),
        ),
      )
      .get() ?? null
  );
}

export function getActiveCommandAttemptForCommand(
  db: CommandReadConnection,
  commandId: string,
): HostDaemonCommandAttemptRow | null {
  return (
    db
      .select()
      .from(hostDaemonCommandAttempts)
      .where(
        and(
          eq(hostDaemonCommandAttempts.commandId, commandId),
          eq(hostDaemonCommandAttempts.status, "active"),
        ),
      )
      .get() ?? null
  );
}

function queueCommandRecord(
  db: CommandWriteConnection,
  input: QueueCommandInput,
) {
  const now = Date.now();
  const id = createHostDaemonCommandId();

  const cursorRow =
    db
      .update(hosts)
      .set({ commandCursor: sql`${hosts.commandCursor} + 1` })
      .where(eq(hosts.id, input.hostId))
      .returning({ cursor: hosts.commandCursor })
      .get() ?? null;

  if (!cursorRow) {
    throw new Error(`Cannot queue command for missing host ${input.hostId}`);
  }

  const cursor = cursorRow.cursor;

  return db
    .insert(hostDaemonCommands)
    .values({
      id,
      hostId: input.hostId,
      sessionId: input.sessionId,
      cursor,
      type: input.type,
      payload: input.payload,
      state: "pending",
      retryCount: 0,
      createdAt: now,
    })
    .returning()
    .get();
}

export function queueCommandInTransaction(
  db: DbTransaction,
  input: QueueCommandInput,
) {
  return queueCommandRecord(db, input);
}

export function deleteQueuedCommandInTransaction(
  db: DbTransaction,
  args: DeleteQueuedCommandInTransactionArgs,
): boolean {
  const deleted =
    db
      .delete(hostDaemonCommands)
      .where(
        and(
          eq(hostDaemonCommands.id, args.commandId),
          eq(hostDaemonCommands.state, "pending"),
        ),
      )
      .returning({ id: hostDaemonCommands.id })
      .get() ?? null;
  return deleted !== null;
}

/**
 * Queue a command with a monotonic per-host cursor.
 * Runs in a transaction to ensure cursor uniqueness.
 */
export function queueCommand(
  db: DbConnection,
  notifier: DbNotifier,
  input: QueueCommandInput,
) {
  const command = db.transaction((tx) => queueCommandRecord(tx, input));
  notifier.notifyCommand(input.hostId);
  return command;
}

export function hasPendingHostCommandForThread(
  db: CommandReadConnection,
  args: HasPendingHostCommandForThreadArgs,
): boolean {
  const row = db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.hostId, args.hostId),
        eq(hostDaemonCommands.type, args.type),
        inArray(hostDaemonCommands.state, ["pending", "fetched"]),
        sql`json_extract(${hostDaemonCommands.payload}, '$.threadId') = ${args.threadId}`,
      ),
    )
    .get();

  return row !== undefined;
}

export function hasExistingThreadArchiveCommand(
  db: CommandReadConnection,
  args: HasExistingThreadArchiveCommandArgs,
): boolean {
  const row = db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.hostId, args.hostId),
        eq(hostDaemonCommands.type, "thread.archive"),
        // Completed command payload pruning rewrites old terminal payloads to
        // "{}" after 24h, so successful-command dedupe is intentionally bounded
        // by that retention window. Pending/fetched commands remain durable
        // enough to block active archive sync.
        inArray(hostDaemonCommands.state, ["pending", "fetched", "success"]),
        sql`json_extract(${hostDaemonCommands.payload}, '$.threadId') = ${args.threadId}`,
        sql`json_extract(${hostDaemonCommands.payload}, '$.providerId') = ${args.providerId}`,
        sql`json_extract(${hostDaemonCommands.payload}, '$.providerThreadId') = ${args.providerThreadId}`,
      ),
    )
    .get();

  return row !== undefined;
}

export function getPendingEnvironmentCommand(
  db: CommandReadConnection,
  args: GetPendingEnvironmentCommandArgs,
) {
  return (
    db
      .select({ id: hostDaemonCommands.id })
      .from(hostDaemonCommands)
      .where(
        and(
          eq(hostDaemonCommands.type, args.type),
          inArray(hostDaemonCommands.state, ["pending", "fetched"]),
          sql`json_extract(${hostDaemonCommands.payload}, '$.environmentId') = ${args.environmentId}`,
        ),
      )
      .get() ?? null
  );
}

export interface FetchCommandsOptions {
  hostId: string;
  limit?: number;
  sessionId: string | null;
}

/**
 * Fetch pending commands for a host.
 * Marks them as fetched.
 */
export function fetchCommands(
  db: DbConnection,
  notifier: DbNotifier,
  options: FetchCommandsOptions,
) {
  const { hostId, limit = 100 } = options;
  const now = Date.now();

  return db.transaction((tx) => {
    const commands = tx
      .select()
      .from(hostDaemonCommands)
      .where(
        and(
          eq(hostDaemonCommands.hostId, hostId),
          eq(hostDaemonCommands.state, "pending"),
        ),
      )
      .orderBy(hostDaemonCommands.cursor)
      .limit(limit)
      .all();

    if (commands.length === 0) return [];

    const attempts = new Map<
      string,
      {
        attemptId: string;
        deliveredAt: number;
        leaseExpiresAt: number;
      }
    >();
    for (const command of commands) {
      const leaseExpiresAt = now + getHostDaemonCommandLeaseMs(command.type);
      const attemptId = createHostDaemonCommandAttemptId();
      tx.insert(hostDaemonCommandAttempts)
        .values({
          id: attemptId,
          commandId: command.id,
          sessionId: options.sessionId,
          status: "active",
          deliveredAt: now,
          leaseExpiresAt,
        })
        .run();
      attempts.set(command.id, {
        attemptId,
        deliveredAt: now,
        leaseExpiresAt,
      });
    }

    tx.update(hostDaemonCommands)
      .set({ state: "fetched", fetchedAt: now, sessionId: options.sessionId })
      .where(
        inArray(
          hostDaemonCommands.id,
          commands.map((c) => c.id),
        ),
      )
      .run();

    return commands.map((cmd): FetchedHostDaemonCommandRow => {
      const attempt = attempts.get(cmd.id);
      if (!attempt) {
        throw new Error(`Missing delivery attempt for command ${cmd.id}`);
      }
      return {
        ...cmd,
        ...attempt,
        sessionId: options.sessionId,
        state: "fetched",
        fetchedAt: now,
      };
    });
  });
}

export interface ReportCommandResultInput {
  commandId: string;
  state: "success" | "error";
  completedAt: number;
  resultPayload?: string | null;
}

export interface CancelCommandArgs {
  commandId: string;
  completedAt?: number;
  resultPayload?: string | null;
}

export function settleCommandAttemptInTransaction(
  db: DbTransaction,
  args: SettleCommandAttemptInTransactionArgs,
): HostDaemonCommandAttemptRow | null {
  return (
    db
      .update(hostDaemonCommandAttempts)
      .set({
        status: "settled",
        settledAt: args.settledAt,
      })
      .where(
        and(
          eq(hostDaemonCommandAttempts.id, args.attemptId),
          eq(hostDaemonCommandAttempts.commandId, args.commandId),
          eq(hostDaemonCommandAttempts.status, "active"),
        ),
      )
      .returning()
      .get() ?? null
  );
}

/**
 * Report the result of a command execution.
 */
export function reportCommandResult(
  db: CommandWriteConnection,
  notifier: DbNotifier,
  input: ReportCommandResultInput,
) {
  return (
    db
      .update(hostDaemonCommands)
      .set({
        state: input.state,
        resultPayload: input.resultPayload ?? null,
        completedAt: input.completedAt,
      })
      .where(eq(hostDaemonCommands.id, input.commandId))
      .returning()
      .get() ?? null
  );
}

function isDbConnection(db: CommandWriteConnection): db is DbConnection {
  return "$client" in db;
}

export function cancelCommand(
  db: CommandWriteConnection,
  args: CancelCommandArgs,
) {
  if (!isDbConnection(db)) {
    return cancelCommandInTransaction(db, args);
  }

  return db.transaction(
    (tx) => cancelCommandInTransaction(tx, args),
    { behavior: "immediate" },
  );
}

export function cancelCommandInTransaction(
  db: DbTransaction,
  args: CancelCommandArgs,
) {
  const completedAt = args.completedAt ?? Date.now();
  const command =
    db
      .update(hostDaemonCommands)
      .set({
        state: "error",
        completedAt,
        resultPayload: args.resultPayload ?? null,
      })
      .where(
        and(
          eq(hostDaemonCommands.id, args.commandId),
          inArray(hostDaemonCommands.state, ["pending", "fetched"]),
        ),
      )
      .returning()
      .get() ?? null;

  if (command) {
    db.update(hostDaemonCommandAttempts)
      .set({ status: "settled", settledAt: completedAt })
      .where(
        and(
          eq(hostDaemonCommandAttempts.commandId, args.commandId),
          eq(hostDaemonCommandAttempts.status, "active"),
        ),
      )
      .run();
  }

  return command;
}
