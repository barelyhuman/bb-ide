import { and, eq } from "drizzle-orm";
import {
  createThreadSchedule,
  events,
  getThreadSchedule,
  queueCommand,
  threads,
  threadSchedules,
} from "@bb/db";
import { threadScope, turnRequestEventDataSchema, turnScope } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { sweepDueThreadSchedules } from "../../src/services/scheduling/thread-schedule-sweep.js";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface SeedRunnableThreadArgs {
  environmentId: string;
  harness: TestHarness;
  providerId?: string;
  projectId: string;
  status?: "active" | "idle";
  turnId?: string;
  type?: "manager" | "standard";
}

function seedRunnableThread(args: SeedRunnableThreadArgs) {
  const status = args.status ?? "idle";
  const thread = seedThread(args.harness.deps, {
    projectId: args.projectId,
    environmentId: args.environmentId,
    providerId: args.providerId,
    status,
    type: args.type ?? "standard",
  });
  seedEvent(args.harness.deps, {
    threadId: thread.id,
    environmentId: args.environmentId,
    providerThreadId: "provider-thread",
    sequence: 1,
    type: "thread/identity",
    scope: threadScope(),
    data: {},
  });
  appendClientTurnEvent(args.harness.deps, {
    threadId: thread.id,
    environmentId: args.environmentId,
    type: "client/turn/requested",
    input: [{ type: "text", text: "Bootstrap thread" }],
    target: { kind: "thread-start" },
    execution: {
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    initiator: "user",
    senderThreadId: null,
    requestMethod: "thread/start",
    source: "spawn",
  });

  if (status === "active") {
    seedEvent(args.harness.deps, {
      threadId: thread.id,
      environmentId: args.environmentId,
      providerThreadId: "provider-thread",
      sequence: 3,
      type: "turn/started",
      scope: turnScope(args.turnId ?? "turn-active-schedule"),
      data: {},
    });
  }

  return thread;
}

interface SeedDueThreadScheduleFixtureArgs {
  environmentPath: string;
  harness: TestHarness;
  hostId: string;
  providerId?: string;
  status?: "active" | "idle";
  threadType?: "manager" | "standard";
}

type ThreadArchiveCommand = Extract<
  HostDaemonCommand,
  { type: "thread.archive" }
>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;
type SeededEnvironment = ReturnType<typeof seedEnvironment>;

interface QueuePendingTurnSubmitCommandArgs {
  environment: SeededEnvironment;
  hostId: string;
  projectId: string;
  providerId: string;
  sessionId: string | null;
  threadId: string;
}

interface QueuePendingThreadArchiveCommandArgs {
  environment: SeededEnvironment;
  hostId: string;
  providerId: string;
  providerThreadId: string;
  sessionId: string | null;
  threadId: string;
}

function seedDueThreadScheduleFixture(args: SeedDueThreadScheduleFixtureArgs) {
  const { host, session } = seedHostSession(args.harness.deps, {
    id: args.hostId,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: args.environmentPath,
  });
  const thread = seedRunnableThread({
    harness: args.harness,
    environmentId: environment.id,
    projectId: project.id,
    providerId: args.providerId,
    status: args.status,
    type: args.threadType,
  });
  const now = Date.now();
  const schedule = createThreadSchedule(args.harness.db, args.harness.hub, {
    projectId: project.id,
    threadId: thread.id,
    name: "due-check",
    cron: "0 8 * * *",
    timezone: "UTC",
    prompt: "Run if useful.",
    enabled: true,
    nextFireAt: now - 1,
  });

  return { environment, host, now, project, schedule, session, thread };
}

function requireEnvironmentPath(environment: SeededEnvironment): string {
  if (!environment.path) {
    throw new Error("Expected seeded environment path");
  }
  return environment.path;
}

function queuePendingTurnSubmitCommand(
  harness: TestHarness,
  args: QueuePendingTurnSubmitCommandArgs,
): void {
  const command: TurnSubmitCommand = {
    type: "turn.submit",
    environmentId: args.environment.id,
    threadId: args.threadId,
    requestId: "creq_23456789ad",
    target: { mode: "auto", expectedTurnId: null },
    input: [{ type: "text", text: "Already pending." }],
    options: {
      model: "gpt-5",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
      serviceTier: "default",
    },
    resumeContext: {
      workspaceContext: {
        workspacePath: requireEnvironmentPath(args.environment),
        workspaceProvisionType: args.environment.workspaceProvisionType,
      },
      projectId: args.projectId,
      providerId: args.providerId,
      providerThreadId: "provider-thread",
      instructions: "instructions",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
  };

  queueCommand(harness.db, harness.hub, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: command.type,
    payload: JSON.stringify(command),
  });
}

function queuePendingThreadArchiveCommand(
  harness: TestHarness,
  args: QueuePendingThreadArchiveCommandArgs,
): void {
  const command: ThreadArchiveCommand = {
    type: "thread.archive",
    environmentId: args.environment.id,
    threadId: args.threadId,
    workspaceContext: {
      workspacePath: requireEnvironmentPath(args.environment),
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    providerId: args.providerId,
    providerThreadId: args.providerThreadId,
  };

  queueCommand(harness.db, harness.hub, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: command.type,
    payload: JSON.stringify(command),
  });
}

describe("thread schedule sweep", () => {
  it("queues turn.submit for a due schedule on an idle thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-run",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-run-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "daily-recap",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Run the daily recap if there is useful progress.",
        enabled: true,
        nextFireAt: now - 1,
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      const queuedTurnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      await sweepPromise;

      expect(queuedTurnSubmit.command).toMatchObject({
        input: [
          {
            type: "text",
            text: "Run the daily recap if there is useful progress.",
          },
        ],
        target: { mode: "start" },
      });
      expect(
        harness.db.select().from(threads).where(eq(threads.id, thread.id)).get()
          ?.status,
      ).toBe("active");

      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBe(now);
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
      const queuedSubmitCount = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      ).length;

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(queuedSubmitCount);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        lastFiredAt: now,
        nextFireAt: updatedSchedule?.nextFireAt,
      });

      const clientRequests = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "client/turn/requested"),
          ),
        )
        .orderBy(events.sequence)
        .all();
      const scheduleRequest = clientRequests[clientRequests.length - 1];
      if (!scheduleRequest) {
        throw new Error("Expected schedule client request event");
      }
      const requestData = turnRequestEventDataSchema.parse(
        JSON.parse(scheduleRequest.data),
      );
      expect(requestData).toMatchObject({
        initiator: "system",
        input: [
          {
            type: "text",
            text: "Run the daily recap if there is useful progress.",
          },
        ],
        target: { kind: "new-turn" },
      });
    });
  });

  it("queues due schedules as auto submits when the thread is active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-active-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
        turnId: "turn-active-schedule",
      });
      const now = Date.now();
      createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "active-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Check active work.",
        enabled: true,
        nextFireAt: now - 1,
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      const queuedTurnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      await sweepPromise;

      expect(queuedTurnSubmit.command).toMatchObject({
        input: [{ type: "text", text: "Check active work." }],
        target: {
          mode: "auto",
          expectedTurnId: "turn-active-schedule",
        },
      });
    });
  });

  it("ignores disabled schedules even when nextFireAt is in the past", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-disabled",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-disabled-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "disabled-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Should not run.",
        enabled: false,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        enabled: false,
        lastFiredAt: null,
        nextFireAt: schedule.nextFireAt,
      });
    });
  });

  it("disables invalid stored schedules instead of deleting them", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-invalid-stored",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-invalid-stored-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "invalid-stored",
        cron: "0 8 * * *",
        timezone: "Mars/Olympus",
        prompt: "Should not run.",
        enabled: true,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        cron: "0 8 * * *",
        enabled: false,
        lastFiredAt: null,
        name: "invalid-stored",
        nextFireAt: schedule.nextFireAt,
        timezone: "Mars/Olympus",
      });
    });
  });

  it("disables enabled schedules for archived threads encountered by the sweep", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-archived",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-archived-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      harness.db
        .update(threads)
        .set({ archivedAt: now - 1, updatedAt: now - 1 })
        .where(eq(threads.id, thread.id))
        .run();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "archived-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Should remain dormant.",
        enabled: true,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule).toMatchObject({
        enabled: false,
        lastFiredAt: null,
        nextFireAt: schedule.nextFireAt,
      });
    });
  });

  it("does not queue when another worker advances the schedule first", async () => {
    await withTestHarness(async (harness) => {
      const { now, schedule, thread } = seedDueThreadScheduleFixture({
        harness,
        hostId: "host-thread-schedule-stale-expected",
        environmentPath: "/tmp/thread-schedule-stale-expected-environment",
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      harness.db
        .update(threadSchedules)
        .set({ nextFireAt: now + 60_000, updatedAt: now })
        .where(eq(threadSchedules.id, schedule.id))
        .run();
      await sweepPromise;

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        lastFiredAt: null,
        nextFireAt: now + 60_000,
      });
    });
  });

  it("skip-advances without firing when turn.submit is already pending", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, now, project, schedule, session, thread } =
        seedDueThreadScheduleFixture({
          harness,
          hostId: "host-thread-schedule-pending-submit",
          environmentPath: "/tmp/thread-schedule-pending-submit-environment",
        });
      queuePendingTurnSubmitCommand(harness, {
        environment,
        hostId: host.id,
        projectId: project.id,
        providerId: thread.providerId,
        sessionId: session.id,
        threadId: thread.id,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(1);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBeNull();
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
    });
  });

  it("skip-advances without queueing when thread.archive is already pending", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, now, schedule, session, thread } =
        seedDueThreadScheduleFixture({
          harness,
          hostId: "host-thread-schedule-pending-archive",
          environmentPath: "/tmp/thread-schedule-pending-archive-environment",
        });
      queuePendingThreadArchiveCommand(harness, {
        environment,
        hostId: host.id,
        providerId: thread.providerId,
        providerThreadId: "provider-thread",
        sessionId: session.id,
        threadId: thread.id,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBeNull();
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
    });
  });

  it("does not queue when thread.archive appears after preparation starts", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, now, schedule, session, thread } =
        seedDueThreadScheduleFixture({
          harness,
          hostId: "host-thread-schedule-archive-race",
          environmentPath: "/tmp/thread-schedule-archive-race-environment",
        });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      queuePendingThreadArchiveCommand(harness, {
        environment,
        hostId: host.id,
        providerId: thread.providerId,
        providerThreadId: "provider-thread",
        sessionId: session.id,
        threadId: thread.id,
      });
      await sweepPromise;

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        lastFiredAt: null,
        nextFireAt: schedule.nextFireAt,
      });
    });
  });

  it("skip-advances without firing when runtime preparation fails", async () => {
    await withTestHarness(async (harness) => {
      const { now, schedule, thread } = seedDueThreadScheduleFixture({
        harness,
        hostId: "host-thread-schedule-runtime-failure",
        environmentPath: "/tmp/thread-schedule-runtime-failure-environment",
        providerId: "unsupported-provider",
        threadType: "manager",
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBeNull();
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
    });
  });
});
