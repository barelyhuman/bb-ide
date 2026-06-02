import { and, count, desc, eq, gt, isNotNull, or } from "drizzle-orm";
import {
  events,
  hostDaemonCommands,
  hostDaemonSessions,
  threads,
  type DbConnection,
} from "@bb/db";
import {
  hostDaemonCommandSchema,
  type HostDaemonCommand,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";

export interface QueuedCommand {
  command: HostDaemonCommand;
  completedAt: number | null;
  createdAt: number;
  cursor: number;
  fetchedAt: number | null;
  hostId: string;
  id: string;
  payload: string;
  retryCount: number;
  sessionId: string | null;
  state: string;
  type: string;
}

export interface ListQueuedCommandsForHostAfterCursorArgs {
  cursor: number;
  hostId: string;
}

export interface StoredTurnEventRow {
  sequence: number;
  turnId: string | null;
  type: string;
}

function parseQueuedCommand(
  row: typeof hostDaemonCommands.$inferSelect,
): QueuedCommand {
  return {
    command: hostDaemonCommandSchema.parse(JSON.parse(row.payload)),
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    cursor: row.cursor,
    fetchedAt: row.fetchedAt ?? null,
    hostId: row.hostId,
    id: row.id,
    payload: row.payload,
    retryCount: row.retryCount,
    sessionId: row.sessionId ?? null,
    state: row.state,
    type: row.type,
  };
}

export function listQueuedCommands(db: DbConnection): QueuedCommand[] {
  return db
    .select()
    .from(hostDaemonCommands)
    .orderBy(hostDaemonCommands.cursor)
    .all()
    .map(parseQueuedCommand);
}

export function listQueuedCommandsForHostAfterCursor(
  db: DbConnection,
  args: ListQueuedCommandsForHostAfterCursorArgs,
): QueuedCommand[] {
  return db
    .select()
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.hostId, args.hostId),
        gt(hostDaemonCommands.cursor, args.cursor),
      ),
    )
    .orderBy(hostDaemonCommands.cursor)
    .all()
    .map(parseQueuedCommand);
}

export function listPendingHostCommands(
  db: DbConnection,
  hostId: string,
): QueuedCommand[] {
  return db
    .select()
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.hostId, hostId),
        or(
          eq(hostDaemonCommands.state, "pending"),
          eq(hostDaemonCommands.state, "fetched"),
        ),
      ),
    )
    .orderBy(hostDaemonCommands.cursor)
    .all()
    .map(parseQueuedCommand);
}

export function countQueuedCommandsByType(
  db: DbConnection,
  type: HostDaemonDurableCommandType,
): number {
  return (
    db
      .select({ count: count() })
      .from(hostDaemonCommands)
      .where(eq(hostDaemonCommands.type, type))
      .get()?.count ?? 0
  );
}

export function readStoredTurnEvents(
  db: DbConnection,
  threadId: string,
): StoredTurnEventRow[] {
  return db
    .select({
      sequence: events.sequence,
      turnId: events.turnId,
      type: events.type,
    })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all();
}

export function readSessionRow(
  db: DbConnection,
  sessionId: string,
): typeof hostDaemonSessions.$inferSelect | null {
  return (
    db
      .select()
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.id, sessionId))
      .get() ?? null
  );
}

export function readLatestProviderThreadId(
  db: DbConnection,
  threadId: string,
): string | null {
  return (
    db
      .select({ providerThreadId: events.providerThreadId })
      .from(events)
      .where(
        and(eq(events.threadId, threadId), isNotNull(events.providerThreadId)),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get()?.providerThreadId ?? null
  );
}

export function countStoredThreads(db: DbConnection): number {
  return db.select({ count: count() }).from(threads).get()?.count ?? 0;
}
