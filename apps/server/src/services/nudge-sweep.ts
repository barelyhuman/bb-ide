import { and, eq, inArray, sql } from "drizzle-orm";
import {
  advanceManagerThreadNudgeAfterFire,
  advanceManagerThreadNudgeAfterFireInTransaction,
  type DbConnection,
  type DbTransaction,
  deleteManagerThreadNudge,
  getActiveSession,
  getEnvironment,
  getThread,
  hostDaemonCommands,
  listDueManagerThreadNudges,
} from "@bb/db";
import type { PromptInput, ResolvedThreadExecutionOptions } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { AppDeps } from "../types.js";
import {
  appendClientTurnEventInTransaction,
  getLastProviderThreadId,
} from "./thread-events.js";
import {
  buildExecutionOptions,
  createTurnRunCommandPayload,
  queueTurnRunCommandInTransaction,
} from "./thread-commands.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";
import { tryTransition } from "./thread-transitions.js";

const SCHEDULED_NUDGE_PREFIX = "[bb system] Scheduled nudge:";

interface SweepDueNudgesArgs {
  now?: number;
}

function buildScheduledNudgeInput(name: string): PromptInput[] {
  return [
    {
      type: "text",
      text: `${SCHEDULED_NUDGE_PREFIX} ${name}. Check ASYNC.md.`,
    },
  ];
}

function advanceSkippedNudge(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: {
    now: number;
    nudge: ReturnType<typeof listDueManagerThreadNudges>[number];
    reason: string;
  },
): void {
  const nextFireAt = computeNextScheduledTime({
    cron: args.nudge.cron,
    timezone: args.nudge.timezone,
    now: args.now,
  });
  const advanced = advanceManagerThreadNudgeAfterFire(deps.db, deps.hub, {
    nudgeId: args.nudge.id,
    expectedNextFireAt: args.nudge.nextFireAt,
    nextFireAt,
    projectId: args.nudge.projectId,
    now: args.now,
  });

  if (advanced) {
    deps.logger.info(
      {
        nudgeId: args.nudge.id,
        reason: args.reason,
        threadId: args.nudge.threadId,
      },
      "Skipped due manager nudge",
    );
  }
}

function hasPendingTurnRunCommand(
  db: DbConnection | DbTransaction,
  threadId: string,
): boolean {
  const existing = db.select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.type, "turn.run"),
        inArray(hostDaemonCommands.state, ["pending", "fetched"]),
        sql`json_extract(${hostDaemonCommands.payload}, '$.threadId') = ${threadId}`,
      ),
    )
    .get();

  return existing !== undefined;
}

async function runNudge(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  nudge: ReturnType<typeof listDueManagerThreadNudges>[number],
  now: number,
): Promise<void> {
  const thread = getThread(deps.db, nudge.threadId);
  if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) {
    deleteManagerThreadNudge(deps.db, deps.hub, nudge.id);
    return;
  }

  if (thread.status !== "idle") {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "thread-not-idle",
    });
    return;
  }

  if (!thread.environmentId) {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "thread-missing-environment",
    });
    return;
  }

  const environment = getEnvironment(deps.db, thread.environmentId);
  if (!environment || environment.status !== "ready" || !environment.path) {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "environment-not-ready",
    });
    return;
  }

  const session = getActiveSession(deps.db, environment.hostId);
  if (!session) {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "host-disconnected",
    });
    return;
  }

  const input = buildScheduledNudgeInput(nudge.name);
  const providerThreadId = getLastProviderThreadId(deps, thread.id);
  if (!providerThreadId) {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "missing-provider-thread",
    });
    return;
  }

  if (hasPendingTurnRunCommand(deps.db, thread.id)) {
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "pending-turn-run",
    });
    return;
  }

  let execution: ResolvedThreadExecutionOptions;
  let command: Extract<HostDaemonCommand, { type: "turn.run" }>;
  try {
    execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
      "client/turn/requested",
    );
    command = await createTurnRunCommandPayload(deps, {
      environment: {
        id: environment.id,
        hostId: environment.hostId,
        path: environment.path,
        workspaceProvisionType: environment.workspaceProvisionType,
      },
      eventSequence: 0,
      execution,
      input,
      providerThreadId,
      thread,
    });
  } catch (error) {
    deps.logger.warn(
      {
        err: error,
        nudgeId: nudge.id,
        threadId: thread.id,
      },
      "Skipping due manager nudge after runtime preparation failed",
    );
    advanceSkippedNudge(deps, {
      now,
      nudge,
      reason: "runtime-preparation-failed",
    });
    return;
  }

  const nextFireAt = computeNextScheduledTime({
    cron: nudge.cron,
    timezone: nudge.timezone,
    now,
  });
  let queuedCommand = false;
  let appendedEvent = false;
  let advancedWithoutQueue = false;

  deps.db.transaction((tx) => {
    if (hasPendingTurnRunCommand(tx, thread.id)) {
      if (
        advanceManagerThreadNudgeAfterFireInTransaction(tx, {
          expectedNextFireAt: nudge.nextFireAt,
          nextFireAt,
          nudgeId: nudge.id,
          now,
        })
      ) {
        advancedWithoutQueue = true;
      }
      return;
    }

    if (
      !advanceManagerThreadNudgeAfterFireInTransaction(tx, {
        expectedNextFireAt: nudge.nextFireAt,
        nextFireAt,
        nudgeId: nudge.id,
        now,
      })
    ) {
      return;
    }

    const eventSequence = appendClientTurnEventInTransaction(tx, {
      threadId: thread.id,
      environmentId: environment.id,
      type: "client/turn/requested",
      input,
      execution,
      initiator: "system",
      requestMethod: "turn/start",
      source: "tell",
    });

    queueTurnRunCommandInTransaction(tx, {
      command: {
        ...command,
        eventSequence,
      },
      hostId: environment.hostId,
      sessionId: session.id,
    });
    appendedEvent = true;
    queuedCommand = true;
  }, { behavior: "immediate" });

  if (advancedWithoutQueue) {
    deps.hub.notifyProject(nudge.projectId, ["nudges-changed"]);
    deps.logger.info(
      {
        nudgeId: nudge.id,
        reason: "pending-turn-run",
        threadId: thread.id,
      },
      "Skipped due manager nudge",
    );
    return;
  }

  if (!queuedCommand) {
    return;
  }

  deps.hub.notifyProject(nudge.projectId, ["nudges-changed"]);
  if (appendedEvent) {
    deps.hub.notifyThread(thread.id, ["events-appended"]);
  }
  deps.hub.notifyCommand(environment.hostId);
  tryTransition(deps.db, deps.hub, thread.id, "active");
}

export async function sweepDueNudges(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: SweepDueNudgesArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  const dueNudges = listDueManagerThreadNudges(deps.db, now);

  for (const nudge of dueNudges) {
    try {
      await runNudge(deps, nudge, now);
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          nudgeId: nudge.id,
          threadId: nudge.threadId,
        },
        "Failed to process a due manager nudge",
      );
    }
  }
}
