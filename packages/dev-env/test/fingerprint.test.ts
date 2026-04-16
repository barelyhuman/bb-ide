import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeServiceFingerprint } from "../src/fingerprint.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("computeServiceFingerprint", () => {
  it("parses real turbo dry-run JSON output", async () => {
    await expect(
      computeServiceFingerprint({
        repoRoot,
        serviceName: "server",
      }),
    ).resolves.toMatch(/^[a-f0-9]{64}$/);
  });
});
