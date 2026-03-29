import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectHostName, loadHostIdentity, readOrCreateHostId } from "./identity.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("identity", () => {
  it("creates a host ID once and reuses it on subsequent runs", async () => {
    const dataDir = await makeTempDir("bb-host-daemon-identity-");

    const first = await readOrCreateHostId({
      dataDir,
      createId: () => "host-first",
    });
    const second = await readOrCreateHostId({
      dataDir,
      createId: () => "host-second",
    });

    expect(first).toBe("host-first");
    expect(second).toBe("host-first");
    await expect(
      fs.readFile(path.join(dataDir, "host-id"), "utf8"),
    ).resolves.toContain("host-first");
  });

  it("detects a non-empty host name", async () => {
    await expect(detectHostName()).resolves.toSatisfy(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  });

  it("uses BB_HOST_ID when provided instead of creating a file-backed ID", async () => {
    const dataDir = await makeTempDir("bb-host-daemon-identity-env-");
    vi.stubEnv("BB_HOST_ID", "host-provided");

    const identity = await loadHostIdentity({
      dataDir,
      fallbackHostName: () => "sandbox-host",
    });

    expect(identity.hostId).toBe("host-provided");
    expect(identity.hostName.trim().length).toBeGreaterThan(0);
    await expect(fs.access(path.join(dataDir, "host-id"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
