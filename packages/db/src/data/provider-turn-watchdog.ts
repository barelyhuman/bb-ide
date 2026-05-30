import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  providerTurnWatchdogActivityEventTypeSchema,
  providerTurnWatchdogActivityEventTypeValues,
} from "@bb/domain";
import type { ProviderTurnWatchdogActivityEventType } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { environments, events, pendingInteractions, threads } from "../schema.js";

export interface ListProviderTurnIdleWatchdogCandidatesArgs {
  idleThresholdMs: number;
  limit: number;
  now: number;
}

export interface ProviderTurnIdleWatchdogCandidateRow {
  activeTurnId: string;
  activeTurnStartedAt: number;
  elapsedMs: number;
  environmentId: string;
  hostId: string;
  lastActivityEventAt: number;
  lastActivityEventSequence: number;
  lastActivityEventType: ProviderTurnWatchdogActivityEventType;
  providerId: string;
  providerThreadId: string | null;
  threadId: string;
}

const activityEventTypeSqlList = sql.join(
  providerTurnWatchdogActivityEventTypeValues.map((eventType) =>
    sql`${eventType}`,
  ),
  sql`, `,
);

function parseNonEmptyString(value: string | null, fieldName: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`Provider turn watchdog candidate missing ${fieldName}`);
  }
  return value;
}

function parseNonNegativeInteger(
  value: number | null,
  fieldName: string,
): number {
  if (value === null || !Number.isInteger(value) || value < 0) {
    throw new Error(`Provider turn watchdog candidate invalid ${fieldName}`);
  }
  return value;
}

function parsePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Provider turn watchdog candidate invalid ${fieldName}`);
  }
  return value;
}

function parseProviderTurnIdleWatchdogCandidateRow(
  row: Omit<
    ProviderTurnIdleWatchdogCandidateRow,
    "activeTurnId" | "activeTurnStartedAt" | "lastActivityEventType"
  > & {
    activeTurnId: string | null;
    activeTurnStartedAt: number | null;
    lastActivityEventType: string;
  },
): ProviderTurnIdleWatchdogCandidateRow {
  return {
    activeTurnId: parseNonEmptyString(row.activeTurnId, "activeTurnId"),
    activeTurnStartedAt: parseNonNegativeInteger(
      row.activeTurnStartedAt,
      "activeTurnStartedAt",
    ),
    elapsedMs: parseNonNegativeInteger(row.elapsedMs, "elapsedMs"),
    environmentId: row.environmentId,
    hostId: row.hostId,
    lastActivityEventAt: parseNonNegativeInteger(
      row.lastActivityEventAt,
      "lastActivityEventAt",
    ),
    lastActivityEventSequence: parsePositiveInteger(
      row.lastActivityEventSequence,
      "lastActivityEventSequence",
    ),
    lastActivityEventType: providerTurnWatchdogActivityEventTypeSchema.parse(
      row.lastActivityEventType,
    ),
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    threadId: row.threadId,
  };
}

export function listProviderTurnIdleWatchdogCandidates(
  db: DbQueryConnection,
  args: ListProviderTurnIdleWatchdogCandidatesArgs,
): ProviderTurnIdleWatchdogCandidateRow[] {
  const rows = db
    .select({
      activeTurnId: events.turnId,
      activeTurnStartedAt: sql<number | null>`(
        SELECT started.created_at
        FROM events AS started
        WHERE started.thread_id = ${events.threadId}
          AND started.turn_id = ${events.turnId}
          AND started.type = 'turn/started'
        ORDER BY started.sequence DESC
        LIMIT 1
      )`,
      elapsedMs: sql<number>`${args.now} - ${events.createdAt}`,
      environmentId: environments.id,
      hostId: environments.hostId,
      lastActivityEventAt: events.createdAt,
      lastActivityEventSequence: events.sequence,
      lastActivityEventType: events.type,
      providerId: threads.providerId,
      providerThreadId: sql<string | null>`COALESCE(
        ${events.providerThreadId},
        (
          SELECT latest_provider.provider_thread_id
          FROM events AS latest_provider
          WHERE latest_provider.thread_id = ${events.threadId}
            AND latest_provider.provider_thread_id IS NOT NULL
          ORDER BY latest_provider.sequence DESC
          LIMIT 1
        )
      )`,
      threadId: threads.id,
    })
    .from(events)
    .innerJoin(threads, eq(threads.id, events.threadId))
    .innerJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        isNotNull(threads.environmentId),
        isNotNull(events.turnId),
        inArray(events.type, [...providerTurnWatchdogActivityEventTypeValues]),
        sql`${events.turnId} = (
          SELECT latest_started.turn_id
          FROM events AS latest_started
          WHERE latest_started.thread_id = ${threads.id}
            AND latest_started.type = 'turn/started'
            AND latest_started.turn_id IS NOT NULL
          ORDER BY latest_started.sequence DESC
          LIMIT 1
        )`,
        sql`${events.sequence} = (
          SELECT MAX(activity.sequence)
          FROM events AS activity
          WHERE activity.thread_id = ${events.threadId}
            AND activity.turn_id = ${events.turnId}
            AND activity.type IN (${activityEventTypeSqlList})
        )`,
        sql`NOT EXISTS (
          SELECT 1
          FROM events AS completed
          WHERE completed.thread_id = ${events.threadId}
            AND completed.turn_id = ${events.turnId}
            AND completed.type = 'turn/completed'
        )`,
        sql`${args.now} - ${events.createdAt} >= ${args.idleThresholdMs}`,
        sql`NOT EXISTS (
          SELECT 1
          FROM ${pendingInteractions} AS active_interaction
          WHERE active_interaction.thread_id = ${threads.id}
            AND active_interaction.turn_id = ${events.turnId}
            AND active_interaction.status IN ('pending', 'resolving')
        )`,
      ),
    )
    .orderBy(asc(events.createdAt))
    .limit(args.limit)
    .all();

  return rows.map(parseProviderTurnIdleWatchdogCandidateRow);
}
