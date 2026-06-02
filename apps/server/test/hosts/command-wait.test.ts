import { asc, eq } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import { hostDaemonCommands } from "@bb/db";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { queueCommandAndWait } from "../../src/services/hosts/command-wait.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";
import { seedHostSession } from "../helpers/seed.js";

type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;
type TestAppHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface BuildThreadStopCommandArgs {
  threadId: string;
}

interface CountQueuedHostCommandsArgs {
  harness: TestAppHarness;
  hostId: string;
}

interface ListQueuedHostCommandIdsArgs {
  harness: TestAppHarness;
  hostId: string;
}

interface GetCommandIdAtIndexArgs {
  commandIds: readonly string[];
  index: number;
}

interface RecordThreadStopFailureArgs {
  commandId: string;
  errorCode: string;
  errorMessage: string;
  harness: TestAppHarness;
}

interface RecordThreadStopSuccessArgs {
  commandId: string;
  harness: TestAppHarness;
}

interface WaitForQueuedHostCommandCountArgs {
  count: number;
  harness: TestAppHarness;
  hostId: string;
}

function buildThreadStopCommand(
  args: BuildThreadStopCommandArgs,
): ThreadStopCommand {
  return {
    type: "thread.stop",
    environmentId: "env-command-wait",
    threadId: args.threadId,
  };
}

function countQueuedHostCommands({
  harness,
  hostId,
}: CountQueuedHostCommandsArgs): number {
  return harness.db
    .select({ id: hostDaemonCommands.id })
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.hostId, hostId))
    .all().length;
}

function listQueuedHostCommandIds({
  harness,
  hostId,
}: ListQueuedHostCommandIdsArgs): string[] {
  return harness.db
    .select({
      cursor: hostDaemonCommands.cursor,
      id: hostDaemonCommands.id,
    })
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.hostId, hostId))
    .orderBy(asc(hostDaemonCommands.cursor))
    .all()
    .map((command) => command.id);
}

function getCommandIdAtIndex({
  commandIds,
  index,
}: GetCommandIdAtIndexArgs): string {
  const commandId = commandIds[index];
  if (!commandId) {
    throw new Error(`Expected queued command at index ${index}`);
  }
  return commandId;
}

function recordThreadStopFailure({
  commandId,
  errorCode,
  errorMessage,
  harness,
}: RecordThreadStopFailureArgs): void {
  harness.hub.recordCommandResult(commandId, {
    commandId,
    errorCode,
    errorMessage,
    ok: false,
    type: "thread.stop",
  });
}

function recordThreadStopSuccess({
  commandId,
  harness,
}: RecordThreadStopSuccessArgs): void {
  harness.hub.recordCommandResult(commandId, {
    commandId,
    ok: true,
    result: {},
    type: "thread.stop",
  });
}

async function waitForQueuedHostCommandCount({
  count,
  harness,
  hostId,
}: WaitForQueuedHostCommandCountArgs): Promise<void> {
  await vi.waitFor(() => {
    expect(countQueuedHostCommands({ harness, hostId })).toBe(count);
  });
}

describe("daemon command waits", () => {
  it("allows parallel command waits", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-command-wait-parallel",
      });

      const waitForResults = Promise.all([
        queueCommandAndWait(harness.deps, {
          command: buildThreadStopCommand({ threadId: "thread-1" }),
          hostId: host.id,
          timeoutMs: 5_000,
        }),
        queueCommandAndWait(harness.deps, {
          command: buildThreadStopCommand({ threadId: "thread-2" }),
          hostId: host.id,
          timeoutMs: 5_000,
        }),
        queueCommandAndWait(harness.deps, {
          command: buildThreadStopCommand({ threadId: "thread-3" }),
          hostId: host.id,
          timeoutMs: 5_000,
        }),
      ]);

      await waitForQueuedHostCommandCount({
        count: 3,
        harness,
        hostId: host.id,
      });

      const queuedCommands = harness.db
        .select({
          cursor: hostDaemonCommands.cursor,
          id: hostDaemonCommands.id,
        })
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.hostId, host.id))
        .orderBy(asc(hostDaemonCommands.cursor))
        .all();
      for (const command of queuedCommands) {
        recordThreadStopSuccess({ commandId: command.id, harness });
      }

      await expect(waitForResults).resolves.toEqual([{}, {}, {}]);
    });
  });

  it("logs slow command waits that complete successfully", async () => {
    const harness = await createTestAppHarness();
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const deps = {
      ...harness.deps,
      logger,
    };
    const now = { value: 0 };
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockImplementation(() => now.value);
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-command-wait-slow-success",
      });
      const waitForResult = queueCommandAndWait(deps, {
        command: buildThreadStopCommand({ threadId: "thread-slow-success" }),
        hostId: host.id,
        timeoutMs: 5_000,
      });

      await waitForQueuedHostCommandCount({
        count: 1,
        harness,
        hostId: host.id,
      });
      const commandId = getCommandIdAtIndex({
        commandIds: listQueuedHostCommandIds({ harness, hostId: host.id }),
        index: 0,
      });
      now.value = 1_001;
      recordThreadStopSuccess({ commandId, harness });

      await expect(waitForResult).resolves.toEqual({});
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId,
          commandType: "thread.stop",
          completed: true,
          durationMs: 1_001,
          hostId: host.id,
          outcome: "success",
          sessionId: session.id,
        }),
        "Slow host command wait",
      );
    } finally {
      performanceNow.mockRestore();
      await harness.cleanup();
    }
  });

  it("logs slow command waits with provider failure details", async () => {
    const harness = await createTestAppHarness();
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const deps = {
      ...harness.deps,
      logger,
    };
    const now = { value: 0 };
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockImplementation(() => now.value);
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-command-wait-slow-provider-failure",
      });
      const waitForResult = queueCommandAndWait(deps, {
        command: buildThreadStopCommand({
          threadId: "thread-slow-provider-failure",
        }),
        hostId: host.id,
        timeoutMs: 5_000,
      });

      await waitForQueuedHostCommandCount({
        count: 1,
        harness,
        hostId: host.id,
      });
      const commandId = getCommandIdAtIndex({
        commandIds: listQueuedHostCommandIds({ harness, hostId: host.id }),
        index: 0,
      });
      now.value = 1_001;
      recordThreadStopFailure({
        commandId,
        errorCode: "provider_unavailable",
        errorMessage: "Provider unavailable",
        harness,
      });

      await expect(waitForResult).rejects.toThrow("Provider unavailable");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId,
          commandType: "thread.stop",
          completed: false,
          durationMs: 1_001,
          errorCode: "provider_unavailable",
          hostId: host.id,
          outcome: "provider_error",
          sessionId: session.id,
          status: 502,
        }),
        "Slow host command wait",
      );
    } finally {
      performanceNow.mockRestore();
      await harness.cleanup();
    }
  });
});
