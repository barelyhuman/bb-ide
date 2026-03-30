import { and, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { events } from "@bb/db";
import {
  providerEventSchema,
  systemManagerUserMessageEventDataSchema,
} from "@bb/domain";
import type { ThreadEventRow, ThreadEventType } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../errors.js";

interface StoredEventRow {
  createdAt: number;
  data: string;
  id: string;
  sequence: number;
  threadId: string;
  type: string;
}

export function decodeEventRow(row: StoredEventRow): ThreadEventRow {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.sequence,
    type: row.type,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export function listThreadEventRows(
  db: DbConnection,
  args: {
    afterSeq?: number;
    limit?: number;
    threadId: string;
  },
): ThreadEventRow[] {
  const rows = db
    .select()
    .from(events)
    .where(
      args.afterSeq === undefined
        ? eq(events.threadId, args.threadId)
        : and(eq(events.threadId, args.threadId), gt(events.sequence, args.afterSeq)),
    )
    .orderBy(events.sequence)
    .limit(args.limit ?? Number.MAX_SAFE_INTEGER)
    .all();

  return rows.map((row) => decodeEventRow(row));
}

export function listThreadEventRowsInRange(
  db: DbConnection,
  args: {
    seqEnd: number;
    seqStart: number;
    threadId: string;
  },
): ThreadEventRow[] {
  const rows = db
    .select()
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .orderBy(events.sequence)
    .all();

  return rows.map((row) => decodeEventRow(row));
}

export function listRecentThreadEventRows(
  db: DbConnection,
  args: {
    limit?: number;
    threadId: string;
  },
): ThreadEventRow[] {
  const rows = db
    .select()
    .from(events)
    .where(eq(events.threadId, args.threadId))
    .orderBy(desc(events.sequence))
    .limit(args.limit ?? Number.MAX_SAFE_INTEGER)
    .all()
    .reverse();

  return rows.map((row) => decodeEventRow(row));
}

export function findThreadEvent(
  db: DbConnection,
  args: { threadId: string; type: string; afterSeq?: number },
): ThreadEventRow | null {
  // ThreadEventType is a union of string literals with no runtime values array,
  // so we cannot validate at compile time. Cast for drizzle's typed column —
  // a non-matching string simply returns no rows, which is correct behavior.
  const eventType = args.type as ThreadEventType;
  const row = db
    .select()
    .from(events)
    .where(
      args.afterSeq !== undefined
        ? and(eq(events.threadId, args.threadId), eq(events.type, eventType), gt(events.sequence, args.afterSeq))
        : and(eq(events.threadId, args.threadId), eq(events.type, eventType)),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get();
  return row ? decodeEventRow(row) : null;
}

export function getLastThreadOutput(
  db: DbConnection,
  threadId: string,
): string | null {
  const rows = db
    .select()
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        inArray(events.type, ["item/completed", "system/manager/user_message"]),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(20)
    .all();

  for (const row of rows) {
    if (row.type === "system/manager/user_message") {
      let messageData: unknown;
      try {
        messageData = JSON.parse(row.data);
      } catch {
        throw new ApiError(
          500,
          "internal_error",
          `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is not valid JSON`,
        );
      }
      const parsedMessage = systemManagerUserMessageEventDataSchema.safeParse(
        messageData,
      );
      if (!parsedMessage.success) {
        throw new ApiError(
          500,
          "internal_error",
          `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is malformed`,
        );
      }
      if (parsedMessage.data.text.length > 0) {
        return parsedMessage.data.text;
      }
      continue;
    }

    if (!row.providerThreadId || !row.turnId) {
      throw new ApiError(
        500,
        "internal_error",
        `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is missing provider context`,
      );
    }
    let providerData: unknown;
    try {
      providerData = JSON.parse(row.data);
    } catch {
      throw new ApiError(
        500,
        "internal_error",
        `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is not valid JSON`,
      );
    }
    if (!providerData || typeof providerData !== "object" || Array.isArray(providerData)) {
      throw new ApiError(
        500,
        "internal_error",
        `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is malformed`,
      );
    }
    const parsedEvent = providerEventSchema.safeParse({
      ...providerData,
      type: row.type,
      threadId: row.threadId,
      providerThreadId: row.providerThreadId,
      turnId: row.turnId,
    });
    if (!parsedEvent.success) {
      throw new ApiError(
        500,
        "internal_error",
        `Stored ${row.type} event #${row.sequence} for thread ${row.threadId} is malformed`,
      );
    }
    if (
      parsedEvent.data.type === "item/completed" &&
      parsedEvent.data.item.type === "agentMessage" &&
      parsedEvent.data.item.text.length > 0
    ) {
      return parsedEvent.data.item.text;
    }
  }

  return null;
}
