import type { ThreadScheduleRow } from "@bb/db";
import type { ThreadSchedule } from "@bb/server-contract";

export function toThreadScheduleResponse(
  row: ThreadScheduleRow,
): ThreadSchedule {
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId,
    name: row.name,
    enabled: row.enabled,
    kind: row.kind,
    cron: row.cron,
    timezone: row.timezone,
    prompt: row.prompt,
    nextFireAt: row.nextFireAt,
    lastFiredAt: row.lastFiredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
