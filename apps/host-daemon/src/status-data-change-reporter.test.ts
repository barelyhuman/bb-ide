import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostDaemonStatusDataChangePayload } from "@bb/host-daemon-contract";
import type { JsonValue, StatusDataKey } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES } from "./command-handlers/file-read.js";
import { StatusDataChangeReporter } from "./status-data-change-reporter.js";

interface WriteStatusDataFileArgs {
  key: StatusDataKey;
  threadStoragePath: string;
  value: JsonValue;
}

interface WriteRawStatusDataFileArgs {
  content: string;
  key: StatusDataKey;
  threadStoragePath: string;
}

interface DeferredVoid {
  promise: Promise<void>;
  resolve(): void;
}

const tempDirs: string[] = [];

function createLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies HostDaemonLogger;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sha256(content: string): string {
  return createHash("sha256")
    .update(Buffer.from(content, "utf8"))
    .digest("hex");
}

function canonicalStatusDataJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createDeferredVoid(): DeferredVoid {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

async function writeRawStatusDataFile(
  args: WriteRawStatusDataFileArgs,
): Promise<string> {
  const rootPath = path.join(args.threadStoragePath, "STATUS-data");
  await fs.mkdir(rootPath, { recursive: true });
  await fs.writeFile(path.join(rootPath, `${args.key}.json`), args.content);
  return args.content;
}

async function writeStatusDataFile(
  args: WriteStatusDataFileArgs,
): Promise<string> {
  return writeRawStatusDataFile({
    key: args.key,
    threadStoragePath: args.threadStoragePath,
    content: canonicalStatusDataJson(args.value),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("StatusDataChangeReporter", () => {
  it("primes current files without posting and reports later updates with previous metadata", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-update-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });

    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_update", threadStoragePath }],
    });
    expect(posted).toEqual([]);

    const nextContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "new" },
    });
    await reporter.observe({
      threadId: "thr_update",
      threadStoragePath,
      key: "state",
    });

    expect(posted).toEqual([
      {
        threadId: "thr_update",
        key: "state",
        deleted: false,
        value: { status: "new" },
        version: sha256(nextContent),
        previousValue: { status: "old" },
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
    ]);
  });

  it("reports newly-created files without previous metadata", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-create-",
    );
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_create", threadStoragePath }],
    });

    const content = await writeStatusDataFile({
      threadStoragePath,
      key: "progress",
      value: 1,
    });
    await reporter.observe({
      threadId: "thr_create",
      threadStoragePath,
      key: "progress",
    });

    expect(posted).toEqual([
      {
        threadId: "thr_create",
        key: "progress",
        deleted: false,
        value: 1,
        version: sha256(content),
        previousValue: null,
        previousValuePresent: false,
        previousVersion: null,
      },
    ]);
  });

  it("reconciles files for a thread first observed after session open", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-late-track-",
    );
    const content = await writeStatusDataFile({
      threadStoragePath,
      key: "progress",
      value: { step: 1 },
    });
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });

    await reporter.reconcileThread({
      threadId: "thr_late_track",
      threadStoragePath,
    });
    reporter.trackThread({ threadId: "thr_late_track" });
    await reporter.reconcileThread({
      threadId: "thr_late_track",
      threadStoragePath,
    });

    expect(posted).toEqual([
      {
        threadId: "thr_late_track",
        key: "progress",
        deleted: false,
        value: { step: 1 },
        version: sha256(content),
        previousValue: null,
        previousValuePresent: false,
        previousVersion: null,
      },
    ]);
  });

  it("retries observed updates after a failed post", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-retry-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const logger = createLogger();
    const posted: HostDaemonStatusDataChangePayload[] = [];
    let attempts = 0;
    const reporter = new StatusDataChangeReporter({
      logger,
      postStatusDataChange: async (payload) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("offline");
        }
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_retry", threadStoragePath }],
    });

    const nextContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "new" },
    });
    await reporter.observe({
      threadId: "thr_retry",
      threadStoragePath,
      key: "state",
    });

    expect(posted).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "state",
        threadId: "thr_retry",
      }),
      "Failed to report observed STATUS-data change",
    );

    await reporter.observe({
      threadId: "thr_retry",
      threadStoragePath,
      key: "state",
    });

    expect(attempts).toBe(2);
    expect(posted).toEqual([
      {
        threadId: "thr_retry",
        key: "state",
        deleted: false,
        value: { status: "new" },
        version: sha256(nextContent),
        previousValue: { status: "old" },
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
    ]);
  });

  it("reports deleted files only when a previous cached value exists", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-delete-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "summary",
      value: null,
    });
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_delete", threadStoragePath }],
    });

    await fs.rm(path.join(threadStoragePath, "STATUS-data", "summary.json"));
    await reporter.observe({
      threadId: "thr_delete",
      threadStoragePath,
      key: "summary",
    });
    await reporter.observe({
      threadId: "thr_delete",
      threadStoragePath,
      key: "summary",
    });

    expect(posted).toEqual([
      {
        threadId: "thr_delete",
        key: "summary",
        deleted: true,
        value: null,
        version: null,
        previousValue: null,
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
    ]);
  });

  it("does not post when an observed file still has the cached version", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-same-",
    );
    await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "same" },
    });
    const postStatusDataChange = vi.fn(async () => undefined);
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_same", threadStoragePath }],
    });

    await reporter.observe({
      threadId: "thr_same",
      threadStoragePath,
      key: "state",
    });

    expect(postStatusDataChange).not.toHaveBeenCalled();
  });

  it("serializes concurrent observations for the same key and reports the final value", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-same-key-race-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const firstPostStarted = createDeferredVoid();
    const releaseFirstPost = createDeferredVoid();
    const posted: HostDaemonStatusDataChangePayload[] = [];
    let postCount = 0;
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        postCount += 1;
        posted.push(payload);
        if (postCount === 1) {
          firstPostStarted.resolve();
          await releaseFirstPost.promise;
        }
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_same_key_race", threadStoragePath }],
    });

    const intermediateContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "intermediate" },
    });
    const firstObserve = reporter.observe({
      threadId: "thr_same_key_race",
      threadStoragePath,
      key: "state",
    });
    await firstPostStarted.promise;
    const finalContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "final" },
    });
    const secondObserve = reporter.observe({
      threadId: "thr_same_key_race",
      threadStoragePath,
      key: "state",
    });
    releaseFirstPost.resolve();
    await Promise.all([firstObserve, secondObserve]);

    expect(posted).toEqual([
      {
        threadId: "thr_same_key_race",
        key: "state",
        deleted: false,
        value: { status: "intermediate" },
        version: sha256(intermediateContent),
        previousValue: { status: "old" },
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
      {
        threadId: "thr_same_key_race",
        key: "state",
        deleted: false,
        value: { status: "final" },
        version: sha256(finalContent),
        previousValue: { status: "intermediate" },
        previousValuePresent: true,
        previousVersion: sha256(intermediateContent),
      },
    ]);
  });

  it("suppresses observed changes already applied by daemon commands", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-command-",
    );
    await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const postStatusDataChange = vi.fn(async () => undefined);
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_command", threadStoragePath }],
    });

    const nextContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "new" },
    });
    reporter.recordCommandSet({
      threadId: "thr_command",
      key: "state",
      value: { status: "new" },
      version: sha256(nextContent),
    });
    await reporter.observe({
      threadId: "thr_command",
      threadStoragePath,
      key: "state",
    });

    await fs.rm(path.join(threadStoragePath, "STATUS-data", "state.json"));
    reporter.recordCommandDelete({
      threadId: "thr_command",
      key: "state",
    });
    await reporter.observe({
      threadId: "thr_command",
      threadStoragePath,
      key: "state",
    });

    expect(postStatusDataChange).not.toHaveBeenCalled();
  });

  it("logs command results for untracked threads without seeding the cache", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-untracked-command-",
    );
    const logger = createLogger();
    const postStatusDataChange = vi.fn(async () => undefined);
    const reporter = new StatusDataChangeReporter({
      logger,
      postStatusDataChange,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_tracked", threadStoragePath }],
    });

    reporter.recordCommandSet({
      threadId: "thr_untracked",
      key: "state",
      value: { status: "new" },
      version: "command-version",
    });
    reporter.recordCommandDelete({
      threadId: "thr_untracked",
      key: "state",
    });

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        key: "state",
        threadId: "thr_untracked",
      },
      "Ignoring STATUS-data command result for untracked thread",
    );
    expect(postStatusDataChange).not.toHaveBeenCalled();
  });

  it("reconciles missed file watcher events from a thread snapshot", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-reconcile-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const goneContent = await writeStatusDataFile({
      threadStoragePath,
      key: "gone",
      value: true,
    });
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_reconcile", threadStoragePath }],
    });

    const nextContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "new" },
    });
    const addedContent = await writeStatusDataFile({
      threadStoragePath,
      key: "added",
      value: 2,
    });
    await fs.rm(path.join(threadStoragePath, "STATUS-data", "gone.json"));
    await reporter.reconcileThread({
      threadId: "thr_reconcile",
      threadStoragePath,
    });

    expect(posted).toEqual([
      {
        threadId: "thr_reconcile",
        key: "added",
        deleted: false,
        value: 2,
        version: sha256(addedContent),
        previousValue: null,
        previousValuePresent: false,
        previousVersion: null,
      },
      {
        threadId: "thr_reconcile",
        key: "state",
        deleted: false,
        value: { status: "new" },
        version: sha256(nextContent),
        previousValue: { status: "old" },
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
      {
        threadId: "thr_reconcile",
        key: "gone",
        deleted: true,
        value: null,
        version: null,
        previousValue: true,
        previousValuePresent: true,
        previousVersion: sha256(goneContent),
      },
    ]);
  });

  it("reconciles previously tracked thread changes when tracked threads are replaced", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-reconnect-",
    );
    const previousContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const goneContent = await writeStatusDataFile({
      threadStoragePath,
      key: "gone",
      value: true,
    });
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_reconnect", threadStoragePath }],
    });

    const nextContent = await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "new" },
    });
    const addedContent = await writeStatusDataFile({
      threadStoragePath,
      key: "added",
      value: 2,
    });
    await fs.rm(path.join(threadStoragePath, "STATUS-data", "gone.json"));
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_reconnect", threadStoragePath }],
    });

    expect(posted).toEqual([
      {
        threadId: "thr_reconnect",
        key: "added",
        deleted: false,
        value: 2,
        version: sha256(addedContent),
        previousValue: null,
        previousValuePresent: false,
        previousVersion: null,
      },
      {
        threadId: "thr_reconnect",
        key: "state",
        deleted: false,
        value: { status: "new" },
        version: sha256(nextContent),
        previousValue: { status: "old" },
        previousValuePresent: true,
        previousVersion: sha256(previousContent),
      },
      {
        threadId: "thr_reconnect",
        key: "gone",
        deleted: true,
        value: null,
        version: null,
        previousValue: true,
        previousValuePresent: true,
        previousVersion: sha256(goneContent),
      },
    ]);
  });

  it("reconciles reconnect-created files for previously empty tracked threads", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-empty-reconnect-",
    );
    const posted: HostDaemonStatusDataChangePayload[] = [];
    const reporter = new StatusDataChangeReporter({
      logger: createLogger(),
      postStatusDataChange: async (payload) => {
        posted.push(payload);
      },
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_empty_reconnect", threadStoragePath }],
    });

    const content = await writeStatusDataFile({
      threadStoragePath,
      key: "progress",
      value: 1,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_empty_reconnect", threadStoragePath }],
    });

    expect(posted).toEqual([
      {
        threadId: "thr_empty_reconnect",
        key: "progress",
        deleted: false,
        value: 1,
        version: sha256(content),
        previousValue: null,
        previousValuePresent: false,
        previousVersion: null,
      },
    ]);
  });

  it("logs and skips unreadable observed STATUS-data files", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-invalid-",
    );
    await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const logger = createLogger();
    const postStatusDataChange = vi.fn(async () => undefined);
    const reporter = new StatusDataChangeReporter({
      logger,
      postStatusDataChange,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_invalid", threadStoragePath }],
    });

    await writeRawStatusDataFile({
      threadStoragePath,
      key: "state",
      content: "{",
    });
    await reporter.observe({
      threadId: "thr_invalid",
      threadStoragePath,
      key: "state",
    });

    expect(postStatusDataChange).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "state",
        threadId: "thr_invalid",
      }),
      "Ignoring unreadable observed STATUS-data file",
    );
  });

  it("logs and skips oversized observed STATUS-data files", async () => {
    const threadStoragePath = await makeTempDir(
      "bb-status-data-reporter-large-",
    );
    await writeStatusDataFile({
      threadStoragePath,
      key: "state",
      value: { status: "old" },
    });
    const logger = createLogger();
    const postStatusDataChange = vi.fn(async () => undefined);
    const reporter = new StatusDataChangeReporter({
      logger,
      postStatusDataChange,
    });
    await reporter.replaceTrackedThreads({
      targets: [{ threadId: "thr_large", threadStoragePath }],
    });

    const statusDataPath = path.join(
      threadStoragePath,
      "STATUS-data",
      "state.json",
    );
    await fs.truncate(statusDataPath, NON_IMAGE_FILE_SIZE_LIMIT_BYTES + 1);
    await reporter.observe({
      threadId: "thr_large",
      threadStoragePath,
      key: "state",
    });

    expect(postStatusDataChange).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "state",
        threadId: "thr_large",
      }),
      "Ignoring unreadable observed STATUS-data file",
    );
  });
});
