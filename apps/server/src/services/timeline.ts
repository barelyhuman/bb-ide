import {
  buildTimelineRows,
  decodeRow,
  extractThreadContextWindowUsage,
  toViewMessages,
} from "@bb/core-ui";
import type { Thread } from "@bb/domain";
import type {
  ThreadTimelineResponse,
  TimelineToolDetailsResponse,
} from "@bb/server-contract";
import type { DbConnection } from "@bb/db";
import {
  type StoredEventRow,
  listRecentStoredEventRows,
  listTokenUsageRowsForContextWindowUsage,
  listThreadEventRowsInRange,
  parseStoredEventRow,
} from "./thread-data.js";

const TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/tokenUsage/updated",
] as const;
const MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION = 1000;

export function compactSummaryStoredEventRows(
  rows: readonly StoredEventRow[],
): readonly StoredEventRow[] {
  let agentMessageDeltaCount = 0;
  for (const row of rows) {
    if (row.type === "item/agentMessage/delta") {
      agentMessageDeltaCount += 1;
    }
  }

  if (agentMessageDeltaCount < MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION) {
    return rows;
  }

  const completedAgentMessageItemIds = new Set<string>();
  for (const row of rows) {
    const itemId =
      row.type === "item/completed" && row.itemKind === "agentMessage"
        ? row.itemId
        : null;
    if (itemId) {
      completedAgentMessageItemIds.add(itemId);
    }
  }

  if (completedAgentMessageItemIds.size === 0) {
    return rows;
  }

  const retainedCompletedDeltaItemIds = new Set<string>();
  const compactedRows: StoredEventRow[] = [];

  for (const row of rows) {
    const itemId =
      row.type === "item/agentMessage/delta"
        ? row.itemId
        : null;
    if (!itemId || !completedAgentMessageItemIds.has(itemId)) {
      compactedRows.push(row);
      continue;
    }
    if (retainedCompletedDeltaItemIds.has(itemId)) {
      continue;
    }
    retainedCompletedDeltaItemIds.add(itemId);
    compactedRows.push(row);
  }

  return compactedRows;
}

export function buildThreadTimeline(
  db: DbConnection,
  thread: Thread,
  options: {
    includeManagerDebugView?: boolean;
    includeToolGroupMessages?: boolean;
  },
): ThreadTimelineResponse {
  const rawEventRows = listRecentStoredEventRows(db, {
    threadId: thread.id,
    ...(options.includeManagerDebugView === true
      ? {}
      : { excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES }),
  });
  const eventRows = compactSummaryStoredEventRows(rawEventRows);
  const messages = toViewMessages(eventRows.map((row) => decodeRow(parseStoredEventRow(row))), {
    includeDebugRawEvents: options.includeManagerDebugView,
    includeInternalSystemMessages: options.includeManagerDebugView,
    threadStatus: thread.status,
    threadType: thread.type,
  });
  const tokenUsageRows = listTokenUsageRowsForContextWindowUsage(db, {
    threadId: thread.id,
  });

  return {
    rows: buildTimelineRows(messages, {
      includeToolGroupMessages: options.includeToolGroupMessages ?? false,
    }),
    contextWindowUsage:
      extractThreadContextWindowUsage(tokenUsageRows.map((row) => parseStoredEventRow(row))) ?? undefined,
  };
}

export function buildTimelineToolDetails(
  db: DbConnection,
  thread: Thread,
  options: {
    includeManagerDebugView?: boolean;
    sourceSeqEnd: number;
    sourceSeqStart: number;
  },
): TimelineToolDetailsResponse {
  const eventRows = listThreadEventRowsInRange(db, {
    threadId: thread.id,
    seqStart: options.sourceSeqStart,
    seqEnd: options.sourceSeqEnd,
  });

  return {
    messages: toViewMessages(eventRows.map((row) => decodeRow(row)), {
      includeDebugRawEvents: options.includeManagerDebugView,
      includeInternalSystemMessages: options.includeManagerDebugView,
      threadStatus: thread.status,
      threadType: thread.type,
    }),
  };
}
