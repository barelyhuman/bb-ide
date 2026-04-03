import { eq } from "drizzle-orm";
import {
  advanceAutomationAfterRunInTransaction,
  automations,
  getActiveSession,
  getEnvironment,
  hasOpenAutomationThread,
  listDueAutomations,
} from "@bb/db";
import type {
  AutomationAction,
  AutomationScheduleTrigger,
  CreateThreadRequest,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { parseAutomationAction, parseAutomationTriggerConfig } from "./automation-config.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";
import { createThreadFromRequest } from "./thread-create.js";

type AutomationRow = typeof automations.$inferSelect;

interface SweepDueAutomationsArgs {
  now?: number;
}

interface AdvanceAutomationDecision {
  advanced: boolean;
  reason: "host-disconnected" | "lost-race" | "open-thread" | "run";
  shouldCreateThread: boolean;
}

function resolveAutomationHostId(
  deps: Pick<AppDeps, "db">,
  threadRequest: Omit<CreateThreadRequest, "projectId">,
): string | null {
  switch (threadRequest.environment.type) {
    case "host":
      return threadRequest.environment.hostId;
    case "reuse": {
      const environment = getEnvironment(
        deps.db,
        threadRequest.environment.environmentId,
      );
      if (!environment) {
        throw new Error("Automation reuse environment was not found");
      }
      return environment.hostId;
    }
    case "sandbox-host":
      return null;
  }
}

function advanceAutomationForSweep(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    automation: AutomationRow;
    hostConnected: boolean;
    nextRunAt: number;
  },
): AdvanceAutomationDecision {
  const result = deps.db.transaction((tx) => {
    const current = tx.select()
      .from(automations)
      .where(eq(automations.id, args.automation.id))
      .get();
    if (
      !current ||
      !current.enabled ||
      current.triggerType !== "schedule" ||
      current.nextRunAt !== args.automation.nextRunAt
    ) {
      return {
        advanced: false,
        reason: "lost-race",
        shouldCreateThread: false,
      } satisfies AdvanceAutomationDecision;
    }

    const shouldCreateThread =
      args.hostConnected &&
      !hasOpenAutomationThread(tx, args.automation.id);
    const advanced = advanceAutomationAfterRunInTransaction(tx, {
      automationId: args.automation.id,
      expectedNextRunAt: args.automation.nextRunAt,
      nextRunAt: args.nextRunAt,
    });

    if (!advanced) {
      return {
        advanced: false,
        reason: "lost-race",
        shouldCreateThread: false,
      } satisfies AdvanceAutomationDecision;
    }

    if (!args.hostConnected) {
      return {
        advanced: true,
        reason: "host-disconnected",
        shouldCreateThread: false,
      } satisfies AdvanceAutomationDecision;
    }

    if (!shouldCreateThread) {
      return {
        advanced: true,
        reason: "open-thread",
        shouldCreateThread: false,
      } satisfies AdvanceAutomationDecision;
    }

    return {
      advanced: true,
      reason: "run",
      shouldCreateThread: true,
    } satisfies AdvanceAutomationDecision;
  }, { behavior: "immediate" });

  if (result.advanced) {
    deps.hub.notifyProject(args.automation.projectId, ["automations-changed"]);
  }
  return result;
}

async function runAutomation(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger">,
  automation: AutomationRow,
  now: number,
): Promise<void> {
  let trigger: AutomationScheduleTrigger;
  let action: AutomationAction;
  let hostId: string | null;
  try {
    trigger = parseAutomationTriggerConfig(automation.triggerConfig);
    action = parseAutomationAction(automation.action);
    hostId = resolveAutomationHostId(deps, action.threadRequest);
  } catch (error) {
    deps.logger.error(
      {
        automationId: automation.id,
        err: error,
      },
      "Skipping automation with invalid stored configuration",
    );
    return;
  }

  const nextRunAt = computeNextScheduledTime({
    cron: trigger.cron,
    timezone: trigger.timezone,
    now,
  });
  const hostConnected = hostId === null || getActiveSession(deps.db, hostId) !== null;
  const decision = advanceAutomationForSweep(deps, {
    automation,
    hostConnected,
    nextRunAt,
  });

  if (!decision.advanced) {
    return;
  }

  if (!decision.shouldCreateThread) {
    deps.logger.info(
      {
        automationId: automation.id,
        reason: decision.reason,
      },
      "Skipped due automation run",
    );
    return;
  }

  try {
    await createThreadFromRequest(deps, {
      ...action.threadRequest,
      automationId: automation.id,
      projectId: automation.projectId,
      type: "standard",
    });
  } catch (error) {
    deps.logger.error(
      {
        automationId: automation.id,
        err: error,
      },
      "Failed to create a thread for a due automation",
    );
  }
}

export async function sweepDueAutomations(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger">,
  args: SweepDueAutomationsArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  const dueAutomations = listDueAutomations(deps.db, now);

  for (const automation of dueAutomations) {
    await runAutomation(deps, automation, now);
  }
}
