import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureThreadStorageRoot,
  threadStorageRootPath,
} from "./thread-storage-root.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { force: true, recursive: true });
    }),
  );
});

describe("thread storage root", () => {
  it("creates the shared thread-storage directory under the host data dir", async () => {
    const dataDir = await makeTempDir("bb-thread-storage-root-");

    const rootPath = await ensureThreadStorageRoot(dataDir);
    const stats = await fs.stat(rootPath);

    expect(rootPath).toBe(threadStorageRootPath(dataDir));
    expect(stats.isDirectory()).toBe(true);
  });
});
