import {
  findStoredEventRow as findStoredEventRowRecord,
  getLatestThreadOutputEventRow,
  listRecentStoredEventRows as listRecentStoredEventRowRecords,
  listStoredEventRows as listStoredEventRowRecords,
  listStoredEventRowsInRange as listStoredEventRowRangeRecords,
  listTokenUsageRowsForContextWindowUsage as listTokenUsageRowRecords,
} from "@bb/db";
import type { DbConnection, StoredEventRow } from "@bb/db";
import {
  buildThreadEventRow,
  parseStoredThreadEvent,
} from "@bb/domain";
import type {
  ThreadEvent,
  ThreadEventRow,
  ThreadEventType,
} from "@bb/domain";
import { ApiError } from "../../errors.js";

export type { StoredEventRow } from "@bb/db";

type StoredEventPayloadRow = Pick<
  StoredEventRow,
  "data" | "sequence" | "threadId" | "type"
>;

export interface ListThreadEventRowsArgs {
  afterSeq?: number;
  limit?: number;
  threadId: string;
}

export interface ListStoredEventRowsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface ListRecentStoredEventRowsArgs {
  excludedTypes?: readonly ThreadEventType[];
  threadId: string;
}

export interface ListTokenUsageRowsForContextWindowUsageArgs {
  threadId: string;
}

export interface FindThreadEventArgs {
  afterSeq?: number;
  threadId: string;
  type: ThreadEventType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseStoredEventPayload(row: StoredEventPayloadRow): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    throw new ApiError(
      500,
      "internal_error",
      `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is not valid JSON`,
    );
  }

  const record = toRecord(data);
  if (!record) {
    throw new ApiError(
      500,
      "internal_error",
      `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is malformed`,
    );
  }

  return record;
}

export function parseStoredEvent(row: StoredEventRow): ThreadEvent {
  return parseStoredThreadEvent({
    type: row.type,
    data: parseStoredEventPayload(row),
    threadId: row.threadId,
    providerThreadId: row.providerThreadId,
    turnId: row.turnId,
  });
}

export function parseStoredEventRow(row: StoredEventRow): ThreadEventRow {
  return buildThreadEventRow({
    id: row.id,
    threadId: row.threadId,
    seq: row.sequence,
    createdAt: row.createdAt,
    event: parseStoredEvent(row),
  });
}

export function listThreadEventRows(
  db: DbConnection,
  args: ListThreadEventRowsArgs,
): ThreadEventRow[] {
  const rows = listStoredEventRowRecords(db, {
    afterSequence: args.afterSeq,
    limit: args.limit,
    threadId: args.threadId,
  });
  return rows.map((row) => parseStoredEventRow(row));
}

export function listStoredEventRowsInRange(
  db: DbConnection,
  args: ListStoredEventRowsInRangeArgs,
): StoredEventRow[] {
  return listStoredEventRowRangeRecords(db, args);
}

export function listRecentStoredEventRows(
  db: DbConnection,
  args: ListRecentStoredEventRowsArgs,
): StoredEventRow[] {
  return listRecentStoredEventRowRecords(db, args);
}

export function listTokenUsageRowsForContextWindowUsage(
  db: DbConnection,
  args: ListTokenUsageRowsForContextWindowUsageArgs,
): StoredEventRow[] {
  return listTokenUsageRowRecords(db, args);
}

export function findThreadEvent(
  db: DbConnection,
  args: FindThreadEventArgs,
): ThreadEventRow | null {
  const row = findStoredEventRowRecord(db, {
    afterSequence: args.afterSeq,
    threadId: args.threadId,
    type: args.type,
  });
  return row ? parseStoredEventRow(row) : null;
}

export function getLastThreadOutput(
  db: DbConnection,
  threadId: string,
): string | null {
  const row = getLatestThreadOutputEventRow(db, { threadId });

  if (!row) return null;

  const eventRow = parseStoredEventRow(row);

  if (eventRow.type === "system/manager/user_message") {
    return eventRow.data.text.length > 0 ? eventRow.data.text : null;
  }

  if (
    eventRow.type === "item/completed" &&
    eventRow.data.item.type === "agentMessage" &&
    eventRow.data.item.text.length > 0
  ) {
    return eventRow.data.item.text;
  }

  return null;
}
