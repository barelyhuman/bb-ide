import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listThreadAppDataFromRoot } from "./app-data-files.js";

describe("app data files", () => {
  it("treats a missing thread storage root as an empty snapshot", async () => {
    const missingRoot = path.join(
      os.tmpdir(),
      `bb-missing-thread-storage-${randomUUID()}`,
    );

    await expect(
      listThreadAppDataFromRoot({
        rootPath: missingRoot,
      }),
    ).resolves.toEqual({ appIds: [], entries: [] });
  });
});
