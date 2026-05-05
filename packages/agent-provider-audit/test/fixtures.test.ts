import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importDevReplayFixtures } from "../src/fixtures.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSentinelFile(fixtureRoot: string): string {
  const sentinelPath = join(fixtureRoot, "sentinel.txt");
  writeFileSync(sentinelPath, "do not delete");
  return sentinelPath;
}

describe("importDevReplayFixtures", () => {
  it.each(["", ".", "../x"])(
    "rejects invalid corpus id %j without deleting the fixture root",
    async (corpusId) => {
      const fixtureRoot = createTempDir("provider-audit-fixtures-");
      const replayRoot = createTempDir("provider-audit-replays-");
      const sentinelPath = writeSentinelFile(fixtureRoot);

      await expect(
        importDevReplayFixtures({
          fixtureRoot,
          replayRoot,
          corpusId,
          captureIds: [],
        }),
      ).rejects.toThrow("Invalid corpus id");
      expect(existsSync(sentinelPath)).toBe(true);
    },
  );
});
