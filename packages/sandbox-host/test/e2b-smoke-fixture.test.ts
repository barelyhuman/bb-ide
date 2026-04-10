import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadQaAuthFixture } from "../../../scripts/qa/e2b-smoke/fixture.ts";

const FIXTURE_PATH_ENV_VAR = "BB_CLOUD_AUTH_FIXTURE_PATH";

describe("e2b smoke auth fixture", () => {
  const originalFixturePath = process.env[FIXTURE_PATH_ENV_VAR];

  afterEach(() => {
    if (originalFixturePath === undefined) {
      delete process.env[FIXTURE_PATH_ENV_VAR];
      return;
    }

    process.env[FIXTURE_PATH_ENV_VAR] = originalFixturePath;
  });

  it("persists enriched fixture updates back to disk", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bb-e2b-fixture-test-"));
    const fixturePath = join(tempDir, "credentials.json");
    const expiredFixture = {
      claude: {
        access: "expired-access-token",
        expires: 1,
        refresh: "expired-refresh-token",
      },
      createdAt: "2026-04-10T00:00:00.000Z",
    };

    try {
      await writeFile(
        fixturePath,
        `${JSON.stringify(expiredFixture, null, 2)}\n`,
        "utf8",
      );
      process.env[FIXTURE_PATH_ENV_VAR] = fixturePath;

      const loadedFixture = await loadQaAuthFixture();

      expect(loadedFixture.fixture).toEqual({
        createdAt: "2026-04-10T00:00:00.000Z",
      });
      expect(loadedFixture.notices).toContain(
        "Claude fixture is expired; Claude-specific smoke coverage will be skipped until it is refreshed.",
      );
      await expect(readFile(fixturePath, "utf8")).resolves.toBe(
        `${JSON.stringify({ createdAt: "2026-04-10T00:00:00.000Z" }, null, 2)}\n`,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
