import { eq, and, isNull, isNotNull } from "drizzle-orm";
import type { ThreadChangeKind, ThreadStatus, ThreadType } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { threads } from "../schema.js";
import { createThreadId } from "../ids.js";

/**
 * Allowed thread status transitions.
 * Key is the current status, values are the statuses it can transition to.
 */
export const ALLOWED_TRANSITIONS: Record<ThreadStatus, ThreadStatus[]> = {
  created: ["provisioning", "idle"],
  provisioning: ["idle", "error"],
  idle: ["active", "error"],
  active: ["idle", "error"],
  error: ["active", "idle"],
};

export interface CreateThreadInput {
  projectId: string;
  environmentId?: string | null;
  providerId: string;
  type?: string;
  title?: string | null;
  status?: ThreadStatus;
  mergeBaseBranch?: string | null;
  parentThreadId?: string | null;
}

export function createThread(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadInput,
) {
  const now = Date.now();
  const id = createThreadId();
  db.insert(threads)
    .values({
      id,
      projectId: input.projectId,
      environmentId: input.environmentId ?? null,
      providerId: input.providerId,
      type: input.type ?? "standard",
      title: input.title ?? null,
      status: input.status ?? "created",
      mergeBaseBranch: input.mergeBaseBranch ?? null,
      parentThreadId: input.parentThreadId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const thread = db.select().from(threads).where(eq(threads.id, id)).get()!;
  notifier.notifyThread(id, ["thread-created"]);
  notifier.notifyProject(input.projectId, ["threads-changed"]);
  return thread;
}

export function getThread(db: DbConnection, id: string) {
  return db.select().from(threads).where(eq(threads.id, id)).get() ?? null;
}

export interface ListThreadsOptions {
  projectId?: string;
  type?: ThreadType;
  parentThreadId?: string;
  archived?: boolean;
}

export function listThreads(db: DbConnection, filterOrProjectId?: string | ListThreadsOptions) {
  const opts: ListThreadsOptions =
    typeof filterOrProjectId === "string"
      ? { projectId: filterOrProjectId }
      : filterOrProjectId ?? {};

  const conditions = [];
  if (opts.projectId) conditions.push(eq(threads.projectId, opts.projectId));
  if (opts.type) conditions.push(eq(threads.type, opts.type));
  if (opts.parentThreadId) conditions.push(eq(threads.parentThreadId, opts.parentThreadId));
  if (opts.archived === true) conditions.push(isNotNull(threads.archivedAt));
  if (opts.archived === false) conditions.push(isNull(threads.archivedAt));

  if (conditions.length === 0) {
    return db.select().from(threads).all();
  }
  if (conditions.length === 1) {
    return db.select().from(threads).where(conditions[0]).all();
  }
  return db.select().from(threads).where(and(...conditions)).all();
}

export interface UpdateThreadInput {
  title?: string | null;
  environmentId?: string | null;
  lastReadAt?: number | null;
}

export function updateThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateThreadInput,
) {
  const now = Date.now();
  const changes: ThreadChangeKind[] = [];
  if ("title" in input) changes.push("title-changed");
  if ("lastReadAt" in input) changes.push("read-state-changed");

  const set: Record<string, unknown> = { updatedAt: now };
  if ("title" in input) set.title = input.title;
  if ("environmentId" in input) set.environmentId = input.environmentId;
  if ("lastReadAt" in input) set.lastReadAt = input.lastReadAt;

  db.update(threads)
    .set(set)
    .where(eq(threads.id, id))
    .run();
  const updated = db.select().from(threads).where(eq(threads.id, id)).get();
  if (updated && changes.length > 0) {
    notifier.notifyThread(id, changes);
  }
  return updated ?? null;
}

export function deleteThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!existing) return false;
  db.delete(threads).where(eq(threads.id, id)).run();
  notifier.notifyThread(id, ["thread-deleted"]);
  notifier.notifyProject(existing.projectId, ["threads-changed"]);
  return true;
}

export function archiveThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const now = Date.now();
  db.update(threads)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(threads.id, id))
    .run();
  const updated = db.select().from(threads).where(eq(threads.id, id)).get();
  if (updated) {
    notifier.notifyThread(id, ["archived-changed"]);
  }
  return updated ?? null;
}

export function unarchiveThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const now = Date.now();
  db.update(threads)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(threads.id, id))
    .run();
  const updated = db.select().from(threads).where(eq(threads.id, id)).get();
  if (updated) {
    notifier.notifyThread(id, ["archived-changed"]);
  }
  return updated ?? null;
}

export function transitionThreadStatus(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
  newStatus: ThreadStatus,
) {
  const thread = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!thread) {
    throw new Error(`Thread not found: ${id}`);
  }

  const currentStatus = thread.status;
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid thread status transition: ${currentStatus} → ${newStatus}`,
    );
  }

  const now = Date.now();
  db.update(threads)
    .set({ status: newStatus, updatedAt: now })
    .where(eq(threads.id, id))
    .run();

  notifier.notifyThread(id, ["status-changed"]);
  return db.select().from(threads).where(eq(threads.id, id)).get()!;
}
