import { and, asc, eq, gt, lte, or } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
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

export interface AdvanceManagerThreadNudgeAfterFireArgs {
  expectedNextFireAt: number;
  nextFireAt: number;
  nudgeId: string;
  now?: number;
}

export interface DueManagerThreadNudgeCursor {
  createdAt: number;
  id: string;
  nextFireAt: number;
}

export interface ListDueManagerThreadNudgesArgs {
  after?: DueManagerThreadNudgeCursor;
  limit?: number;
  now: number;
}

export interface ReplaceManagerThreadNudgeInput {
  cron: string;
  name: string;
  nextFireAt: number;
  timezone: string;
}

export interface ReplaceManagerThreadNudgesArgs {
  desiredNudges: readonly ReplaceManagerThreadNudgeInput[];
  now?: number;
  projectId: string;
  threadId: string;
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
  args: ListDueManagerThreadNudgesArgs,
) {
  const afterFilter = args.after
    ? or(
        gt(managerThreadNudges.nextFireAt, args.after.nextFireAt),
        and(
          eq(managerThreadNudges.nextFireAt, args.after.nextFireAt),
          gt(managerThreadNudges.createdAt, args.after.createdAt),
        ),
        and(
          eq(managerThreadNudges.nextFireAt, args.after.nextFireAt),
          eq(managerThreadNudges.createdAt, args.after.createdAt),
          gt(managerThreadNudges.id, args.after.id),
        ),
      )
    : undefined;
  const query = db.select()
    .from(managerThreadNudges)
    .where(
      and(
        eq(managerThreadNudges.enabled, true),
        lte(managerThreadNudges.nextFireAt, args.now),
        afterFilter,
      ),
    )
    .orderBy(
      managerThreadNudges.nextFireAt,
      managerThreadNudges.createdAt,
      managerThreadNudges.id,
    );
  return args.limit === undefined ? query.all() : query.limit(args.limit).all();
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

export function replaceManagerThreadNudges(
  db: DbConnection,
  notifier: DbNotifier,
  args: ReplaceManagerThreadNudgesArgs,
): boolean {
  const desiredByName = new Map(
    args.desiredNudges.map((nudge) => [nudge.name, nudge]),
  );
  const now = args.now ?? Date.now();
  const changed = db.transaction((tx) => {
    let didChange = false;
    const existing = tx.select()
      .from(managerThreadNudges)
      .where(eq(managerThreadNudges.threadId, args.threadId))
      .orderBy(asc(managerThreadNudges.name))
      .all();

    for (const existingNudge of existing) {
      const desired = desiredByName.get(existingNudge.name);
      if (!desired) {
        tx.delete(managerThreadNudges)
          .where(eq(managerThreadNudges.id, existingNudge.id))
          .run();
        didChange = true;
        continue;
      }

      desiredByName.delete(existingNudge.name);

      if (
        existingNudge.cron === desired.cron &&
        existingNudge.timezone === desired.timezone &&
        existingNudge.enabled
      ) {
        continue;
      }

      tx.update(managerThreadNudges)
        .set({
          cron: desired.cron,
          timezone: desired.timezone,
          enabled: true,
          nextFireAt: desired.nextFireAt,
          updatedAt: now,
        })
        .where(eq(managerThreadNudges.id, existingNudge.id))
        .run();
      didChange = true;
    }

    for (const desired of desiredByName.values()) {
      tx.insert(managerThreadNudges)
        .values({
          id: createManagerThreadNudgeId(),
          projectId: args.projectId,
          threadId: args.threadId,
          name: desired.name,
          cron: desired.cron,
          timezone: desired.timezone,
          enabled: true,
          nextFireAt: desired.nextFireAt,
          lastFiredAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      didChange = true;
    }

    return didChange;
  }, { behavior: "immediate" });

  if (changed) {
    notifier.notifyProject(args.projectId, ["nudges-changed"]);
  }

  return changed;
}

export function advanceManagerThreadNudgeAfterFireInTransaction(
  db: DbTransaction,
  args: AdvanceManagerThreadNudgeAfterFireArgs,
) {
  const now = args.now ?? Date.now();
  const result = db.update(managerThreadNudges)
    .set({
      nextFireAt: args.nextFireAt,
      lastFiredAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(managerThreadNudges.id, args.nudgeId),
        eq(managerThreadNudges.enabled, true),
        eq(managerThreadNudges.nextFireAt, args.expectedNextFireAt),
      ),
    )
    .run();

  return result.changes > 0;
}

export function advanceManagerThreadNudgeAfterFire(
  db: DbConnection,
  notifier: DbNotifier,
  args: AdvanceManagerThreadNudgeAfterFireArgs & { projectId: string },
) {
  const advanced = db.transaction(
    (tx) => advanceManagerThreadNudgeAfterFireInTransaction(tx, args),
    { behavior: "immediate" },
  );
  if (advanced) {
    notifier.notifyProject(args.projectId, ["nudges-changed"]);
  }
  return advanced;
}
