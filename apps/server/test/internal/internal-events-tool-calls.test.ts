import { eq } from "drizzle-orm";
import {
  createAutomation,
  createEnvironment,
  createThread,
  events,
  getEnvironment,
  threads,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEvent,
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

async function postEventBatch(args: {
  events: HostDaemonEventEnvelope[];
  harness: TestAppHarness;
  sessionId: string;
}): Promise<Response> {
  return args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      events: args.events,
    }),
  });
}

describe("internal event and tool-call routes", () => {
  it("appends event batches and returns accepted event indexes", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: "provider-1",
              scope: turnScope("turn-1"),
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId: "provider-1",
              scope: turnScope("turn-1"),
              status: "completed",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            eventIndex: 0,
            threadId: thread.id,
            sequence: 1,
          },
          {
            eventIndex: 1,
            threadId: thread.id,
            sequence: 2,
          },
        ],
        rejectedEvents: [],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(2);
    });
  });

  it("rejects daemon turn-scoped events before turn/started is stored", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId: "provider-missing-start",
              scope: turnScope("turn-missing-start"),
              status: "completed",
            },
          },
        ],
      });

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("transitions active threads back to idle for a started/completed event batch", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            threadId: thread.id,
            event: {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              scope: turnScope("turn-1"),
            },
          },
          {
            threadId: thread.id,
            event: {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              scope: turnScope("turn-1"),
              status: "completed",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      expect(
        harness.db.select().from(threads).where(eq(threads.id, thread.id)).get()
          ?.status,
      ).toBe("idle");
    });
  });

  it("immediately advances cleanup after auto-archiving an automation thread", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const automation = createAutomation(harness.db, harness.hub, {
        action: JSON.stringify({
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Run automation" }],
            environment: {
              type: "host",
              hostId: session.hostId,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        }),
        autoArchive: true,
        enabled: true,
        name: "Auto archive cleanup",
        nextRunAt: null,
        projectId: project.id,
        triggerConfig: JSON.stringify({
          cron: "0 8 * * *",
          timezone: "UTC",
          triggerType: "schedule",
        }),
        triggerType: "schedule",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: session.hostId,
        managed: true,
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = createThread(harness.db, harness.hub, {
        automationId: automation.id,
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        status: "active",
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          createTestDaemonEventEnvelope({
            event: {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              scope: turnScope("turn-automation-cleanup"),
            },
          }),
          createTestDaemonEventEnvelope({
            event: {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              scope: turnScope("turn-automation-cleanup"),
              status: "completed",
            },
          }),
        ],
      });

      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(getEnvironment(harness.db, environment.id)?.status).toBe(
          "destroyed",
        );
      });
    });
  });

  it("keeps a thread idle when a started/completed batch is posted again", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const eventBatch: HostDaemonEventEnvelope[] = [
        {
          threadId: thread.id,
          event: {
            type: "turn/started",
            threadId: thread.id,
            providerThreadId: "provider-thread",
            scope: turnScope("turn-1"),
          },
        },
        {
          threadId: thread.id,
          event: {
            type: "turn/completed",
            threadId: thread.id,
            providerThreadId: "provider-thread",
            scope: turnScope("turn-1"),
            status: "completed",
          },
        },
      ];

      const firstResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: eventBatch,
      });
      expect(firstResponse.status).toBe(200);
      const duplicateResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: eventBatch,
      });
      expect(duplicateResponse.status).toBe(200);

      expect(
        harness.db.select().from(threads).where(eq(threads.id, thread.id)).get()
          ?.status,
      ).toBe("idle");
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(4);
    });
  });

  it("rejects unsupported tool calls", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-tool-call-unsupported",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: managerThread.id,
            providerThreadId: "provider-manager-unsupported-tool",
            turnId: "turn-1",
            callId: "call-1",
            tool: "spawn_thread",
            arguments: {},
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        success: false,
        contentItems: [
          { type: "inputText", text: "Unsupported tool: spawn_thread" },
        ],
      });
      const childThreads = harness.db
        .select()
        .from(threads)
        .where(eq(threads.parentThreadId, managerThread.id))
        .all();
      expect(childThreads).toHaveLength(0);
    });
  });

  it("rejects message_user tool calls before the turn start is stored", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: managerThread.id,
            providerThreadId: "provider-manager-missing-turn",
            turnId: "turn-missing",
            callId: "call-missing-turn",
            tool: "message_user",
            arguments: {
              text: "Need input from the user",
            },
          }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, managerThread.id))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("rejects empty tool call turn ids at the internal contract boundary", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: managerThread.id,
            providerThreadId: "provider-manager-empty-turn",
            turnId: "",
            callId: "call-empty-turn",
            tool: "message_user",
            arguments: {
              text: "Need input from the user",
            },
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, managerThread.id))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("accepts message_user tool calls after the turn start is stored", async () => {
    const harness = await createTestAppHarness();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      seedEvent(harness.deps, {
        threadId: managerThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-manager-message-user",
        sequence: 1,
        type: "turn/started",
        scope: turnScope("turn-2"),
        data: {
          providerThreadId: "provider-manager-message-user",
        },
      });

      vi.setSystemTime(2_000);
      const response = await harness.app.request(
        "/internal/session/tool-call",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: managerThread.id,
            providerThreadId: "provider-manager-message-user",
            turnId: "turn-2",
            callId: "call-2",
            tool: "message_user",
            arguments: {
              text: "Need input from the user",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const storedEvents = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, managerThread.id))
        .orderBy(events.sequence)
        .all();
      expect(storedEvents).toHaveLength(2);
      expect(storedEvents[1]?.type).toBe("system/manager/user_message");
      const updatedManagerThread = harness.db
        .select()
        .from(threads)
        .where(eq(threads.id, managerThread.id))
        .get();
      expect(updatedManagerThread?.lastReadAt).toBe(1_000);
      expect(updatedManagerThread?.latestAttentionAt).toBe(2_000);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });
});
