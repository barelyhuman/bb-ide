import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  isExpectedCommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  deleteHostStatusData,
  listHostStatusData,
  readHostStatusData,
  writeHostStatusData,
} from "./status-data.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES } from "./file-read.js";

const tempDirs: string[] = [];
const THREAD_ID = "thr_status_data";

interface TestThreadStorage {
  threadStoragePath: string;
  threadStorageRootPath: string;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function listCommand(threadId = THREAD_ID): CommandOf<"host.status_data.list"> {
  return {
    type: "host.status_data.list",
    threadId,
  };
}

function getCommand(
  threadId = THREAD_ID,
  key = "tasks",
): CommandOf<"host.status_data.get"> {
  return {
    type: "host.status_data.get",
    threadId,
    key,
  };
}

function commandOptions(threadStorageRootPath: string) {
  return { threadStorageRootPath };
}

async function makeThreadStorage(prefix: string): Promise<TestThreadStorage> {
  const threadStorageRootPath = await makeTempDir(prefix);
  return {
    threadStoragePath: path.join(threadStorageRootPath, THREAD_ID),
    threadStorageRootPath,
  };
}

async function captureReadStatusDataError(
  command: CommandOf<"host.status_data.get">,
  threadStorageRootPath: string,
): Promise<unknown> {
  try {
    await readHostStatusData(command, commandOptions(threadStorageRootPath));
  } catch (error) {
    return error;
  }

  throw new Error("Expected readHostStatusData to fail");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("host STATUS-data commands", () => {
  it("lists and reads valid top-level STATUS-data JSON files", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-list-");
    const statusDataRootPath = path.join(threadStoragePath, "STATUS-data");
    const tasksJson = '["one"]\n';
    const prefsJson = '{"compact":true}\n';
    await fs.mkdir(path.join(statusDataRootPath, "nested"), {
      recursive: true,
    });
    await fs.writeFile(path.join(statusDataRootPath, "tasks.json"), tasksJson);
    await fs.writeFile(path.join(statusDataRootPath, "prefs.json"), prefsJson);
    await fs.writeFile(path.join(statusDataRootPath, "bad.name.json"), "1\n");
    await fs.writeFile(
      path.join(statusDataRootPath, "nested", "ignored.json"),
      "true\n",
    );

    await expect(
      listHostStatusData(listCommand(), commandOptions(threadStorageRootPath)),
    ).resolves.toEqual({
      values: {
        tasks: ["one"],
        prefs: { compact: true },
      },
      versions: {
        tasks: sha256Text(tasksJson),
        prefs: sha256Text(prefsJson),
      },
      hash: sha256Text(
        `prefs\0${sha256Text(prefsJson)}\n` +
          `tasks\0${sha256Text(tasksJson)}\n`,
      ),
    });

    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).resolves.toEqual({
      key: "tasks",
      value: ["one"],
      version: sha256Text(tasksJson),
      sizeBytes: Buffer.byteLength(tasksJson),
      modifiedAtMs: expect.any(Number),
    });
  });

  it("writes canonical JSON and returns previous value metadata", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-write-");
    const previousValue = [{ id: "task-1", title: "Review" }];
    const nextValue = { compact: true, selected: null };
    const previousJson = `${JSON.stringify(previousValue, null, 2)}\n`;
    const nextJson = `${JSON.stringify(nextValue, null, 2)}\n`;

    await expect(
      writeHostStatusData(
        {
          type: "host.status_data.set",
          threadId: THREAD_ID,
          key: "tasks",
          value: previousValue,
        },
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toMatchObject({
      key: "tasks",
      value: previousValue,
      version: sha256Text(previousJson),
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    });

    await expect(
      writeHostStatusData(
        {
          type: "host.status_data.set",
          threadId: THREAD_ID,
          key: "tasks",
          value: nextValue,
        },
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toMatchObject({
      key: "tasks",
      value: nextValue,
      version: sha256Text(nextJson),
      previousValue,
      previousValuePresent: true,
      previousVersion: sha256Text(previousJson),
    });

    await expect(
      fs.readFile(
        path.join(threadStoragePath, "STATUS-data", "tasks.json"),
        "utf8",
      ),
    ).resolves.toBe(nextJson);
  });

  it("deletes values idempotently and preserves JSON null as a previous value", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-delete-");
    const nullJson = "null\n";
    await writeHostStatusData(
      {
        type: "host.status_data.set",
        threadId: THREAD_ID,
        key: "tasks",
        value: null,
      },
      commandOptions(threadStorageRootPath),
    );

    await expect(
      deleteHostStatusData(
        {
          type: "host.status_data.delete",
          threadId: THREAD_ID,
          key: "tasks",
        },
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toEqual({
      key: "tasks",
      deleted: true,
      previousValue: null,
      previousValuePresent: true,
      previousVersion: sha256Text(nullJson),
    });
    await expect(
      fs.stat(path.join(threadStoragePath, "STATUS-data", "tasks.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      deleteHostStatusData(
        {
          type: "host.status_data.delete",
          threadId: THREAD_ID,
          key: "tasks",
        },
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toEqual({
      key: "tasks",
      deleted: false,
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    });
  });

  it("handles missing roots without warning-class errors for expected misses", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-host-status-data-missing-",
    );
    const threadId = "missing-thread-storage";

    await expect(
      listHostStatusData(
        listCommand(threadId),
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toEqual({
      values: {},
      versions: {},
      hash: sha256Text(""),
    });
    const thrown = await captureReadStatusDataError(
      getCommand(threadId),
      threadStorageRootPath,
    );
    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: "Path does not exist: tasks.json",
      name: "ExpectedCommandDispatchError",
    });
    expect(isExpectedCommandDispatchError(thrown)).toBe(true);
    await expect(
      deleteHostStatusData(
        {
          type: "host.status_data.delete",
          threadId,
          key: "tasks",
        },
        commandOptions(threadStorageRootPath),
      ),
    ).resolves.toEqual({
      key: "tasks",
      deleted: false,
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    });
  });

  it("rejects malformed JSON and symlink STATUS-data files", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-invalid-");
    const statusDataRootPath = path.join(threadStoragePath, "STATUS-data");
    await fs.mkdir(statusDataRootPath, { recursive: true });
    await fs.writeFile(path.join(statusDataRootPath, "tasks.json"), "{nope");

    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "invalid_json",
      message: "STATUS-data/tasks.json does not contain valid JSON",
    });
    await expect(
      listHostStatusData(listCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "invalid_json",
    });

    await fs.rm(path.join(statusDataRootPath, "tasks.json"));
    await fs.writeFile(path.join(threadStoragePath, "outside.json"), "[]\n");
    await fs.symlink(
      path.join(threadStoragePath, "outside.json"),
      path.join(statusDataRootPath, "tasks.json"),
    );
    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toBeInstanceOf(CommandDispatchError);
    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("rejects oversized STATUS-data files before reading contents", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-large-");
    const statusDataRootPath = path.join(threadStoragePath, "STATUS-data");
    const statusDataPath = path.join(statusDataRootPath, "tasks.json");
    await fs.mkdir(statusDataRootPath, { recursive: true });
    await fs.writeFile(statusDataPath, "[]\n");
    await fs.truncate(statusDataPath, NON_IMAGE_FILE_SIZE_LIMIT_BYTES + 1);

    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "file_too_large",
      message: expect.stringContaining("25 MB limit"),
    });
    await expect(
      listHostStatusData(listCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "file_too_large",
      message: expect.stringContaining("25 MB limit"),
    });
  });

  it("rejects symlink STATUS-data directories without touching their targets", async () => {
    const { threadStoragePath, threadStorageRootPath } =
      await makeThreadStorage("bb-host-status-data-symlink-dir-");
    const targetRootPath = await makeTempDir(
      "bb-host-status-data-symlink-dir-target-",
    );
    const targetContent = '["target"]\n';
    await fs.mkdir(threadStoragePath, { recursive: true });
    await fs.writeFile(path.join(targetRootPath, "tasks.json"), targetContent);
    await fs.symlink(
      targetRootPath,
      path.join(threadStoragePath, "STATUS-data"),
    );

    await expect(
      listHostStatusData(listCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      readHostStatusData(getCommand(), commandOptions(threadStorageRootPath)),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      writeHostStatusData(
        {
          type: "host.status_data.set",
          threadId: THREAD_ID,
          key: "tasks",
          value: ["changed"],
        },
        commandOptions(threadStorageRootPath),
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      deleteHostStatusData(
        {
          type: "host.status_data.delete",
          threadId: THREAD_ID,
          key: "tasks",
        },
        commandOptions(threadStorageRootPath),
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      fs.readFile(path.join(targetRootPath, "tasks.json"), "utf8"),
    ).resolves.toBe(targetContent);
  });

  it("rejects non-absolute roots", async () => {
    await expect(
      listHostStatusData(listCommand(), commandOptions("relative")),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("rejects thread IDs that escape the thread storage root", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-host-status-data-escape-",
    );

    await expect(
      listHostStatusData(
        listCommand("../outside"),
        commandOptions(threadStorageRootPath),
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
  });
});
