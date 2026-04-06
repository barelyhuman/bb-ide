import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

type WatchPathModule = typeof import("../src/watch-path.js");
type WatchPathChanges = WatchPathModule["watchPathChanges"];
type ParcelWatcherModule = typeof import("@parcel/watcher");
type ParcelWatcherDefault = ParcelWatcherModule["default"];
type ParcelWatcherSubscribe = ParcelWatcherDefault["subscribe"];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];
type ParcelWatcherSubscribeArgs = Parameters<ParcelWatcherSubscribe>;
type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];
type ParcelWatcherSubscribeResult = Awaited<ReturnType<ParcelWatcherSubscribe>>;

interface MockWatchPathImport {
  callbacks: ParcelWatcherCallback[];
  rootPaths: string[];
  watchPathChanges: WatchPathChanges;
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function waitFor<T>(
  getValue: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = getValue();
    if (predicate(value)) {
      return value;
    }
    await sleep(20);
  }
  throw new Error("Timed out waiting for watcher state");
}

async function importWatchPathWithMockedWatcher(): Promise<MockWatchPathImport> {
  const callbacks: ParcelWatcherCallback[] = [];
  const rootPaths: string[] = [];

  vi.resetModules();
  vi.doMock("@parcel/watcher", async () => {
    const actualWatcher =
      await vi.importActual<ParcelWatcherModule>("@parcel/watcher");
    const subscribe = async (
      ...args: ParcelWatcherSubscribeArgs
    ): Promise<ParcelWatcherSubscribeResult> => {
      rootPaths.push(args[0]);
      callbacks.push(args[1]);
      return {
        unsubscribe: async () => undefined,
      };
    };
    return {
      ...actualWatcher,
      default: {
        ...actualWatcher.default,
        subscribe,
      },
      subscribe,
    };
  });

  const watchPathModule = await import("../src/watch-path.js");
  return {
    callbacks,
    rootPaths,
    watchPathChanges: watchPathModule.watchPathChanges,
  };
}

function createEventBatch(paths: string[]): ParcelWatcherEventBatch {
  return paths.map((eventPath) => ({
    path: eventPath,
    type: "update",
  }));
}

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("@parcel/watcher");
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { force: true, recursive: true });
    }),
  );
});

describe("watchPathChanges", () => {
  it("watches the target path and reports changed paths within that subtree", async () => {
    const dataDir = await makeTempDir("bb-watch-path-");
    const threadStorageRoot = path.join(dataDir, "thread-storage");
    await fs.mkdir(threadStorageRoot, { recursive: true });
    const onChange = vi.fn();
    const onWatchError = vi.fn();
    const { callbacks, rootPaths, watchPathChanges } =
      await importWatchPathWithMockedWatcher();

    const stopWatching = watchPathChanges(threadStorageRoot, {
      onChange,
      onWatchError,
    });

    const [callback] = await waitFor(
      () => callbacks,
      (currentCallbacks) => currentCallbacks.length === 1,
    );

    expect(rootPaths).toEqual([threadStorageRoot]);

    callback(
      null,
      createEventBatch([
        path.join(threadStorageRoot, "thread-2", "notes.md"),
        path.join(threadStorageRoot, "thread-1"),
        path.join(dataDir, "outside-root.txt"),
      ]),
    );

    await waitFor(
      () => onChange.mock.calls.length,
      (callCount) => callCount === 1,
    );

    expect(onChange).toHaveBeenCalledWith({
      changedPaths: [
        path.join(threadStorageRoot, "thread-1"),
        path.join(threadStorageRoot, "thread-2", "notes.md"),
      ],
    });
    expect(onWatchError).not.toHaveBeenCalled();

    stopWatching();
  });

  it("coalesces repeated batches before flushing", async () => {
    const dataDir = await makeTempDir("bb-watch-path-");
    const threadStorageRoot = path.join(dataDir, "thread-storage");
    await fs.mkdir(threadStorageRoot, { recursive: true });
    const onChange = vi.fn();
    const { callbacks, watchPathChanges } =
      await importWatchPathWithMockedWatcher();

    const stopWatching = watchPathChanges(threadStorageRoot, {
      onChange,
      onWatchError: () => undefined,
    });

    const [callback] = await waitFor(
      () => callbacks,
      (currentCallbacks) => currentCallbacks.length === 1,
    );

    callback(
      null,
      createEventBatch([path.join(threadStorageRoot, "thread-1", "notes.md")]),
    );
    callback(
      null,
      createEventBatch([
        path.join(threadStorageRoot, "thread-1", "notes.md"),
        path.join(threadStorageRoot, "thread-1", "todo.md"),
      ]),
    );

    await waitFor(
      () => onChange.mock.calls.length,
      (callCount) => callCount === 1,
    );

    expect(onChange).toHaveBeenCalledWith({
      changedPaths: [
        path.join(threadStorageRoot, "thread-1", "notes.md"),
        path.join(threadStorageRoot, "thread-1", "todo.md"),
      ],
    });

    stopWatching();
  });
});
