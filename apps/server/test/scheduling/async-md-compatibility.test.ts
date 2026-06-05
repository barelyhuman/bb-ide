import path from "node:path";
import { eq } from "drizzle-orm";
import {
  getThreadDynamicContextFileState,
  hostDaemonCommands,
  listEvents,
} from "@bb/db";
import { turnRequestEventDataSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
  queueAsyncMdMigrationReminderIfPresent,
} from "../../src/services/scheduling/async-md-compatibility.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface RespondToAsyncMdMetadataArgs {
  asyncPath: string;
  harness: TestAppHarness;
  modifiedAtMs: number;
  sizeBytes: number;
  threadStoragePath: string;
}

interface RespondToAsyncMdMetadataMissingArgs {
  asyncPath: string;
  harness: TestAppHarness;
  threadStoragePath: string;
}

async function respondToAsyncMdMetadata(
  args: RespondToAsyncMdMetadataArgs,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    args.harness,
    ({ command, row }) =>
      row.state === "pending" &&
      command.type === "host.file_metadata" &&
      command.path === args.asyncPath,
  );
  if (queued.command.type !== "host.file_metadata") {
    throw new Error(
      `Expected host.file_metadata, got ${queued.command.type}`,
    );
  }
  expect(queued.command.rootPath).toBe(args.threadStoragePath);
  const response = await reportQueuedCommandSuccess(args.harness, queued, {
    path: args.asyncPath,
    modifiedAtMs: args.modifiedAtMs,
    sizeBytes: args.sizeBytes,
  });
  expect(response.status).toBe(200);
}

async function respondToAsyncMdMetadataMissing(
  args: RespondToAsyncMdMetadataMissingArgs,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    args.harness,
    ({ command, row }) =>
      row.state === "pending" &&
      command.type === "host.file_metadata" &&
      command.path === args.asyncPath,
  );
  if (queued.command.type !== "host.file_metadata") {
    throw new Error(
      `Expected host.file_metadata, got ${queued.command.type}`,
    );
  }
  expect(queued.command.rootPath).toBe(args.threadStoragePath);
  const response = await reportQueuedCommandError(args.harness, queued, {
    errorCode: "ENOENT",
    errorMessage: "File not found",
  });
  expect(response.status).toBe(200);
}

async function respondToPreferencesMissing(
  harness: TestAppHarness,
  preferencesPath: string,
): Promise<void> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.state === "pending" &&
      command.type === "host.read_file" &&
      command.path === preferencesPath,
  );
  const response = await reportQueuedCommandError(harness, queued, {
    errorCode: "ENOENT",
    errorMessage: "File not found",
  });
  expect(response.status).toBe(200);
}

function countQueuedTurnSubmitCommands(harness: TestAppHarness): number {
  return harness.db
    .select()
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.type, "turn.submit"))
    .all().length;
}

function countQueuedAsyncMdMetadataCommands(
  harness: TestAppHarness,
): number {
  return harness.db
    .select()
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.type, "host.file_metadata"))
    .all().length;
}

describe("ASYNC.md compatibility", () => {
  it("queues one migration reminder for a manager with ASYNC.md", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-async-md-compat",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/async-md-compat-environment",
      });
      const manager = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        type: "manager",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: manager.id,
        environmentId: environment.id,
        providerThreadId: "provider-async-md-compat",
      });

      const threadStoragePath = path.join(
        `/tmp/bb-host-data/${host.id}`,
        "thread-storage",
        manager.id,
      );
      const asyncPath = path.join(threadStoragePath, "ASYNC.md");
      const preferencesPath = path.join(threadStoragePath, "PREFERENCES.md");

      const firstReminderPromise = queueAsyncMdMigrationReminderIfPresent(
        harness.deps,
        { threadId: manager.id },
      );
      await respondToAsyncMdMetadata({
        asyncPath,
        harness,
        modifiedAtMs: 1770000100000,
        sizeBytes: 456,
        threadStoragePath,
      });
      await respondToPreferencesMissing(harness, preferencesPath);
      await expect(firstReminderPromise).resolves.toBe(true);

      const turnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === manager.id,
      );
      if (turnSubmit.command.type !== "turn.submit") {
        throw new Error(
          `Expected turn.submit, got ${turnSubmit.command.type}`,
        );
      }
      expect(
        turnSubmit.command.input.some(
          (input) =>
            input.type === "text" &&
            input.text.includes("`ASYNC.md` is deprecated") &&
            input.text.includes("bb thread schedule create"),
        ),
      ).toBe(true);
      expect(
        getThreadDynamicContextFileState(harness.db, {
          fileKey: ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
          threadId: manager.id,
        }),
      ).toMatchObject({
        contentStatus: "present",
        threadId: manager.id,
      });

      const requestRows = listEvents(harness.db, { threadId: manager.id })
        .filter((event) => event.type === "client/turn/requested");
      const latestRequest = requestRows[requestRows.length - 1];
      if (!latestRequest) {
        throw new Error("Expected a client/turn/requested event");
      }
      const requestData = turnRequestEventDataSchema.parse(
        JSON.parse(latestRequest.data),
      );
      expect(requestData.initiator).toBe("system");
      expect(requestData.input[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("`ASYNC.md` is deprecated"),
      });

      const queuedBeforeRepeat = countQueuedTurnSubmitCommands(harness);
      const metadataCommandsBeforeRepeat =
        countQueuedAsyncMdMetadataCommands(harness);
      const repeatReminderPromise = queueAsyncMdMigrationReminderIfPresent(
        harness.deps,
        { threadId: manager.id },
      );
      await expect(repeatReminderPromise).resolves.toBe(false);
      expect(countQueuedAsyncMdMetadataCommands(harness)).toBe(
        metadataCommandsBeforeRepeat,
      );
      expect(countQueuedTurnSubmitCommands(harness)).toBe(queuedBeforeRepeat);
    });
  });

  it("records missing ASYNC.md and skips future host metadata probes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-async-md-missing",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/async-md-missing-environment",
      });
      const manager = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
        type: "manager",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: manager.id,
        environmentId: environment.id,
        providerThreadId: "provider-async-md-missing",
      });

      const threadStoragePath = path.join(
        `/tmp/bb-host-data/${host.id}`,
        "thread-storage",
        manager.id,
      );
      const asyncPath = path.join(threadStoragePath, "ASYNC.md");

      const firstReminderPromise = queueAsyncMdMigrationReminderIfPresent(
        harness.deps,
        { threadId: manager.id },
      );
      await respondToAsyncMdMetadataMissing({
        asyncPath,
        harness,
        threadStoragePath,
      });
      await expect(firstReminderPromise).resolves.toBe(false);

      expect(
        getThreadDynamicContextFileState(harness.db, {
          fileKey: ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
          threadId: manager.id,
        }),
      ).toMatchObject({
        contentStatus: "missing",
        threadId: manager.id,
      });

      const queuedBeforeRepeat = countQueuedTurnSubmitCommands(harness);
      const metadataCommandsBeforeRepeat =
        countQueuedAsyncMdMetadataCommands(harness);
      const repeatReminderPromise = queueAsyncMdMigrationReminderIfPresent(
        harness.deps,
        { threadId: manager.id },
      );
      await expect(repeatReminderPromise).resolves.toBe(false);
      expect(countQueuedAsyncMdMetadataCommands(harness)).toBe(
        metadataCommandsBeforeRepeat,
      );
      expect(countQueuedTurnSubmitCommands(harness)).toBe(queuedBeforeRepeat);
    });
  });
});
