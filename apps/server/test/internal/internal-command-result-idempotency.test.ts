import { and, eq, sql } from "drizzle-orm";
import {
  cancelCommand,
  events,
  getEnvironment,
  getEnvironmentOperation,
  getHostOperation,
  getThread,
  getThreadOperation,
  hostDaemonCommands,
  queueCommand,
  reportCommandResult,
} from "@bb/db";
import {
  markHostOperationRecordQueued,
  setEnvironmentRecordDestroyed,
  upsertHostOperationRecord,
  upsertThreadOperationRecord,
} from "@bb/db/internal-lifecycle";
import { systemThreadProvisioningEventDataSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import {
  advanceEnvironmentProvisioning,
  requestEnvironmentProvision,
} from "../../src/services/environments/environment-provisioning.js";
import { requestEnvironmentCleanup } from "../../src/services/environments/environment-cleanup.js";
import { buildDirectEnvironmentProvisionRequest } from "../../src/services/environments/environment-provision-request.js";
import {
  requestThreadStart,
  requestThreadStop,
} from "../../src/services/threads/thread-lifecycle.js";
import { buildEnvironmentProvisionCommand } from "../../src/services/threads/thread-create-helpers.js";
import type { QueueThreadStartCommandArgs } from "../../src/services/threads/thread-commands.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import {
  queueEnvironmentDestroyLifecycleCommand,
  queueEnvironmentProvisionLifecycleCommand,
} from "../helpers/lifecycle-commands.js";
import {
  createAllowOnceResolution,
  createCommandApprovalPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

interface ReuseThreadProvisionOperationArgs {
  clientRequestId: string;
  environmentId: string;
  inputText: string;
  provisionEventSequence: number;
  provisioningId: string;
  titleProvided: boolean;
}

function buildReuseThreadProvisionOperation(
  args: ReuseThreadProvisionOperationArgs,
) {
  return {
    payload: JSON.stringify({
      branchSlug: null,
      clientRequestId: args.clientRequestId,
      environmentIntent: {
        type: "reuse",
        environmentId: args.environmentId,
      },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        permissionEscalation: null,
        source: "client/turn/requested",
      },
      input: [{ type: "text", text: args.inputText }],
      titleProvided: args.titleProvided,
    }),
    provisioningState: {
      environmentId: args.environmentId,
      provisionEventSequence: args.provisionEventSequence,
      provisioningId: args.provisioningId,
      stage: "environment-provisioning" as const,
      workspaceReadyEventSequence: null,
    },
  };
}

