import type { automations } from "@bb/db";
import {
  automationActionSchema,
  automationSchema,
  automationScheduleTriggerSchema,
  type AutomationAction,
  type AutomationScheduleTrigger,
} from "@bb/server-contract";

type AutomationRow = typeof automations.$inferSelect;

export function parseAutomationTriggerConfig(
  triggerConfig: string,
) {
  return automationScheduleTriggerSchema.parse(JSON.parse(triggerConfig));
}

export function parseAutomationAction(
  action: string,
) {
  return automationActionSchema.parse(JSON.parse(action));
}

export function toAutomationResponse(
  row: AutomationRow,
) {
  return automationSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    enabled: row.enabled,
    trigger: parseAutomationTriggerConfig(row.triggerConfig),
    action: parseAutomationAction(row.action),
    autoArchive: row.autoArchive,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function serializeAutomationTrigger(
  trigger: AutomationScheduleTrigger,
) {
  return JSON.stringify(trigger);
}

export function serializeAutomationAction(
  action: AutomationAction,
) {
  return JSON.stringify(action);
}
