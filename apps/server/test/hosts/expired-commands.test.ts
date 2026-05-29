import { eq } from "drizzle-orm";
import {
  createPendingInteraction,
  getEnvironment,
  getEnvironmentOperation,
  getPendingInteraction,
  getThread,
  getThreadOperation,
  hostDaemonCommands,
  queueCommand,
  setPendingInteractionResolving,
} from "@bb/db";
import { setEnvironmentStatus } from "@bb/db/internal-lifecycle";
import { describe, expect, it } from "vitest";
import { handleExpiredCommands } from "../../src/services/hosts/expired-commands.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  queueEnvironmentDestroyLifecycleCommand,
  queueEnvironmentProvisionLifecycleCommand,
  queueThreadStartLifecycleCommand,
  queueThreadStopLifecycleCommand,
} from "../helpers/lifecycle-commands.js";

const EXPIRED_RESULT_PAYLOAD = JSON.stringify({
  errorCode: "command_expired",
  errorMessage: "Command expired after retry",
});

describe("expired commands", () => {
  it.each([
    {
      type: "environment.destroy" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "environment.destroy" as const,
        environmentId: args.environmentId,
        workspaceContext: {
          workspacePath: args.workspacePath,
          workspaceProvisionType: args.workspaceProvisionType,
        },
      }),
    },
    {
      type: "environment.provision" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "environment.provision" as const,
        environmentId: args.environmentId,
        initiator: null,
        workspaceProvisionType: "unmanaged" as const,
        path: args.workspacePath,
      }),
    },
    {
      type: "thread.start" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "thread.start" as const,
        environmentId: args.environmentId,
        threadId: args.threadId,
        requestId: "creq_23456789ab",
        input: [{ type: "text" as const, text: "hello" }],
        workspaceContext: {
          workspacePath: args.workspacePath,
          workspaceProvisionType: args.workspaceProvisionType,
        },
        projectId: "proj_test",
        providerId: "codex",
        options: {
          model: "gpt-5",
          reasoningLevel: "medium" as const,
          permissionMode: "full" as const,
          permissionEscalation: null,
          serviceTier: "default" as const,
        },
        instructions: "instructions",
        dynamicTools: [],
        instructionMode: "append" as const,
      }),
    },
    {
      type: "thread.stop" as const,
      buildPayload: (args: {
        environmentId: string;
        threadId: string;
        workspacePath: string;
        workspaceProvisionType: string;
      }) => ({
        type: "thread.stop" as const,
        environmentId: args.environmentId,
        threadId: args.threadId,
      }),
    },
  ])(
    "reports expired $type results with the original command type",
    async ({ type, buildPayload }) => {
      const harness = await createTestAppHarness();
      try {
        const host = seedHost(harness.deps, { id: `host-expired-${type}` });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/tmp/${type.replace(".", "-")}`,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "created",
        });
        const command = queueCommand(harness.db, harness.hub, {
          hostId: host.id,
          type,
          payload: JSON.stringify(
            buildPayload({
              environmentId: environment.id,
              threadId: thread.id,
              workspacePath: environment.path ?? `/tmp/${thread.id}`,
              workspaceProvisionType: environment.workspaceProvisionType,
            }),
          ),
        });

        const resultPromise = harness.hub.waitForCommandResult(
          command.id,
          1_000,
        );
        await handleExpiredCommands(harness.deps, {
          commandIds: [command.id],
        });

        await expect(resultPromise).resolves.toMatchObject({
          commandId: command.id,
          errorCode: "command_expired",
          errorMessage: "Command expired after retry",
          ok: false,
          type,
        });
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("settles expired commands without owners without parsing payload JSON", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-expired-invalid-workspace-status",
      });
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        type: "workspace.status",
        payload: "{",
      });

      const resultPromise = harness.hub.waitForCommandResult(command.id, 1_000);
      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      await expect(resultPromise).resolves.toMatchObject({
        commandId: command.id,
        errorCode: "command_expired",
        errorMessage: "Command expired after retry",
        ok: false,
        type: "workspace.status",
      });
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.id, command.id))
          .get(),
      ).toMatchObject({
        state: "error",
        resultPayload: EXPIRED_RESULT_PAYLOAD,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired environment.destroy through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-expired-destroy" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      const command = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        environmentId: environment.id,
        sessionId: null,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: environment.path ?? "/tmp/expired-destroy",
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      });
      setEnvironmentStatus(harness.db, harness.hub, environment.id, {
        status: "destroying",
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.id, command.id))
          .get(),
      ).toMatchObject({
        state: "error",
        resultPayload: EXPIRED_RESULT_PAYLOAD,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired environment.provision through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-expired-provision" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        environmentId: environment.id,
        sessionId: null,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: environment.path ?? "/tmp/expired-provision",
        },
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired thread.start through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-expired-thread-start" });
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
        status: "created",
      });
      const command = queueThreadStartLifecycleCommand(harness, {
        hostId: host.id,
        threadId: thread.id,
        sessionId: null,
        command: {
          type: "thread.start",
          environmentId: environment.id,
          threadId: thread.id,
          requestId: "creq_23456789ac",
          input: [{ type: "text", text: "hello" }],
          workspaceContext: {
            workspacePath: environment.path ?? "/tmp/expired-thread-start",
            workspaceProvisionType: environment.workspaceProvisionType,
          },
          projectId: project.id,
          providerId: "codex",
          options: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "full",
            permissionEscalation: null,
            serviceTier: "default",
          },
          instructions: "instructions",
          dynamicTools: [],
          instructionMode: "append",
        },
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "start",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired thread.stop through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-expired-thread-stop" });
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
      const command = queueThreadStopLifecycleCommand(harness, {
        hostId: host.id,
        threadId: thread.id,
        sessionId: null,
        command: {
          type: "thread.stop",
          environmentId: environment.id,
          threadId: thread.id,
        },
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "stop",
        }),
      ).toMatchObject({
        failureReason: "Command expired after retry",
        state: "failed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired interactive.resolve through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-expired-interactive-resolve",
      });
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
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn_expired_interactive",
      });
      const interaction = createPendingInteraction(harness.db, {
        threadId: thread.id,
        turnId: "turn_expired_interactive",
        providerId: "codex",
        providerThreadId: "provider-expired-interactive",
        providerRequestId: "request-expired-interactive",
        sessionId: "session-expired-interactive",
        payload: JSON.stringify({
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-expired-interactive",
            command: "git status",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["deny"],
        }),
      });
      const resolution = { decision: "deny" };
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        type: "interactive.resolve",
        payload: JSON.stringify({
          type: "interactive.resolve",
          environmentId: environment.id,
          threadId: thread.id,
          interactionId: interaction.id,
          providerId: "codex",
          providerThreadId: "provider-expired-interactive",
          providerRequestId: "request-expired-interactive",
          resolution,
        }),
      });
      setPendingInteractionResolving(harness.db, {
        commandId: command.id,
        id: interaction.id,
        resolution: JSON.stringify(resolution),
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(getPendingInteraction(harness.db, interaction.id)).toMatchObject({
        status: "interrupted",
        statusReason: "Command expired after retry",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("settles expired turn.submit through the command-result owner", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, { id: "host-expired-turn-submit" });
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
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        type: "turn.submit",
        payload: JSON.stringify({
          type: "turn.submit",
          environmentId: environment.id,
          threadId: thread.id,
          requestId: "creq_23456789ad",
          target: { mode: "auto", expectedTurnId: null },
          input: [{ type: "text", text: "hello" }],
          options: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "full",
            permissionEscalation: null,
            serviceTier: "default",
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: environment.path ?? "/tmp/expired-turn-submit",
              workspaceProvisionType: environment.workspaceProvisionType,
            },
            projectId: project.id,
            providerId: "codex",
            providerThreadId: "provider-expired-turn-submit",
            instructions: "instructions",
            dynamicTools: [],
            instructionMode: "append",
          },
        }),
      });

      await handleExpiredCommands(harness.deps, {
        commandIds: [command.id],
      });

      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    } finally {
      await harness.cleanup();
    }
  });
});
