import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { waitForHostConnected } from "../helpers/assertions.js";
import { createIntegrationHarness } from "../helpers/harness.js";

describe("integration harness", () => {
  it("starts the server and daemon, then cleans up the temp repo", async () => {
    const harness = await createIntegrationHarness();

    try {
      const host = await waitForHostConnected(harness.api);
      expect(host.id).toBe(harness.hostId);

      await fs.access(harness.repoDir);
    } finally {
      const repoDir = harness.repoDir;
      await harness.cleanup();
      await expect(fs.access(repoDir)).rejects.toThrow();
    }
  });
});
