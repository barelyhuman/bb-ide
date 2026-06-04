import { and, eq, inArray } from "drizzle-orm";
import type {
  ClientTurnRequestCommandType,
  ClientTurnRequestTerminalReason,
  TerminalClientTurnRequestStatus,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { clientTurnRequests } from "../schema.js";

type ClientTurnRequestReadConnection = DbConnection | DbTransaction;

export type ClientTurnRequestRow = typeof clientTurnRequests.$inferSelect;

export interface CreatePendingClientTurnRequestArgs {
  commandId: string;
  commandType: ClientTurnRequestCommandType;
  createdAt?: number;
  environmentId: string | null;
  requestEventSequence: number;
  requestId: string;
  threadId: string;
}

export interface GetClientTurnRequestArgs {
  requestId: string;
}

export interface ListClientTurnRequestsByThreadAndRequestIdsArgs {
  requestIds: readonly string[];
  threadId: string;
}

export interface MarkClientTurnRequestAcceptedArgs {
  requestId: string;
  settledAt?: number;
  threadId: string;
}

export interface RecordClientTurnRequestCommandCompletedArgs {
  commandCompletedAt: number;
  commandId: string;
}

export interface SettleClientTurnRequestsForCommandArgs {
  commandCompletedAt?: number | null;
  commandId: string;
  message?: string | null;
  reasonCode: ClientTurnRequestTerminalReason;
  settledAt?: number;
  status: TerminalClientTurnRequestStatus;
}

export interface SettlePendingClientTurnRequestsForThreadsArgs {
  commandCompletedAt?: number | null;
  message?: string | null;
  reasonCode: ClientTurnRequestTerminalReason;
  settledAt?: number;
  status: TerminalClientTurnRequestStatus;
  threadIds: readonly string[];
}

export function createPendingClientTurnRequestInTransaction(
  db: DbTransaction,
  args: CreatePendingClientTurnRequestArgs,
): ClientTurnRequestRow {
  const existing = getClientTurnRequest(db, { requestId: args.requestId });
  if (existing) {
    return existing;
  }

  const now = args.createdAt ?? Date.now();
  return db
    .insert(clientTurnRequests)
    .values({
      commandId: args.commandId,
      commandType: args.commandType,
      createdAt: now,
      environmentId: args.environmentId,
      requestEventSequence: args.requestEventSequence,
      requestId: args.requestId,
      status: "pending",
      threadId: args.threadId,
    })
    .returning()
    .get();
}

export function getClientTurnRequest(
  db: ClientTurnRequestReadConnection,
  args: GetClientTurnRequestArgs,
): ClientTurnRequestRow | null {
  return (
    db
      .select()
      .from(clientTurnRequests)
      .where(eq(clientTurnRequests.requestId, args.requestId))
      .get() ?? null
  );
}

export function listClientTurnRequestsByThreadAndRequestIds(
  db: ClientTurnRequestReadConnection,
  args: ListClientTurnRequestsByThreadAndRequestIdsArgs,
): ClientTurnRequestRow[] {
  if (args.requestIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(clientTurnRequests)
    .where(
      and(
        eq(clientTurnRequests.threadId, args.threadId),
        inArray(clientTurnRequests.requestId, [...args.requestIds]),
      ),
    )
    .all();
}

export function markClientTurnRequestAcceptedInTransaction(
  db: DbTransaction,
  args: MarkClientTurnRequestAcceptedArgs,
): ClientTurnRequestRow | null {
  const settledAt = args.settledAt ?? Date.now();
  return (
    db
      .update(clientTurnRequests)
      .set({
        reasonCode: "accepted",
        settledAt,
        status: "accepted",
      })
      .where(
        and(
          eq(clientTurnRequests.requestId, args.requestId),
          eq(clientTurnRequests.threadId, args.threadId),
          eq(clientTurnRequests.status, "pending"),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function recordClientTurnRequestCommandCompletedInTransaction(
  db: DbTransaction,
  args: RecordClientTurnRequestCommandCompletedArgs,
): ClientTurnRequestRow[] {
  return db
    .update(clientTurnRequests)
    .set({
      commandCompletedAt: args.commandCompletedAt,
    })
    .where(eq(clientTurnRequests.commandId, args.commandId))
    .returning()
    .all();
}

export function settleClientTurnRequestsForCommandInTransaction(
  db: DbTransaction,
  args: SettleClientTurnRequestsForCommandArgs,
): ClientTurnRequestRow[] {
  const settledAt = args.settledAt ?? Date.now();
  return db
    .update(clientTurnRequests)
    .set({
      commandCompletedAt: args.commandCompletedAt ?? undefined,
      message: args.message ?? null,
      reasonCode: args.reasonCode,
      settledAt,
      status: args.status,
    })
    .where(
      and(
        eq(clientTurnRequests.commandId, args.commandId),
        eq(clientTurnRequests.status, "pending"),
      ),
    )
    .returning()
    .all();
}

export function settlePendingClientTurnRequestsForThreadsInTransaction(
  db: DbTransaction,
  args: SettlePendingClientTurnRequestsForThreadsArgs,
): ClientTurnRequestRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  const settledAt = args.settledAt ?? Date.now();
  return db
    .update(clientTurnRequests)
    .set({
      commandCompletedAt: args.commandCompletedAt ?? undefined,
      message: args.message ?? null,
      reasonCode: args.reasonCode,
      settledAt,
      status: args.status,
    })
    .where(
      and(
        inArray(clientTurnRequests.threadId, [...args.threadIds]),
        eq(clientTurnRequests.status, "pending"),
      ),
    )
    .returning()
    .all();
}

export function createPendingClientTurnRequest(
  db: DbConnection,
  args: CreatePendingClientTurnRequestArgs,
): ClientTurnRequestRow {
  return db.transaction((tx) =>
    createPendingClientTurnRequestInTransaction(tx, args),
  );
}
