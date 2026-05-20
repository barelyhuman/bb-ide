import {
  cleanWorkspaceStatus,
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import {
  archiveThread,
  createEnvironment,
  createThread,
  events,
  fetchCommands,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  getThread,
  hostDaemonCommands,
  listThreads,
  queueCommand,
  reportCommandResult,
} from "@bb/db";
import {
  systemOperationEventDataSchema,
  threadSchema,
  turnScope,
  type Thread,
  type WorkspaceProvisionType,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { environmentArchiveThreadsResponseSchema } from "@bb/server-contract";
import {
  listQueuedEnvironmentCommands,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { queueEnvironmentDestroyLifecycleCommand } from "../helpers/lifecycle-commands.js";
import { requestEnvironmentCleanup } from "../../src/services/environments/environment-cleanup.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedEvent,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

interface ManagerWithAssignedChildFixture {
  childThread: Thread;
  managerThread: Thread;
}

type ThreadArchiveCommand = Extract<
  HostDaemonCommand,
  { type: "thread.archive" }
>;
type ExistingArchiveCommandState = "pending" | "fetched" | "success";

interface ExistingArchiveCommandEnvironment {
  id: string;
  path: string | null;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface QueueExistingNativeArchiveCommandArgs {
  environment: ExistingArchiveCommandEnvironment;
  hostId: string;
  providerThreadId: string;
  sessionId: string | null;
  state: ExistingArchiveCommandState;
  thread: Thread;
}

interface ReportCleanWorkspaceStatusForEnvironmentArgs {
  afterCursor?: number;
  environmentId: string;
}

function seedManagerWithAssignedChild(
  harness: TestAppHarness,
): ManagerWithAssignedChildFixture {
  const { host } = seedHostSession(harness.deps);
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
  const childThread = seedThread(harness.deps, {
    projectId: project.id,
    parentThreadId: managerThread.id,
  });
  return { childThread, managerThread };
}

function queueExistingNativeArchiveCommand(
  harness: TestAppHarness,
  args: QueueExistingNativeArchiveCommandArgs,
): void {
  if (!args.environment.path) {
    throw new Error("Native archive command fixture requires a workspace path");
  }

  const command: ThreadArchiveCommand = {
    type: "thread.archive",
    environmentId: args.environment.id,
    threadId: args.thread.id,
    workspaceContext: {
      workspacePath: args.environment.path,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    providerId: args.thread.providerId,
    providerThreadId: args.providerThreadId,
  };
  const queuedCommand = queueCommand(harness.db, harness.hub, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: command.type,
    payload: JSON.stringify(command),
  });

  if (args.state === "fetched") {
    harness.db
      .update(hostDaemonCommands)
      .set({ state: "fetched", fetchedAt: Date.now() })
      .where(eq(hostDaemonCommands.id, queuedCommand.id))
      .run();
  }
  if (args.state === "success") {
    reportCommandResult(harness.db, harness.hub, {
      commandId: queuedCommand.id,
      completedAt: Date.now(),
      resultPayload: JSON.stringify({}),
      state: "success",
    });
  }
}

async function reportCleanWorkspaceStatusForEnvironment(
  harness: TestAppHarness,
  args: ReportCleanWorkspaceStatusForEnvironmentArgs,
) {
  const command =
    args.afterCursor === undefined
      ? await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === args.environmentId,
        )
      : await waitForQueuedCommandAfter(
          harness,
          args.afterCursor,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === args.environmentId,
        );
  await reportQueuedCommandSuccess(harness, command, {
    workspaceStatus: cleanWorkspaceStatus(),
  });
  return command;
}

describe("public thread archive delete cleanup routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("archives managers by unassigning unarchived child threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { childThread, managerThread } =
        seedManagerWithAssignedChild(harness);
      const archivedChildThread = seedThread(harness.deps, {
        projectId: managerThread.projectId,
        parentThreadId: managerThread.id,
      });
      archiveThread(harness.db, harness.hub, archivedChildThread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, managerThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, childThread.id)).toMatchObject({
        archivedAt: null,
        parentThreadId: null,
      });
      expect(getThread(harness.db, archivedChildThread.id)).toMatchObject({
        parentThreadId: managerThread.id,
      });

      const storedEvent = harness.db
        .select({ type: events.type, data: events.data })
        .from(events)
        .where(eq(events.threadId, childThread.id))
        .orderBy(events.sequence)
        .all()
        .at(-1);

      expect(storedEvent?.type).toBe("system/operation");
      const parsedData = systemOperationEventDataSchema.parse(
        storedEvent ? JSON.parse(storedEvent.data) : null,
      );
      expect(parsedData).toMatchObject({
        operation: "ownership_change",
        status: "completed",
        message: "Thread released from manager",
        metadata: {
          action: "release",
          previousParentThreadId: managerThread.id,
          nextParentThreadId: null,
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects deleting managers with assigned child threads unless confirmed", async () => {
    const harness = await createTestAppHarness();
    try {
      const { managerThread } = seedManagerWithAssignedChild(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            managerChildThreadsConfirmed: false,
          }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "manager_child_threads_confirmation_required",
      });
      expect(getThread(harness.db, managerThread.id)?.deletedAt).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("deletes managers with assigned child threads after explicit confirmation", async () => {
    const harness = await createTestAppHarness();
    try {
      const { childThread, managerThread } =
        seedManagerWithAssignedChild(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${managerThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            managerChildThreadsConfirmed: true,
          }),
        },
      );

      expect(response.status).toBe(200);
      const visibleThreads = listThreads(harness.db, {
        projectId: childThread.projectId,
      });
      expect(
        visibleThreads.some((thread) => thread.id === managerThread.id),
      ).toBe(false);
      expect(getThread(harness.db, childThread.id)).toMatchObject({
        id: childThread.id,
        deletedAt: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("queues Codex archive forwarding for idle threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-archive-forward",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([
        {
          type: "thread.archive",
          environmentId: environment.id,
          threadId: thread.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
          providerId: "codex",
          providerThreadId: "provider-archive-forward",
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("archives without Codex archive forwarding when the environment is already destroyed", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "destroyed",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-destroyed-env-archive",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  for (const existingCommandState of [
    "pending",
    "fetched",
    "success",
  ] satisfies readonly ExistingArchiveCommandState[]) {
    it(`skips duplicate Codex archive forwarding when a ${existingCommandState} native archive command already exists`, async () => {
      const harness = await createTestAppHarness();
      try {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "idle",
        });
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "provider-existing-native-archive",
        });
        queueExistingNativeArchiveCommand(harness, {
          environment,
          hostId: host.id,
          providerThreadId: "provider-existing-native-archive",
          sessionId: session.id,
          state: existingCommandState,
          thread,
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/archive`,
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(200);
        expect(
          listQueuedThreadCommands(harness, "thread.archive", thread.id),
        ).toHaveLength(1);
      } finally {
        await harness.cleanup();
      }
    });
  }

  it("queues Codex archive forwarding after active threads stop", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-active-archive",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
      const stopCommand = await waitForQueuedCommand(harness, ({ command }) => {
        return command.type === "thread.stop" && command.threadId === thread.id;
      });

      const stopResponse = await reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      expect(stopResponse.status).toBe(200);

      const archiveCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        type: "thread.archive",
        environmentId: environment.id,
        threadId: thread.id,
        providerId: "codex",
        providerThreadId: "provider-active-archive",
      });
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("queues Codex archive forwarding once when stop finalizes after archive", async () => {
    // Contract: if stop is already in flight when the archive request lands,
    // only stop finalization should forward the native archive command.
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/archive-stop-race",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-archive-stop-race",
      });

      const stopResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      expect(stopResponse.status).toBe(200);
      const archivePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      const archiveResponse = await archivePromise;
      expect(archiveResponse.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(0);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});

      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      const archiveCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.archive" && command.threadId === thread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        environmentId: environment.id,
        threadId: thread.id,
      });
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("skips Codex thread archive forwarding when no provider thread id is stored", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.archive" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  for (const providerId of ["claude-code", "pi"]) {
    it(`skips archive forwarding for ${providerId} threads`, async () => {
      const harness = await createTestAppHarness();
      try {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
          status: "idle",
        });
        seedThreadRuntimeState(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: `provider-${providerId}-archive-forward`,
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/archive`,
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(200);
        await expect(
          waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "thread.archive" &&
              command.threadId === thread.id,
            100,
          ),
        ).rejects.toThrow("Timed out waiting for queued command");
      } finally {
        await harness.cleanup();
      }
    });
  }

  it("skips Codex archive forwarding when stored events show spawnAgent children", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-spawn-cascade-risk",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-spawn-cascade-risk",
        sequence: 3,
        type: "item/completed",
        scope: turnScope("turn-1"),
        data: {
          item: {
            type: "toolCall",
            id: "spawn-1",
            tool: "spawnAgent",
            status: "completed",
            arguments: {
              senderThreadId: "provider-spawn-cascade-risk",
              receiverThreadIds: ["provider-child-1"],
            },
          },
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.archive" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("queues Codex archive forwarding after releasing live BB child threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        type: "manager",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: parentThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-live-child-risk",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${parentThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, childThread.id)?.parentThreadId).toBeNull();
      const archiveCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.archive" &&
          command.threadId === parentThread.id,
      );
      expect(archiveCommand.command).toMatchObject({
        providerThreadId: "provider-live-child-risk",
        threadId: parentThread.id,
        type: "thread.archive",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("skips Codex unarchive forwarding because archive is BB-owned state", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-unarchive-forward",
      });
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.unarchive", thread.id),
      ).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("blocks follow-up sends while Codex native archive forwarding is pending", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-pending-native-archive",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toHaveLength(1);

      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      expect(unarchiveResponse.status).toBe(200);

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "follow up" }],
            mode: "start",
          }),
        },
      );

      expect(sendResponse.status).toBe(409);
      await expect(readJson(sendResponse)).resolves.toMatchObject({
        code: "thread_archive_in_progress",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("skips provider-only Codex unarchive after managed environment cleanup", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/destroyed-managed-worktree",
        status: "destroyed",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-unarchive-cleaned",
      });
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(
        listQueuedThreadCommands(harness, "thread.unarchive", thread.id),
      ).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("cancels pending managed cleanup when a thread is unarchived", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/unarchive-cancels-cleanup",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, thread.id);
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: null,
        cleanupRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({ state: "cancelled" });
    } finally {
      await harness.cleanup();
    }
  });

  it("cancels a queued managed destroy command when a thread is unarchived", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/unarchive-cancels-queued-destroy",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      const statusCommand = await reportCleanWorkspaceStatusForEnvironment(
        harness,
        {
          environmentId: environment.id,
        },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
      expect(getCommand(harness.db, destroyCommand.row.id)).toMatchObject({
        state: "error",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: null,
        cleanupRequestedAt: null,
        status: "ready",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({ state: "cancelled" });

      const staleResultResponse = await reportQueuedCommandSuccess(
        harness,
        destroyCommand,
        {},
      );
      expect(staleResultResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects unarchive when managed destroy has already been fetched", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/unarchive-rejects-fetched-destroy",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      const statusCommand = await reportCleanWorkspaceStatusForEnvironment(
        harness,
        {
          environmentId: environment.id,
        },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      fetchCommands(harness.db, harness.hub, { hostId: host.id });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_cleanup_in_progress",
      });
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroying",
      );

      const destroyResultResponse = await reportQueuedCommandSuccess(
        harness,
        destroyCommand,
        {},
      );
      expect(destroyResultResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "destroyed",
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("ignores stale destroy results when an environment has live threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        path: "/tmp/stale-destroy-live-thread",
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const queuedRow = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/stale-destroy-live-thread",
            workspaceProvisionType: "managed-worktree",
          },
        },
      });
      const destroyCommand = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === queuedRow.id,
      );

      const response = await reportQueuedCommandSuccess(
        harness,
        destroyCommand,
        {},
      );

      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({ state: "cancelled" });
    } finally {
      await harness.cleanup();
    }
  });

  it("archives dirty managed workspaces and leaves unsafe cleanup pending", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const isolatedManagedEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-dirty",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const dirtyThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: isolatedManagedEnvironment.id,
        status: "idle",
      });

      const stopPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        {
          method: "POST",
        },
      );
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});
      const stopResponse = await stopPromise;
      expect(stopResponse.status).toBe(200);

      const dirtyArchivePromise = harness.app.request(
        `/api/v1/threads/${dirtyThread.id}/archive`,
        {
          method: "POST",
        },
      );
      const dirtyStatusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === isolatedManagedEnvironment.id,
      );
      await reportQueuedCommandSuccess(harness, dirtyStatusCommand, {
        workspaceStatus: {
          ...cleanWorkspaceStatus(),
          workingTree: {
            ...cleanWorkspaceStatus().workingTree,
            state: "dirty_uncommitted",
            hasUncommittedChanges: true,
          },
        },
      });
      const dirtyArchiveResponse = await dirtyArchivePromise;
      expect(dirtyArchiveResponse.status).toBe(200);
      expect(getThread(harness.db, dirtyThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(
        getEnvironment(harness.db, isolatedManagedEnvironment.id),
      ).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          isolatedManagedEnvironment.id,
        ),
      ).toEqual([]);

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      await expect(
        waitForQueuedCommandAfter(
          harness,
          dirtyStatusCommand.row.cursor,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");

      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        {
          method: "POST",
        },
      );
      expect(unarchiveResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("stops active threads while the host is disconnected", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-stop-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.stopRequestedAt).toBeTypeOf(
        "number",
      );

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(stopCommand.row.sessionId).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("deletes active threads while the host is disconnected and hides the tombstone immediately", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-delete-active-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/delete-active-offline",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(200);
      const deletedThread = getThread(harness.db, thread.id);
      expect(deletedThread?.deletedAt).toBeTypeOf("number");
      expect(deletedThread?.stopRequestedAt).toBeTypeOf("number");
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(stopCommand.row.sessionId).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("deletes idle threads while the host is disconnected without queueing stop", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-delete-idle-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        id: thread.id,
        deletedAt: expect.any(Number),
      });
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.deleted" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("deletes idle managed threads while disconnected and leaves safe cleanup pending", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-delete-idle-managed-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/delete-idle-managed-offline",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        id: thread.id,
        deletedAt: expect.any(Number),
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.deleted" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("tombstones created threads that already have thread.start queued", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-delete-created-started",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/delete-created-started",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/delete-created-started",
      });

      const createResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start then delete me" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(createResponse));
      expect(createdThread.status).toBe("provisioning");

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );

      const deleteResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );

      expect(deleteResponse.status).toBe(200);
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        deletedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
      });
      expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
        0,
      );

      const queuedStop = await waitForQueuedCommandAfter(
        harness,
        queuedStart.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === createdThread.id,
      );
      expect(queuedStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: createdThread.id,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("queues thread.stop before cleanup when archiving a created thread with pending start", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-created-start",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/archive-created-start",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/archive-created-start",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });

      const createResponse = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start then archive me" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(createResponse));
      expect(createdThread.status).toBe("provisioning");

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(archiveResponse.status).toBe(200);
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        archivedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
      });

      const queuedStop = await waitForQueuedCommandAfter(
        harness,
        queuedStart.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === createdThread.id,
      );
      expect(queuedStop.command).toMatchObject({
        environmentId: environment.id,
        threadId: createdThread.id,
      });

      await expect(
        waitForQueuedCommandAfter(
          harness,
          queuedStop.row.cursor,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("archives every live thread in a worktree environment", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-worktree-row",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const alreadyArchivedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.db, harness.hub, alreadyArchivedThread.id);
      const otherEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-worktree-row-other",
      });
      const otherEnvironmentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: otherEnvironment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const body = environmentArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.archivedThreadIds).toHaveLength(2);
      expect(body.archivedThreadIds).toEqual(
        expect.arrayContaining([firstThread.id, secondThread.id]),
      );
      expect(getThread(harness.db, firstThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, secondThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(
        getThread(harness.db, alreadyArchivedThread.id)?.archivedAt,
      ).toBeTypeOf("number");
      expect(
        getThread(harness.db, otherEnvironmentThread.id)?.archivedAt,
      ).toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: expect.any(Number),
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        kind: "destroy",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("archives non-managed worktree threads without requesting cleanup", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        projectId: project.id,
        managed: false,
        isGitRepo: true,
        isWorktree: true,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/archive-unmanaged-worktree-row",
        status: "ready",
        branchName: "bb/unmanaged-worktree",
        defaultBranch: "main",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      const body = environmentArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.archivedThreadIds).toHaveLength(2);
      expect(body.archivedThreadIds).toEqual(
        expect.arrayContaining([firstThread.id, secondThread.id]),
      );
      expect(getThread(harness.db, firstThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getThread(harness.db, secondThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: null,
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toBeNull();
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects environment archive for non-worktree environments", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("archives shared managed environments without prompting or queueing cleanup", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-shared",
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${archivedThread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, archivedThread.id)?.archivedAt).toBeTypeOf(
        "number",
      );
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("archives isolated managed environments while disconnected and records deferred safe cleanup", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-archive-managed-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-offline",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });
      await expect(
        waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("archives active isolated managed environments without destroying them until stop finalization completes", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-managed-active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-active",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);

      // Snapshot 1: archive committed, stop in flight, destroy deferred.
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      expect(getThread(harness.db, thread.id)?.stopRequestedAt).toBeTypeOf(
        "number",
      );
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      const stopResultResponse = await reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      expect(stopResultResponse.status).toBe(200);

      await reportCleanWorkspaceStatusForEnvironment(harness, {
        afterCursor: stopCommand.row.cursor,
        environmentId: environment.id,
      });
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        stopCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves safe managed cleanup across active thread stop finalization", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archive-managed-active-safe",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/archive-managed-active-safe",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "ready",
      });

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );

      const stopResultPromise = reportQueuedCommandSuccess(
        harness,
        stopCommand,
        {},
      );
      const stopResultResponse = await stopResultPromise;
      expect(stopResultResponse.status).toBe(200);

      const statusCommand = await reportCleanWorkspaceStatusForEnvironment(
        harness,
        {
          afterCursor: stopCommand.row.cursor,
          environmentId: environment.id,
        },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
      await expect(
        waitForQueuedCommandAfter(
          harness,
          statusCommand.row.cursor,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
    } finally {
      await harness.cleanup();
    }
  });

  it("queues environment.destroy when deleting the last thread on a managed environment", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/delete-managed",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(response.status).toBe(200);

      const statusCommand = await reportCleanWorkspaceStatusForEnvironment(
        harness,
        { environmentId: environment.id },
      );
      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        statusCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("records provisioning managed cleanup intent without queueing an invalid destroy", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: null,
        managed: true,
        status: "provisioning",
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ managerChildThreadsConfirmed: false }),
        },
      );
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
        status: "provisioning",
      });

      const destroyCommands = harness.db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "environment.destroy"))
        .all();
      expect(destroyCommands).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("archives non-git threads without requiring workspace status", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/non-git-thread",
        status: "ready",
        isGitRepo: false,
        defaultBranch: null,
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "idle",
        title: "Non-git thread",
        titleFallback: "Non-git thread",
      });
      const commandCountBefore = harness.db
        .select({ id: hostDaemonCommands.id })
        .from(hostDaemonCommands)
        .all().length;

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeTypeOf("number");
      const commandCountAfter = harness.db
        .select({ id: hostDaemonCommands.id })
        .from(hostDaemonCommands)
        .all().length;
      expect(commandCountAfter).toBe(commandCountBefore);
    } finally {
      await harness.cleanup();
    }
  });
});
