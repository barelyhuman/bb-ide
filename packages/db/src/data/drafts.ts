import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { queuedThreadMessages } from "../schema.js";
import { createDraftId } from "../ids.js";

export interface CreateDraftInput {
  threadId: string;
  content: string;
  mode: string;
  reasoningLevel: string;
  sandboxMode: string;
}

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
      mode: input.mode,
      reasoningLevel: input.reasoningLevel,
      sandboxMode: input.sandboxMode,
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
    .where(eq(queuedThreadMessages.threadId, threadId))
    .all();
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
