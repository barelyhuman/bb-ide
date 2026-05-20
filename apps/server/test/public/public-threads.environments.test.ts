import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import {
  archiveThread,
  createPendingInteraction,
  environmentOperations,
  getEnvironment,
  getThread,
  getThreadOperation,
  hostDaemonCommands,
  listThreads,
} from "@bb/db";
import { setEnvironmentStatus } from "@bb/db/internal-lifecycle";
import { threadSchema } from "@bb/domain";
import { threadListResponseSchema } from "@bb/server-contract";
import {
  reportQueuedCommandSuccess,
  reportQueuedCommandError,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { advanceThreadProvisioning } from "../../src/services/threads/thread-provisioning.js";

const CHECKOUT_BLOCKING_THREAD_STATUSES = [
  "active",
  "idle",
  "provisioning",
  "created",
] as const;

const CHECKOUT_PREFLIGHT_FAILURES = [
  {
    errorCode: "checkout_dirty",
    errorMessage:
      "Cannot checkout branch while the workspace has uncommitted changes",
    path: "/tmp/dirty-unmanaged-checkout",
  },
  {
    errorCode: "checkout_conflicts",
    errorMessage:
      "Cannot checkout branch while the workspace has unresolved conflicts",
    path: "/tmp/conflicted-unmanaged-checkout",
  },
] as const;

describe("public thread environment routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("includes hasPendingInteraction in thread list responses", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-pending",
      });
      const firstThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
      });
      const secondThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
      });

      createPendingInteraction(harness.db, {
        payload: "{}",
        providerId: "codex",
        providerRequestId: "request-1",
        providerThreadId: "provider-thread-1",
        sessionId: "session-1",
        threadId: firstThread.id,
        turnId: "turn_1",
      });

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: secondThread.id,
            hasPendingInteraction: false,
          }),
          expect.objectContaining({
            id: firstThread.id,
            hasPendingInteraction: true,
          }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("includes archived managed child threads in archived thread lists", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-archived-managed",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-archived-managed/environment",
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title: "Manager thread",
        type: "manager",
      });
      const managedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: managerThread.id,
        projectId: project.id,
        title: "Managed archived thread",
      });
      const rootThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title: "Root archived thread",
      });
      const liveManagedThread = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: managerThread.id,
        projectId: project.id,
        title: "Live managed thread",
      });

      archiveThread(harness.db, harness.deps.hub, managedThread.id);
      archiveThread(harness.db, harness.deps.hub, rootThread.id);

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=true`,
      );

      expect(response.status).toBe(200);
      const body = threadListResponseSchema.parse(await readJson(response));
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: managedThread.id,
            parentThreadId: managerThread.id,
          }),
          expect.objectContaining({
            id: rootThread.id,
            parentThreadId: null,
          }),
        ]),
      );
      expect(body.map((thread) => thread.id)).not.toContain(
        liveManagedThread.id,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("includes environmentWorkspaceDisplayKind in thread list responses", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind",
      });
      const directEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind/direct",
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
      });
      const worktreeEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-environment-kind/worktree",
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });
      const directThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: directEnvironment.id,
      });
      const worktreeThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: worktreeEnvironment.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: directThread.id,
            environmentHostId: host.id,
            environmentBranchName: "bb/test",
            environmentWorkspaceDisplayKind: "other",
          }),
          expect.objectContaining({
            id: worktreeThread.id,
            environmentHostId: host.id,
            environmentBranchName: "bb/test",
            environmentWorkspaceDisplayKind: "managed-worktree",
          }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("includes runtime display state for active thread list entries", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-list-runtime",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-runtime",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-list-runtime/environment",
        projectId: project.id,
      });
      const firstThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const secondThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&archived=false`,
      );

      expect(response.status).toBe(200);
      const body = threadListResponseSchema.parse(await readJson(response));
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: firstThread.id,
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }),
          expect.objectContaining({
            id: secondThread.id,
            runtime: {
              displayStatus: "active",
              hostReconnectGraceExpiresAt: null,
            },
          }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("reuses the ready unmanaged environment for the default source path", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/shared-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "ready",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Reuse the existing direct workspace" },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread).toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.environmentId === environment.id &&
          command.threadId === createdThread.id,
      );
      expect(queuedStart.command).toMatchObject({
        workspaceContext: {
          workspacePath: source.path,
          workspaceProvisionType: "unmanaged",
        },
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
      });
      expect(getThread(harness.db, createdThread.id)).toMatchObject({
        type: "standard",
        parentThreadId: null,
      });

      const provisionCommands = harness.db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "environment.provision"))
        .all();
      expect(provisionCommands).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("reconciles explicit branch checkout before starting a thread on an existing unmanaged environment", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/reconcile-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "ready",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Start after checkout" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
              branch: { kind: "existing", name: "feature/reconcile" },
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      expect(createdThread).toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      const queuedProvision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      expect(queuedProvision.command).toMatchObject({
        environmentId: environment.id,
        path: source.path,
        workspaceProvisionType: "unmanaged",
        checkout: { kind: "existing", name: "feature/reconcile" },
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
      expect(
        harness.db
          .select()
          .from(environmentOperations)
          .where(eq(environmentOperations.environmentId, environment.id))
          .all(),
      ).toMatchObject([{ kind: "reprovision", state: "queued" }]);
      expect(
        getThreadOperation(harness.db, {
          threadId: createdThread.id,
          kind: "provision",
        }),
      ).toMatchObject({
        provisioningEnvironmentId: environment.id,
        provisioningStage: "environment-provisioning",
      });
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.type, "thread.start"))
          .all(),
      ).toHaveLength(0);

      const result = await reportQueuedCommandSuccess(
        harness,
        queuedProvision,
        {
          branchName: "feature/reconcile",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          path: source.path,
          transcript: [],
        },
      );
      expect(result.status).toBe(200);

      const queuedStart = await waitForQueuedCommandAfter(
        harness,
        queuedProvision.row.cursor,
        ({ command }) =>
          command.type === "thread.start" &&
          command.environmentId === environment.id &&
          command.threadId === createdThread.id,
      );
      expect(queuedStart.command).toMatchObject({
        workspaceContext: {
          workspacePath: source.path,
          workspaceProvisionType: "unmanaged",
        },
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/reconcile",
        status: "ready",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("requeues stranded unmanaged checkout provisioning before starting the thread", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stranded-unmanaged-checkout",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "ready",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Recover checkout" }],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
              branch: { kind: "existing", name: "feature/recovered" },
            },
          },
        }),
      });
      expect(response.status).toBe(201);
      const createdThread = threadSchema.parse(await readJson(response));
      const originalProvision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );

      harness.db
        .delete(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, originalProvision.row.id))
        .run();
      harness.db
        .delete(environmentOperations)
        .where(eq(environmentOperations.environmentId, environment.id))
        .run();
      setEnvironmentStatus(harness.db, harness.hub, environment.id, {
        status: "ready",
      });

      await advanceThreadProvisioning(harness.deps, {
        threadId: createdThread.id,
      });

      const requeuedProvision = await waitForQueuedCommandAfter(
        harness,
        originalProvision.row.cursor,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      expect(requeuedProvision.command).toMatchObject({
        checkout: { kind: "existing", name: "feature/recovered" },
        environmentId: environment.id,
        path: source.path,
        workspaceProvisionType: "unmanaged",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.type, "thread.start"))
          .all(),
      ).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it.each(CHECKOUT_PREFLIGHT_FAILURES)(
    "fails unmanaged checkout provisioning without starting the thread when preflight fails with $errorCode",
    async ({ errorCode, errorMessage, path }) => {
      const harness = await createTestAppHarness();
      try {
        const { host } = seedHostSession(harness.deps);
        const { project, source } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: source.path,
          status: "ready",
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Preflight failure" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: null,
                branch: { kind: "existing", name: "feature/preflight" },
              },
            },
          }),
        });
        expect(response.status).toBe(201);
        const createdThread = threadSchema.parse(await readJson(response));
        const queuedProvision = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.provision" &&
            command.environmentId === environment.id,
        );

        const result = await reportQueuedCommandError(
          harness,
          queuedProvision,
          {
            errorCode,
            errorMessage,
          },
        );
        expect(result.status).toBe(200);
        expect(getThread(harness.db, createdThread.id)?.status).toBe("error");
        expect(
          harness.db
            .select()
            .from(hostDaemonCommands)
            .where(eq(hostDaemonCommands.type, "thread.start"))
            .all(),
        ).toHaveLength(0);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it.each(CHECKOUT_BLOCKING_THREAD_STATUSES)(
    "blocks explicit branch checkout when another thread is %s in the unmanaged environment",
    async (status) => {
      const harness = await createTestAppHarness();
      try {
        const { host } = seedHostSession(harness.deps);
        const { project, source } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: "/tmp/active-unmanaged-project",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: source.path,
          status: "ready",
        });
        seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status,
        });

        const response = await harness.app.request("/api/v1/threads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Try branch checkout" }],
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: null,
                branch: { kind: "existing", name: "feature/blocked" },
              },
            },
          }),
        });

        expect(response.status).toBe(409);
        await expect(readJson(response)).resolves.toMatchObject({
          code: "invalid_request",
          message:
            "Cannot checkout branch while another thread is using this workspace",
        });
        expect(listThreads(harness.db, { projectId: project.id })).toHaveLength(
          1,
        );
        expect(
          harness.db
            .select()
            .from(hostDaemonCommands)
            .where(eq(hostDaemonCommands.type, "environment.provision"))
            .all(),
        ).toHaveLength(0);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("attaches new threads to an in-flight unmanaged environment without reprovisioning", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/inflight-unmanaged-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        status: "provisioning",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Wait for the existing provisioning flow" },
          ],
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: null,
            },
          },
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });

      const queuedCommands = harness.db.select().from(hostDaemonCommands).all();
      expect(queuedCommands).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("reuses an existing environment when requested", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/reuse-project",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Reuse the environment" }],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        environmentId: environment.id,
        status: "provisioning",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("fails managed reprovision send when the host is disconnected", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-send-reprovision-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/send-reprovision-offline-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/send-reprovision-offline-target",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "auto",
            model: "gpt-5",
            input: [{ type: "text", text: "Resume after reconnect" }],
          }),
        },
      );

      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_disconnected",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.type, "environment.provision"))
          .all(),
      ).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });
});
