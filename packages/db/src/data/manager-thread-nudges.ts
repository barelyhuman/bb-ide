import { and, asc, eq, lte } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { createManagerThreadNudgeId } from "../ids.js";
import { managerThreadNudges } from "../schema.js";

export interface CreateManagerThreadNudgeInput {
  cron: string;
  enabled: boolean;
  name: string;
  nextFireAt: number;
  projectId: string;
  threadId: string;
  timezone: string;
}

export interface UpdateManagerThreadNudgeInput {
  cron?: string;
  enabled?: boolean;
  lastFiredAt?: number | null;
  name?: string;
  nextFireAt?: number;
  timezone?: string;
}

export function createManagerThreadNudge(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateManagerThreadNudgeInput,
) {
  const now = Date.now();
  const nudge = db.insert(managerThreadNudges)
    .values({
      id: createManagerThreadNudgeId(),
      projectId: input.projectId,
      threadId: input.threadId,
      name: input.name,
      cron: input.cron,
      timezone: input.timezone,
      enabled: input.enabled,
      nextFireAt: input.nextFireAt,
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  notifier.notifyProject(input.projectId, ["nudges-changed"]);
  return nudge;
}

export function getManagerThreadNudge(
  db: DbConnection,
  nudgeId: string,
) {
  return (
    db.select()
      .from(managerThreadNudges)
      .where(eq(managerThreadNudges.id, nudgeId))
      .get() ?? null
  );
}

export function listManagerThreadNudgesByThread(
  db: DbConnection,
  threadId: string,
) {
  return db.select()
    .from(managerThreadNudges)
    .where(eq(managerThreadNudges.threadId, threadId))
    .orderBy(asc(managerThreadNudges.name))
    .all();
}

export function listDueManagerThreadNudges(
  db: DbConnection,
  now: number,
) {
  return db.select()
    .from(managerThreadNudges)
    .where(
      and(
        eq(managerThreadNudges.enabled, true),
        lte(managerThreadNudges.nextFireAt, now),
      ),
    )
    .orderBy(managerThreadNudges.nextFireAt, managerThreadNudges.createdAt)
    .all();
}

export function updateManagerThreadNudge(
  db: DbConnection,
  notifier: DbNotifier,
  nudgeId: string,
  input: UpdateManagerThreadNudgeInput,
) {
  const existing = getManagerThreadNudge(db, nudgeId);
  if (!existing) {
    return null;
  }

  const updated = db.update(managerThreadNudges)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.cron !== undefined ? { cron: input.cron } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.nextFireAt !== undefined ? { nextFireAt: input.nextFireAt } : {}),
      ...(input.lastFiredAt !== undefined ? { lastFiredAt: input.lastFiredAt } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(managerThreadNudges.id, nudgeId))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  notifier.notifyProject(updated.projectId, ["nudges-changed"]);
  return updated;
}

export function deleteManagerThreadNudge(
  db: DbConnection,
  notifier: DbNotifier,
  nudgeId: string,
) {
  const existing = getManagerThreadNudge(db, nudgeId);
  if (!existing) {
    return false;
  }

  db.delete(managerThreadNudges).where(eq(managerThreadNudges.id, nudgeId)).run();
  notifier.notifyProject(existing.projectId, ["nudges-changed"]);
  return true;
}

export function deleteManagerThreadNudgesForThread(
  db: DbConnection,
  notifier: DbNotifier,
  threadId: string,
) {
  const existing = listManagerThreadNudgesByThread(db, threadId);
  if (existing.length === 0) {
    return 0;
  }

  db.delete(managerThreadNudges).where(eq(managerThreadNudges.threadId, threadId)).run();
  notifier.notifyProject(existing[0]!.projectId, ["nudges-changed"]);
  return existing.length;
}
