import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { createAutomationId } from "../ids.js";
import { automations, threads } from "../schema.js";

export interface CreateAutomationInput {
  action: string;
  autoArchive: boolean;
  enabled: boolean;
  name: string;
  nextRunAt: number | null;
  projectId: string;
  triggerConfig: string;
  triggerType: string;
}

export interface UpdateAutomationInput {
  action?: string;
  autoArchive?: boolean;
  enabled?: boolean;
  lastRunAt?: number | null;
  name?: string;
  nextRunAt?: number | null;
  runCount?: number;
  triggerConfig?: string;
  triggerType?: string;
}

export function createAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateAutomationInput,
) {
  const now = Date.now();
  const automation = db.insert(automations)
    .values({
      id: createAutomationId(),
      projectId: input.projectId,
      name: input.name,
      enabled: input.enabled,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      action: input.action,
      autoArchive: input.autoArchive,
      nextRunAt: input.nextRunAt,
      lastRunAt: null,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  notifier.notifyProject(input.projectId, ["automations-changed"]);
  return automation;
}

export function getAutomation(db: DbConnection, automationId: string) {
  return (
    db.select()
      .from(automations)
      .where(eq(automations.id, automationId))
      .get() ?? null
  );
}

export function listAutomations(
  db: DbConnection,
  projectId: string,
) {
  return db.select()
    .from(automations)
    .where(eq(automations.projectId, projectId))
    .orderBy(desc(automations.createdAt))
    .all();
}

export function listDueAutomations(
  db: DbConnection,
  now: number,
) {
  return db.select()
    .from(automations)
    .where(
      and(
        eq(automations.enabled, true),
        eq(automations.triggerType, "schedule"),
        lte(automations.nextRunAt, now),
      ),
    )
    .orderBy(automations.nextRunAt, automations.createdAt)
    .all();
}

export function updateAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  automationId: string,
  input: UpdateAutomationInput,
) {
  const existing = getAutomation(db, automationId);
  if (!existing) {
    return null;
  }

  const updated = db.update(automations)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
      ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.autoArchive !== undefined ? { autoArchive: input.autoArchive } : {}),
      ...(input.nextRunAt !== undefined ? { nextRunAt: input.nextRunAt } : {}),
      ...(input.lastRunAt !== undefined ? { lastRunAt: input.lastRunAt } : {}),
      ...(input.runCount !== undefined ? { runCount: input.runCount } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(automations.id, automationId))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  notifier.notifyProject(updated.projectId, ["automations-changed"]);
  return updated;
}

export function deleteAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  automationId: string,
) {
  const existing = getAutomation(db, automationId);
  if (!existing) {
    return false;
  }

  db.delete(automations).where(eq(automations.id, automationId)).run();
  notifier.notifyProject(existing.projectId, ["automations-changed"]);
  return true;
}

export function hasOpenAutomationThread(
  db: DbConnection,
  automationId: string,
) {
  const row = db.select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.automationId, automationId),
        inArray(threads.status, ["active", "idle", "provisioning"]),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .get();

  return row !== undefined;
}