describe("internal command result idempotency", () => {
  it("replays active lifecycle state when a command-result retry arrives after partial settlement", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-result-retry-after-partial-settlement",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/retry-partial-provision",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const provisionRequest = appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        type: "client/turn/requested",
        input: [{ type: "text", text: "Retry partial result" }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
        initiator: "user",
        requestMethod: "thread/start",
        source: "spawn",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "provision",
        ...buildReuseThreadProvisionOperation({
          clientRequestId: provisionRequest.requestId,
          environmentId: environment.id,
          inputText: "Retry partial result",
          provisionEventSequence: provisionRequest.sequence,
          provisioningId: "tpv-idempotency-1",
          titleProvided: true,
        }),
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: {
            threadId: thread.id,
            provisioningId: "tpv-idempotency-1",
          },
          workspaceProvisionType: "unmanaged",
          path: "/tmp/retry-partial-provision",
        },
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );
      const result = {
        path: "/tmp/retry-partial-provision",
        branchName: "bb/retry-partial",
        defaultBranch: "main",
        isGitRepo: true,
        isWorktree: false,
        transcript: [],
      };

      reportCommandResult(harness.db, harness.hub, {
        commandId: command.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify(result),
      });

      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        })?.state,
      ).toBe("queued");

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queued,
        result,
      );
      expect(retryResponse.status).toBe(200);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        }),
      ).toMatchObject({
        failureReason: null,
        state: "completed",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("provisioning");

      const startCommands = harness.db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "thread.start"))
        .all();
      expect(startCommands).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("fails lifecycle state when command-result side effects throw", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-result-side-effect-failure",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/side-effect-failure",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "provision",
        payload: buildReuseThreadProvisionOperation({
          clientRequestId: "creq_23456789ab",
          environmentId: environment.id,
          inputText: "Side-effect failure",
          provisionEventSequence: 0,
          provisioningId: "tpv-idempotency-side-effect-failure",
          titleProvided: true,
        }).payload,
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: "/tmp/side-effect-failure",
        },
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );

      const response = await reportQueuedCommandSuccess(harness, queued, {
        path: "/tmp/side-effect-failure",
        branchName: "bb/side-effect-failure",
        defaultBranch: "main",
        isGitRepo: true,
        isWorktree: false,
        transcript: [],
      });
      expect(response.status).toBe(200);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        }),
      ).toMatchObject({
        failureReason: expect.stringContaining(
          "Server failed to apply command result side effects",
        ),
        state: "failed",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
    } finally {
      await harness.cleanup();
    }
  });

  it("does not replay side effects when the same command result is reported twice", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-result-idempotent",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/idempotent-provision",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const provisionRequest = appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        type: "client/turn/requested",
        input: [{ type: "text", text: "Start once" }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
        initiator: "user",
        requestMethod: "thread/start",
        source: "spawn",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "provision",
        ...buildReuseThreadProvisionOperation({
          clientRequestId: provisionRequest.requestId,
          environmentId: environment.id,
          inputText: "Start once",
          provisionEventSequence: provisionRequest.sequence,
          provisioningId: "tpv-idempotency-2",
          titleProvided: true,
        }),
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: {
            threadId: thread.id,
            provisioningId: "tpv-idempotency-2",
          },
          workspaceProvisionType: "unmanaged",
          path: "/tmp/idempotent-provision",
        },
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );

      const firstResponse = await reportQueuedCommandSuccess(harness, queued, {
        path: "/tmp/idempotent-provision",
        branchName: "bb/idempotent",
        defaultBranch: "main",
        isGitRepo: true,
        isWorktree: false,
        transcript: [],
      });
      expect(firstResponse.status).toBe(200);

      const threadStartCommand = await waitForQueuedCommandAfter(
        harness,
        command.cursor,
        ({ command: queuedCommand }) =>
          queuedCommand.type === "thread.start" &&
          queuedCommand.threadId === thread.id,
      );
      expect(threadStartCommand.command).toMatchObject({
        environmentId: environment.id,
        threadId: thread.id,
      });

      const secondResponse = await reportQueuedCommandSuccess(harness, queued, {
        path: "/tmp/idempotent-provision",
        branchName: "bb/idempotent",
        defaultBranch: "main",
        isGitRepo: true,
        isWorktree: false,
        transcript: [],
      });
      expect(secondResponse.status).toBe(200);

      const startCommands = harness.db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "thread.start"))
        .all();
      expect(startCommands).toHaveLength(1);
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
    } finally {
      await harness.cleanup();
    }
  });

  it("deduplicates concurrent thread.start requests during provisioning handoff", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-concurrent-thread-start-handoff",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/concurrent-thread-start-handoff",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const provisionRequest = appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        type: "client/turn/requested",
        input: [{ type: "text", text: "Concurrent start handoff" }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
          source: "client/turn/requested",
        },
        initiator: "user",
        requestMethod: "thread/start",
        source: "spawn",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "provision",
        ...buildReuseThreadProvisionOperation({
          clientRequestId: provisionRequest.requestId,
          environmentId: environment.id,
          inputText: "Concurrent start handoff",
          provisionEventSequence: provisionRequest.sequence,
          provisioningId: "tpv-concurrent-start-handoff",
          titleProvided: true,
        }),
      });

      const requestArgs: Omit<
        QueueThreadStartCommandArgs,
        "input" | "requestId"
      > = {
        thread,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        permissionEscalation: "ask",
        projectId: project.id,
        providerId: thread.providerId,
      };

      await Promise.all([
        requestThreadStart(harness.deps, {
          ...requestArgs,
          requestId: provisionRequest.requestId,
          input: [{ type: "text", text: "First concurrent start" }],
        }),
        requestThreadStart(harness.deps, {
          ...requestArgs,
          requestId: "creq_23456789ac",
          input: [{ type: "text", text: "Second concurrent start" }],
        }),
      ]);

      const startCommands = harness.db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.type, "thread.start"))
        .all();
      expect(startCommands).toHaveLength(1);

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (queuedStart.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }

      const startOperation = getThreadOperation(harness.db, {
        threadId: thread.id,
        kind: "start",
      });
      expect(startOperation?.commandId).toBe(queuedStart.row.id);

      const provisionOperation = getThreadOperation(harness.db, {
        threadId: thread.id,
        kind: "provision",
      });
      expect(provisionOperation?.state).toBe("completed");

      const provisioningEvents = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "system/thread-provisioning"),
          ),
        )
        .all();
      const completedProvisioningEvent = provisioningEvents.find((event) => {
        const data = systemThreadProvisioningEventDataSchema.parse(
          JSON.parse(event.data),
        );
        return data.status === "completed";
      });
      expect(completedProvisioningEvent).toBeDefined();
      expect(queuedStart.command.requestId).toBe(provisionRequest.requestId);
    } finally {
      await harness.cleanup();
    }
  });

  it("rolls back provisioning completion when start operation creation fails", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-atomic-thread-start-handoff",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/atomic-thread-start-handoff",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const provisionRequest = appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        type: "client/turn/requested",
        input: [{ type: "text", text: "Atomic start handoff" }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
          source: "client/turn/requested",
        },
        initiator: "user",
        requestMethod: "thread/start",
        source: "spawn",
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "provision",
        ...buildReuseThreadProvisionOperation({
          clientRequestId: provisionRequest.requestId,
          environmentId: environment.id,
          inputText: "Atomic start handoff",
          provisionEventSequence: provisionRequest.sequence,
          provisioningId: "tpv-atomic-start-handoff",
          titleProvided: true,
        }),
      });

      harness.db.run(
        sql.raw(`
          CREATE TRIGGER abort_start_operation_insert
          BEFORE INSERT ON thread_operations
          WHEN NEW.kind = 'start'
          BEGIN
            SELECT RAISE(ABORT, 'abort start operation insert');
          END
        `),
      );

      try {
        await expect(
          requestThreadStart(harness.deps, {
            thread,
            environment: {
              id: environment.id,
              hostId: environment.hostId,
              path: environment.path,
              workspaceProvisionType: environment.workspaceProvisionType,
            },
            requestId: provisionRequest.requestId,
            input: [{ type: "text", text: "Atomic start handoff" }],
            execution: {
              model: "gpt-5",
              reasoningLevel: "medium",
              permissionMode: "full",
              serviceTier: "default",
              source: "client/turn/requested",
            },
            permissionEscalation: "ask",
            projectId: project.id,
            providerId: thread.providerId,
          }),
        ).rejects.toThrow("abort start operation insert");
      } finally {
        harness.db.run(
          sql.raw("DROP TRIGGER IF EXISTS abort_start_operation_insert"),
        );
      }

      const provisionOperation = getThreadOperation(harness.db, {
        threadId: thread.id,
        kind: "provision",
      });
      expect(provisionOperation?.state).toBe("requested");

      const startOperation = getThreadOperation(harness.db, {
        threadId: thread.id,
        kind: "start",
      });
      expect(startOperation).toBeNull();

      const completedProvisioningEvents = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "system/thread-provisioning"),
          ),
        )
        .all()
        .filter((event) => {
          const data = systemThreadProvisioningEventDataSchema.parse(
            JSON.parse(event.data),
          );
          return data.status === "completed";
        });
      expect(completedProvisioningEvents).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("replays settled thread.start side effects", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-settled-thread-start-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/settled-thread-start-retry",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "created",
      });

      await requestThreadStart(harness.deps, {
        thread,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        requestId: "creq_23456789ab",
        input: [{ type: "text", text: "Start retry guard thread" }],
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        permissionEscalation: "ask",
        projectId: project.id,
        providerId: thread.providerId,
      });

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      const result = { providerThreadId: "provider-thread-settled-retry" };
      reportCommandResult(harness.db, harness.hub, {
        commandId: queuedStart.row.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify(result),
      });

      const provisioningEventsBeforeRetry = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all()
        .filter((event) => event.type === "system/thread-provisioning");
      const errorEventsBeforeRetry = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all()
        .filter((event) => event.type === "system/error");
      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedStart,
        result,
      );
      expect(retryResponse.status).toBe(200);

      const provisioningEventsAfterRetry = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all()
        .filter((event) => event.type === "system/thread-provisioning");
      const errorEventsAfterRetry = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all()
        .filter((event) => event.type === "system/error");
      expect(provisioningEventsAfterRetry).toHaveLength(
        provisioningEventsBeforeRetry.length,
      );
      expect(errorEventsAfterRetry).toHaveLength(errorEventsBeforeRetry.length);
      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "start",
        }),
      ).toMatchObject({
        commandId: queuedStart.row.id,
        failureReason: null,
        state: "completed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("replays settled environment.destroy side effects when a success retry arrives", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-settled-destroy-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/settled-destroy-retry",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/settled-destroy-retry",
        projectId: project.id,
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
        mode: "force",
      });
      const command = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      });
      const queuedDestroy = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );
      reportCommandResult(harness.db, harness.hub, {
        commandId: command.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({}),
      });

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedDestroy,
        {},
      );
      expect(retryResponse.status).toBe(200);

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: null,
        status: "destroyed",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        commandId: command.id,
        failureReason: null,
        state: "completed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("completes environment.destroy replay when the environment row is already destroyed", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-settled-destroy-already-destroyed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/settled-destroy-already-destroyed",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        managed: true,
        path: "/tmp/settled-destroy-already-destroyed",
        projectId: project.id,
        status: "destroying",
        workspaceProvisionType: "managed-worktree",
      });
      requestEnvironmentCleanup(harness.deps, {
        environmentId: environment.id,
        mode: "force",
      });
      const command = queueEnvironmentDestroyLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.destroy",
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      });
      const queuedDestroy = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );
      reportCommandResult(harness.db, harness.hub, {
        commandId: command.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({}),
      });
      setEnvironmentRecordDestroyed(harness.db, harness.hub, environment.id);

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedDestroy,
        {},
      );
      expect(retryResponse.status).toBe(200);

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupRequestedAt: null,
        status: "destroyed",
      });
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "destroy",
        }),
      ).toMatchObject({
        commandId: command.id,
        failureReason: null,
        state: "completed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("replays settled thread.stop side effects when a success retry arrives", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-settled-stop-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/settled-stop-retry",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/settled-stop-retry",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      requestThreadStop(harness.deps, {
        environmentId: environment.id,
        hostId: host.id,
        stopRequestedAt: null,
        threadId: thread.id,
      });
      const queuedStop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      reportCommandResult(harness.db, harness.hub, {
        commandId: queuedStop.row.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({}),
      });

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedStop,
        {},
      );
      expect(retryResponse.status).toBe(200);

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "stop",
        }),
      ).toMatchObject({
        commandId: queuedStop.row.id,
        failureReason: null,
        state: "completed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps the stored error cached when a settled command retry reports success", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-settled-stop-conflict",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/settled-stop-conflict",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/settled-stop-conflict",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      requestThreadStop(harness.deps, {
        environmentId: environment.id,
        hostId: host.id,
        stopRequestedAt: null,
        threadId: thread.id,
      });
      const queuedStop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );

      reportCommandResult(harness.db, harness.hub, {
        commandId: queuedStop.row.id,
        state: "error",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({
          errorCode: "stop_failed",
          errorMessage: "Stored stop failure",
        }),
      });

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedStop,
        {},
      );
      expect(retryResponse.status).toBe(200);

      await expect(
        harness.hub.waitForCommandResult(queuedStop.row.id, 1_000),
      ).resolves.toEqual({
        commandId: queuedStop.row.id,
        errorCode: "stop_failed",
        errorMessage: "Stored stop failure",
        ok: false,
        type: "thread.stop",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps the stored success cached when a settled command retry reports error", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-settled-stop-conflict-inverse",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/settled-stop-conflict-inverse",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/settled-stop-conflict-inverse",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      requestThreadStop(harness.deps, {
        environmentId: environment.id,
        hostId: host.id,
        stopRequestedAt: null,
        threadId: thread.id,
      });
      const queuedStop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );

      reportCommandResult(harness.db, harness.hub, {
        commandId: queuedStop.row.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({}),
      });

      const retryResponse = await reportQueuedCommandError(
        harness,
        queuedStop,
        {
          errorCode: "stop_failed",
          errorMessage: "Retry stop failure",
        },
      );
      expect(retryResponse.status).toBe(200);

      await expect(
        harness.hub.waitForCommandResult(queuedStop.row.id, 1_000),
      ).resolves.toEqual({
        commandId: queuedStop.row.id,
        ok: true,
        result: {},
        type: "thread.stop",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("replays settled interactive.resolve side effects when a success retry arrives", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-settled-interaction-retry",
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
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-settled-interaction-retry",
            providerId: "codex",
            providerThreadId: "provider-thread-settled-interaction-retry",
            providerRequestId: "request-settled-interaction-retry",
            payload: createCommandApprovalPayload({
              itemId: "item-settled-interaction-retry",
              reason: "Approve command",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId: registered.interaction.id,
        resolution: createAllowOnceResolution(),
      });
      const queuedResolve = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "interactive.resolve" &&
          command.interactionId === registered.interaction.id,
      );
      reportCommandResult(harness.db, harness.hub, {
        commandId: queuedResolve.row.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({}),
      });

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedResolve,
        {},
      );
      expect(retryResponse.status).toBe(200);

      expect(
        harness.deps.pendingInteractions.getThreadInteraction({
          threadId: thread.id,
          interactionId: registered.interaction.id,
        }),
      ).toMatchObject({
        status: "resolved",
        statusReason: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("replays settled runtime material side effects when a success retry arrives", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-settled-runtime-retry",
        type: "ephemeral",
      });
      upsertHostOperationRecord(harness.db, {
        hostId: host.id,
        kind: "sync_runtime_material",
        payload: JSON.stringify({
          appliedVersion: null,
          desiredVersion: "runtime-settled-retry",
        }),
      });
      const command = queueCommand(harness.db, harness.hub, {
        hostId: host.id,
        sessionId: session.id,
        type: "host.sync_runtime_material",
        payload: JSON.stringify({
          type: "host.sync_runtime_material",
          version: "runtime-settled-retry",
        }),
      });
      markHostOperationRecordQueued(harness.db, {
        hostId: host.id,
        kind: "sync_runtime_material",
        commandId: command.id,
      });
      const queuedSync = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );
      reportCommandResult(harness.db, harness.hub, {
        commandId: command.id,
        state: "success",
        completedAt: Date.now(),
        resultPayload: JSON.stringify({
          appliedVersion: "runtime-settled-retry",
        }),
      });

      const retryResponse = await reportQueuedCommandSuccess(
        harness,
        queuedSync,
        {
          appliedVersion: "runtime-settled-retry",
        },
      );
      expect(retryResponse.status).toBe(200);

      expect(
        getHostOperation(harness.db, {
          hostId: host.id,
          kind: "sync_runtime_material",
        }),
      ).toMatchObject({
        commandId: command.id,
        failureReason: null,
        state: "completed",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("ignores stale thread.start successes after the active start operation is repointed", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-stale-thread-start-result",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stale-thread-start",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "created",
      });

      await requestThreadStart(harness.deps, {
        thread,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        requestId: "creq_23456789ab",
        input: [{ type: "text", text: "Start stale op thread" }],
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        permissionEscalation: "ask",
        projectId: project.id,
        providerId: thread.providerId,
      });

      const originalStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      cancelCommand(harness.db, {
        commandId: originalStart.row.id,
      });

      await requestThreadStart(harness.deps, {
        thread,
        environment: {
          id: environment.id,
          hostId: environment.hostId,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        requestId: "creq_23456789ac",
        input: [{ type: "text", text: "Restart stale op thread" }],
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        permissionEscalation: "ask",
        projectId: project.id,
        providerId: thread.providerId,
      });

      const requeuedStart = await waitForQueuedCommandAfter(
        harness,
        originalStart.row.cursor,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );

      const response = await reportQueuedCommandSuccess(
        harness,
        originalStart,
        {
          providerThreadId: "provider-thread-stale",
        },
      );
      expect(response.status).toBe(200);

      const operation = getThreadOperation(harness.db, {
        threadId: thread.id,
        kind: "start",
      });
      expect(operation).toMatchObject({
        commandId: requeuedStart.row.id,
        state: "queued",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("ignores stale environment.provision successes after the active operation is repointed", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-stale-provision-result",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/stale-provision",
        status: "provisioning",
      });

      requestEnvironmentProvision(harness.deps, {
        environmentId: environment.id,
        kind: "provision",
        request: buildDirectEnvironmentProvisionRequest({
          command: buildEnvironmentProvisionCommand({
            environmentId: environment.id,
            hostId: host.id,
            initiator: null,
            workspaceProvisionType: "unmanaged",
            path: environment.path ?? "/tmp/stale-provision",
          }),
          provisioningId: "epv-stale-provision-original",
        }),
      });
      const originalCommandId = advanceEnvironmentProvisioning(harness.deps, {
        environmentId: environment.id,
      });
      expect(originalCommandId).not.toBeNull();

      const originalProvision = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      cancelCommand(harness.db, {
        commandId: originalProvision.row.id,
      });

      requestEnvironmentProvision(harness.deps, {
        environmentId: environment.id,
        kind: "provision",
        request: buildDirectEnvironmentProvisionRequest({
          command: buildEnvironmentProvisionCommand({
            environmentId: environment.id,
            hostId: host.id,
            initiator: null,
            workspaceProvisionType: "unmanaged",
            path: environment.path ?? "/tmp/stale-provision",
          }),
          provisioningId: "epv-stale-provision-retry",
        }),
      });
      const requeuedCommandId = advanceEnvironmentProvisioning(harness.deps, {
        environmentId: environment.id,
      });
      expect(requeuedCommandId).not.toBeNull();

      const requeuedProvision = await waitForQueuedCommandAfter(
        harness,
        originalProvision.row.cursor,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );

      const response = await reportQueuedCommandSuccess(
        harness,
        originalProvision,
        {
          path: environment.path ?? "/tmp/stale-provision",
          branchName: "bb/stale",
          defaultBranch: "main",
          isGitRepo: true,
          isWorktree: false,
          transcript: [],
        },
      );
      expect(response.status).toBe(200);

      const operation = getEnvironmentOperation(harness.db, {
        environmentId: environment.id,
        kind: "provision",
      });
      expect(operation).toMatchObject({
        commandId: requeuedProvision.row.id,
        state: "queued",
      });
      expect(getEnvironment(harness.db, environment.id)?.status).toBe(
        "provisioning",
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("durably fails direct environment.provision command errors", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-direct-provision-failure",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/direct-provision-failure",
        status: "provisioning",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "provisioning",
      });
      const command = queueEnvironmentProvisionLifecycleCommand(harness, {
        hostId: host.id,
        sessionId: session.id,
        environmentId: environment.id,
        command: {
          type: "environment.provision",
          environmentId: environment.id,
          initiator: {
            threadId: thread.id,
            provisioningId: "tpv-idempotency-3",
          },
          workspaceProvisionType: "unmanaged",
          path: "/tmp/direct-provision-failure",
        },
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ row }) => row.id === command.id,
      );

      const response = await reportQueuedCommandError(harness, queued, {
        errorCode: "workspace_setup_failed",
        errorMessage: "setup failed",
      });
      expect(response.status).toBe(200);

      expect(getEnvironment(harness.db, environment.id)?.status).toBe("error");
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
      expect(
        getEnvironmentOperation(harness.db, {
          environmentId: environment.id,
          kind: "provision",
        }),
      ).toMatchObject({
        commandId: command.id,
        failureReason: "setup failed",
        state: "failed",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
