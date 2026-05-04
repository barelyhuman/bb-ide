import {
  listDrafts,
  listStoredProjectPromptHistoryEventRows,
  listStoredThreadPromptHistoryEventRows,
  type DraftRow,
  type StoredPromptHistoryEventRow,
} from "@bb/db";
import { takeVisiblePromptHistoryEntries } from "@bb/domain";
import type { PromptHistoryEntry } from "@bb/domain";
import { parseStoredTurnRequestEvent } from "./threads/thread-events.js";
import { toQueuedMessage } from "./threads/drafts.js";
import type { AppDeps, ServerLogger } from "../types.js";

interface PromptHistoryArgs {
  limit: number;
}

interface ProjectPromptHistoryArgs extends PromptHistoryArgs {
  projectId: string;
}

interface ThreadPromptHistoryArgs extends PromptHistoryArgs {
  threadId: string;
}

type PromptHistoryServiceDeps = Pick<AppDeps, "db" | "logger">;

type InternalPromptHistoryEntryState = "accepted" | "queued";

interface InternalPromptHistoryEntry extends PromptHistoryEntry {
  state: InternalPromptHistoryEntryState;
}

type PromptHistoryRowLogContext = Record<string, number | string>;

interface BuildPromptHistoryEntriesArgs<TRow> {
  buildEntry: (row: TRow) => InternalPromptHistoryEntry;
  describeRow: (row: TRow) => PromptHistoryRowLogContext;
  logger: ServerLogger;
  rows: readonly TRow[];
}

function buildAcceptedPromptHistoryEntry(
  row: StoredPromptHistoryEventRow,
): InternalPromptHistoryEntry {
  const event = parseStoredTurnRequestEvent(row);
  return {
    id: `event:${row.id}`,
    createdAt: row.createdAt,
    input: event.input,
    state: "accepted",
  };
}

function buildQueuedPromptHistoryEntry(
  row: DraftRow,
): InternalPromptHistoryEntry {
  const queuedMessage = toQueuedMessage(row);
  return {
    id: `draft:${queuedMessage.id}`,
    createdAt: queuedMessage.createdAt,
    input: queuedMessage.content,
    state: "queued",
  };
}

function comparePromptHistoryEntries(
  left: InternalPromptHistoryEntry,
  right: InternalPromptHistoryEntry,
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  if (left.state !== right.state) {
    // Keep queued drafts ahead of accepted rows on timestamp ties so recall
    // prefers the still-editable queued version.
    return left.state === "queued" ? -1 : 1;
  }
  return right.id.localeCompare(left.id);
}

function toPromptHistoryEntry(
  entry: InternalPromptHistoryEntry,
): PromptHistoryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    input: entry.input,
  };
}

function buildPromptHistoryEntries<TRow>({
  buildEntry,
  describeRow,
  logger,
  rows,
}: BuildPromptHistoryEntriesArgs<TRow>): InternalPromptHistoryEntry[] {
  const entries: InternalPromptHistoryEntry[] = [];

  for (const row of rows) {
    try {
      entries.push(buildEntry(row));
    } catch (error) {
      logger.warn(
        {
          ...describeRow(row),
          err: error,
        },
        "Skipping malformed prompt history row",
      );
    }
  }

  return entries;
}

function buildVisibleThreadPromptHistory(
  queuedEntries: readonly InternalPromptHistoryEntry[],
  acceptedEntries: readonly InternalPromptHistoryEntry[],
  limit: number,
): PromptHistoryEntry[] {
  const mergedEntries = [...queuedEntries, ...acceptedEntries].sort(
    comparePromptHistoryEntries,
  );
  return takeVisiblePromptHistoryEntries({
    entries: mergedEntries,
    limit,
  }).map(toPromptHistoryEntry);
}

export function listProjectPromptHistory(
  deps: PromptHistoryServiceDeps,
  args: ProjectPromptHistoryArgs,
): PromptHistoryEntry[] {
  const acceptedEntries = buildPromptHistoryEntries({
    rows: listStoredProjectPromptHistoryEventRows(deps.db, {
      projectId: args.projectId,
      limit: args.limit,
    }),
    logger: deps.logger,
    buildEntry: buildAcceptedPromptHistoryEntry,
    describeRow: (row) => ({
      eventId: row.id,
      sequence: row.sequence,
      threadId: row.threadId,
      type: row.type,
    }),
  });

  return takeVisiblePromptHistoryEntries({
    entries: acceptedEntries,
    limit: args.limit,
  }).map(toPromptHistoryEntry);
}

export function listThreadPromptHistory(
  deps: PromptHistoryServiceDeps,
  args: ThreadPromptHistoryArgs,
): PromptHistoryEntry[] {
  const queuedEntries = buildPromptHistoryEntries({
    rows: listDrafts(deps.db, args.threadId),
    logger: deps.logger,
    buildEntry: buildQueuedPromptHistoryEntry,
    describeRow: (row) => ({
      draftId: row.id,
      threadId: row.threadId,
    }),
  });
  const acceptedEntries = buildPromptHistoryEntries({
    rows: listStoredThreadPromptHistoryEventRows(deps.db, {
      threadId: args.threadId,
      limit: args.limit,
    }),
    logger: deps.logger,
    buildEntry: buildAcceptedPromptHistoryEntry,
    describeRow: (row) => ({
      eventId: row.id,
      sequence: row.sequence,
      threadId: row.threadId,
      type: row.type,
    }),
  });

  return buildVisibleThreadPromptHistory(
    queuedEntries,
    acceptedEntries,
    args.limit,
  );
}
