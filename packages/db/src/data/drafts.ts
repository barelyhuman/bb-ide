import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { queuedThreadMessages } from "../schema.js";
import { createDraftId } from "../ids.js";

export interface CreateDraftInput {
  threadId: string;
  content: string;
  model: string;
  reasoningLevel: string;
  sandboxMode: string;
  serviceTier: string;
}

export type DraftRow = typeof queuedThreadMessages.$inferSelect;

export function createDraft(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateDraftInput,
) {
  const now = Date.now();
  const id = createDraftId();
  db.insert(queuedThreadMessages)
    .values({
      id,
      threadId: input.threadId,
      content: input.content,
      model: input.model,
      reasoningLevel: input.reasoningLevel,
      sandboxMode: input.sandboxMode,
      serviceTier: input.serviceTier,
      claimedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  notifier.notifyThread(input.threadId, ["queue-changed"]);
  return db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, id))
    .get()!;
}

export function getDraft(db: DbConnection, id: string) {
  return (
    db
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, id))
      .get() ?? null
  );
}

export function listDrafts(db: DbConnection, threadId: string) {
  return db
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, threadId),
        isNull(queuedThreadMessages.claimedAt),
      ),
    )
    .orderBy(
      asc(queuedThreadMessages.createdAt),
      asc(queuedThreadMessages.id),
    )
    .all();
}

export function claimDraft(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): DraftRow | null {
  const claimedDraft = db.transaction((tx) => {
    const existing = tx
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, id))
      .get();
    if (!existing || existing.claimedAt !== null) {
      return null;
    }

    const now = Date.now();
    const result = tx
      .update(queuedThreadMessages)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(queuedThreadMessages.id, id),
          isNull(queuedThreadMessages.claimedAt),
        ),
      )
      .run();
    if (result.changes === 0) {
      return null;
    }

    return tx
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, id))
      .get() ?? null;
  }, { behavior: "immediate" });

  if (claimedDraft) {
    notifier.notifyThread(claimedDraft.threadId, ["queue-changed"]);
  }
  return claimedDraft;
}

export function claimNextDraft(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
): DraftRow | null {
  const claimedDraft = db.transaction((tx) => {
    const nextDraft = tx
      .select()
      .from(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.threadId, threadId),
          isNull(queuedThreadMessages.claimedAt),
        ),
      )
      .orderBy(
        asc(queuedThreadMessages.createdAt),
        asc(queuedThreadMessages.id),
      )
      .limit(1)
      .get();
    if (!nextDraft) {
      return null;
    }

    const now = Date.now();
    const result = tx
      .update(queuedThreadMessages)
      .set({ claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(queuedThreadMessages.id, nextDraft.id),
          isNull(queuedThreadMessages.claimedAt),
        ),
      )
      .run();
    if (result.changes === 0) {
      return null;
    }

    return tx
      .select()
      .from(queuedThreadMessages)
      .where(eq(queuedThreadMessages.id, nextDraft.id))
      .get() ?? null;
  }, { behavior: "immediate" });

  if (claimedDraft) {
    notifier.notifyThread(claimedDraft.threadId, ["queue-changed"]);
  }
  return claimedDraft;
}

export function releaseDraftClaim(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
): boolean {
  const existing = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, id))
    .get();
  if (!existing || existing.claimedAt === null) {
    return false;
  }

  const now = Date.now();
  const result = db
    .update(queuedThreadMessages)
    .set({ claimedAt: null, updatedAt: now })
    .where(
      and(
        eq(queuedThreadMessages.id, id),
        isNotNull(queuedThreadMessages.claimedAt),
      ),
    )
    .run();
  if (result.changes === 0) {
    return false;
  }

  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}

export function deleteDraft(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, id))
    .get();
  if (!existing) return false;
  db.delete(queuedThreadMessages)
    .where(eq(queuedThreadMessages.id, id))
    .run();
  notifier.notifyThread(existing.threadId, ["queue-changed"]);
  return true;
}
