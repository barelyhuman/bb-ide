import { getThread } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  type Environment,
  type ResolvedThreadExecutionOptions,
  type Thread,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  hasLiveThreadStartInFlight,
  requestThreadStart,
  requestThreadStopForCurrentState,
} from "../../src/services/threads/thread-lifecycle.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "workspace-write",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

interface StartLiveThreadStartRpcArgs {
  harness: TestAppHarness;
  requestIdValue: number;
}

interface LiveThreadStartRpcFixture {
  environment: Environment;
  startCommand: QueuedCommand;
  thread: Thread;
}

interface FailLiveStartRpcArgs {
  harness: TestAppHarness;
  startCommand: QueuedCommand;
}

async function startLiveThreadStartRpc(
  args: StartLiveThreadStartRpcArgs,
): Promise<LiveThreadStartRpcFixture> {
  const { host } = seedHostSession(args.harness.deps, {
    id: `host-live-start-handoff-${args.requestIdValue}`,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
    path: `/tmp/live-start-handoff-${args.requestIdValue}`,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/live-start-handoff-${args.requestIdValue}`,
    status: "ready",
  });
  const thread = seedThread(args.harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });

  await requestThreadStart(args.harness.deps, {
    thread,
    environment,
    input: [{ type: "text", text: "start live runtime" }],
    requestId: encodeClientTurnRequestIdNumber({
      value: args.requestIdValue,
    }),
    execution: START_EXECUTION,
    permissionEscalation: "ask",
    projectId: project.id,
    providerId: thread.providerId,
    syncGeneratedTitle: false,
  });

  const startCommand = await waitForQueuedCommand(
    args.harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === thread.id,
  );
  expect(hasLiveThreadStartInFlight(thread.id)).toBe(true);
  return { environment, startCommand, thread };
}

async function failLiveStartRpc(args: FailLiveStartRpcArgs): Promise<void> {
  await reportQueuedCommandError(args.harness, args.startCommand, {
    errorCode: "test_live_start_cleanup",
    errorMessage: "Test settled live thread start",
  });
}

describe("live thread start handoff", () => {
  it("sends live stop when manual stop races with an unsettled thread start", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await startLiveThreadStartRpc({
        harness,
        requestIdValue: 1,
      });
      try {
        requestThreadStopForCurrentState(
          harness.deps,
          fixture.thread,
          fixture.environment,
        );

        const stopCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" &&
            command.threadId === fixture.thread.id,
        );
        expect(stopCommand.command).toMatchObject({
          type: "thread.stop",
          environmentId: fixture.environment.id,
          threadId: fixture.thread.id,
        });
        expect(
          getThread(harness.db, fixture.thread.id)?.stopRequestedAt,
        ).toEqual(expect.any(Number));
        await reportQueuedCommandSuccess(harness, stopCommand, {});
      } finally {
        await failLiveStartRpc({
          harness,
          startCommand: fixture.startCommand,
        });
      }
    });
  });

  it("sends live stop when archive races with an unsettled thread start", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await startLiveThreadStartRpc({
        harness,
        requestIdValue: 2,
      });
      try {
        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/archive`,
          { method: "POST" },
        );

        expect(response.status).toBe(200);
        const stopCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" &&
            command.threadId === fixture.thread.id,
        );
        expect(stopCommand.command).toMatchObject({
          type: "thread.stop",
          environmentId: fixture.environment.id,
          threadId: fixture.thread.id,
        });
        expect(
          getThread(harness.db, fixture.thread.id)?.archivedAt,
        ).toEqual(expect.any(Number));
        expect(
          listQueuedThreadCommands(harness, "thread.archive", fixture.thread.id),
        ).toEqual([]);
        await reportQueuedCommandSuccess(harness, stopCommand, {});
      } finally {
        await failLiveStartRpc({
          harness,
          startCommand: fixture.startCommand,
        });
      }
    });
  });

  it("sends live stop when delete races with an unsettled thread start", async () => {
    await withTestHarness(async (harness) => {
      const fixture = await startLiveThreadStartRpc({
        harness,
        requestIdValue: 3,
      });
      try {
        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ managerChildThreadsConfirmed: false }),
          },
        );

        expect(response.status).toBe(200);
        const stopCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" &&
            command.threadId === fixture.thread.id,
        );
        expect(stopCommand.command).toMatchObject({
          type: "thread.stop",
          environmentId: fixture.environment.id,
          threadId: fixture.thread.id,
        });
        expect(getThread(harness.db, fixture.thread.id)).toBeNull();
        await reportQueuedCommandSuccess(harness, stopCommand, {});
      } finally {
        await failLiveStartRpc({
          harness,
          startCommand: fixture.startCommand,
        });
      }
    });
  });
});
