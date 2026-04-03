import { eq } from "drizzle-orm";
import {
  createAutomation,
  getAutomation,
  hostDaemonCommands,
  threads,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { sweepDueAutomations } from "../src/services/automation-sweep.js";
import { waitForQueuedCommand } from "./helpers/commands.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "./helpers/seed.js";
import { createTestAppHarness } from "./helpers/test-app.js";

describe("automation sweep", () => {
  it("creates a thread through the shared creation path for due automations", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-run",
      });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/automation-reuse-environment",
      });
      const now = Date.now();
      const automation = createAutomation(harness.db, harness.hub, {
        projectId: project.id,
        name: "Daily automation",
        enabled: true,
        triggerType: "schedule",
        triggerConfig: JSON.stringify({
          triggerType: "schedule",
          cron: "0 8 * * *",
          timezone: "UTC",
        }),
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run the automation" }],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          },
        }),
        autoArchive: false,
        nextRunAt: now - 1,
      });

      await sweepDueAutomations(harness.deps, { now });

      const createdThreads = harness.db
        .select()
        .from(threads)
        .where(eq(threads.automationId, automation.id))
        .all();
      expect(createdThreads).toHaveLength(1);
      expect(createdThreads[0]).toMatchObject({
        automationId: automation.id,
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThreads[0]?.id,
      );
      expect(queued.command).toMatchObject({
        environmentId: environment.id,
        projectId: project.id,
      });

      const updatedAutomation = getAutomation(harness.db, automation.id);
      expect(updatedAutomation?.lastRunAt).toBeGreaterThanOrEqual(now);
      expect(updatedAutomation?.runCount).toBe(1);
      expect(updatedAutomation?.nextRunAt).toBeGreaterThan(now);
    } finally {
      await harness.cleanup();
    }
  });

  it("advances due automations without creating threads when the host is offline", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-automation-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/automation-offline-environment",
      });
      const now = Date.now();
      const automation = createAutomation(harness.db, harness.hub, {
        projectId: project.id,
        name: "Offline automation",
        enabled: true,
        triggerType: "schedule",
        triggerConfig: JSON.stringify({
          triggerType: "schedule",
          cron: "0 8 * * *",
          timezone: "UTC",
        }),
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run offline automation" }],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          },
        }),
        autoArchive: false,
        nextRunAt: now - 1,
      });

      await sweepDueAutomations(harness.deps, { now });

      expect(
        harness.db
          .select()
          .from(threads)
          .where(eq(threads.automationId, automation.id))
          .all(),
      ).toHaveLength(0);
      expect(harness.db.select().from(hostDaemonCommands).all()).toHaveLength(0);

      const updatedAutomation = getAutomation(harness.db, automation.id);
      expect(updatedAutomation?.lastRunAt).toBeGreaterThanOrEqual(now);
      expect(updatedAutomation?.runCount).toBe(1);
      expect(updatedAutomation?.nextRunAt).toBeGreaterThan(now);
    } finally {
      await harness.cleanup();
    }
  });

  it("skips creating a new thread when the automation already has an open thread", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-automation-dedupe",
      });
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/automation-dedupe-environment",
      });
      const now = Date.now();
      const automation = createAutomation(harness.db, harness.hub, {
        projectId: project.id,
        name: "Deduped automation",
        enabled: true,
        triggerType: "schedule",
        triggerConfig: JSON.stringify({
          triggerType: "schedule",
          cron: "0 8 * * *",
          timezone: "UTC",
        }),
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run deduped automation" }],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          },
        }),
        autoArchive: false,
        nextRunAt: now - 1,
      });
      const existingThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        title: "Existing automation thread",
      });
      harness.db.update(threads)
        .set({ automationId: automation.id })
        .where(eq(threads.id, existingThread.id))
        .run();

      await sweepDueAutomations(harness.deps, { now });

      expect(
        harness.db
          .select()
          .from(threads)
          .where(eq(threads.automationId, automation.id))
          .all(),
      ).toHaveLength(1);
      expect(harness.db.select().from(hostDaemonCommands).all()).toHaveLength(0);

      const updatedAutomation = getAutomation(harness.db, automation.id);
      expect(updatedAutomation?.runCount).toBe(1);
      expect(updatedAutomation?.lastRunAt).toBeGreaterThanOrEqual(now);
    } finally {
      await harness.cleanup();
    }
  });
});
