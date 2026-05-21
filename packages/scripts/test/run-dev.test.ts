import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  migrateLegacyDevData,
  resolveWorktreeDevInstanceConfig,
  toWorktreeDevProcessEnv,
} from "../src/lib/worktree-dev-instance.js";
import { createDevTurboCommand } from "../src/commands/run-dev.js";

interface ExpectedPortSet {
  appPort: number;
  devEnvPort: number;
  hostDaemonPort: number;
  serverPort: number;
}

const PORT_BUCKETS = 8_000;
const HASH_LENGTH = 12;
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

function repoRootHash(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex");
}

function expectedPorts(repoRoot: string): ExpectedPortSet {
  const offset =
    Number.parseInt(repoRootHash(repoRoot).slice(0, 8), 16) % PORT_BUCKETS;
  return {
    appPort: 11_000 + offset,
    devEnvPort: 43_000 + offset,
    hostDaemonPort: 27_000 + offset,
    serverPort: 19_000 + offset,
  };
}

describe("run-dev", () => {
  it("derives stable data and ports from a managed worktree checkout", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/.bb-dev/worktrees/env_q7e5i54kxt/bb";
    const hash = repoRootHash(repoRoot);
    const config = resolveWorktreeDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      `bb-dev-worktrees-env_q7e5i54kxt-bb-${hash.slice(0, HASH_LENGTH)}`,
    );
    expect(config.dataDir).toBe(
      path.join(homeDir, ".bb-dev", config.instanceId),
    );
    expect(config.ports).toEqual(expectedPorts(repoRoot));
    expect(config.serverUrl).toBe(
      `http://localhost:${config.ports.serverPort}`,
    );
    expect(new Set(Object.values(config.ports))).toHaveLength(4);
    expect(Object.values(config.ports)).not.toContain(5173);
    expect(Object.values(config.ports)).not.toContain(3334);
    expect(Object.values(config.ports)).not.toContain(3002);
    expect(Object.values(config.ports)).not.toContain(38886);
    expect(Object.values(config.ports)).not.toContain(38887);
  });

  it("uses the home-relative checkout path for non-managed worktree paths", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/work/bb-feature-copy";
    const hash = repoRootHash(repoRoot);

    const config = resolveWorktreeDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      `src-work-bb-feature-copy-${hash.slice(0, HASH_LENGTH)}`,
    );
  });

  it("overrides instance selectors while preserving unrelated environment", () => {
    const config = resolveWorktreeDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/.bb-dev/worktrees/env_q7e5i54kxt/bb",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      BB_DATA_DIR: "/Users/tester/.bb-dev",
      BB_SERVER_PORT: "3334",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    };

    const env = toWorktreeDevProcessEnv({ baseEnv, config });

    expect(env.OPENAI_API_KEY).toBe("test-key");
    expect(env.NODE_ENV).toBe("development");
    expect(env.BB_DATA_DIR).toBe(config.dataDir);
    expect(env.BB_SERVER_PORT).toBe(String(config.ports.serverPort));
    expect(env.BB_SERVER_URL).toBe(config.serverUrl);
    expect(env.BB_HOST_DAEMON_PORT).toBe(String(config.ports.hostDaemonPort));
    expect(env.BB_DEV_APP_PORT).toBe(String(config.ports.appPort));
    expect(env.BB_DEV_ENV_PORT).toBe(String(config.ports.devEnvPort));
  });

  it("runs the same persistent dev tasks as pnpm dev", () => {
    expect(createDevTurboCommand()).toEqual({
      args: [
        "exec",
        "turbo",
        "run",
        "dev",
        "--filter=@bb/app",
        "--filter=@bb/server",
        "--filter=@bb/host-daemon",
        "--filter=@bb/dev-env",
        "--ui",
        "tui",
        "--concurrency",
        "20",
        "--no-update-notifier",
      ],
      command: "pnpm",
    });
  });

  it("migrates legacy flat dev data into the checkout instance", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(path.join(legacyDataDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(legacyDataDir, "attachments", "proj_test"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "worktrees", "env_old", "bb"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "bb.db.backup-20260515-160305"),
      "backup",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "attachments", "proj_test", "screenshot.png"),
      "image",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "event-spool.before.sqlite"),
      "spool",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      "not-a-pid",
      "utf8",
    );
    const output = { write: vi.fn() };

    const result = await migrateLegacyDevData({ config, output });

    expect(result).toEqual({
      migratedEntries: [
        "attachments",
        "auth-secret",
        "bb.db",
        "bb.db.backup-20260515-160305",
        "event-spool.before.sqlite",
        "logs",
      ],
    });
    await expect(
      fs.readFile(path.join(config.dataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    await expect(
      fs.readFile(path.join(config.dataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(
        path.join(config.dataDir, "attachments", "proj_test", "screenshot.png"),
        "utf8",
      ),
    ).resolves.toBe("image");
    await expect(
      fs.access(path.join(legacyDataDir, "worktrees", "env_old", "bb")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "dev-supervisors", "server.pid")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "daemon.lock")),
    ).resolves.toBeUndefined();
    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining(
        `Migrated legacy dev data into ${config.dataDir}`,
      ),
    );
  });

  it("migrates event spool SQLite WAL sidecars", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "event-spool.sqlite"),
      "spool",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "event-spool.sqlite-wal"),
      "wal",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "event-spool.sqlite-shm"),
      "shm",
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [
        "event-spool.sqlite",
        "event-spool.sqlite-shm",
        "event-spool.sqlite-wal",
      ],
    });
    await expect(
      fs.readFile(path.join(config.dataDir, "event-spool.sqlite"), "utf8"),
    ).resolves.toBe("spool");
    await expect(
      fs.readFile(path.join(config.dataDir, "event-spool.sqlite-wal"), "utf8"),
    ).resolves.toBe("wal");
    await expect(
      fs.readFile(path.join(config.dataDir, "event-spool.sqlite-shm"), "utf8"),
    ).resolves.toBe("shm");
    expect(
      await pathExists(path.join(legacyDataDir, "event-spool.sqlite")),
    ).toBe(false);
  });

  it("skips migration when the target instance already has data", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "legacy", "utf8");
    await fs.writeFile(path.join(config.dataDir, "bb.db"), "target", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "target-exists",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("legacy");
    await expect(
      fs.readFile(path.join(config.dataDir, "bb.db"), "utf8"),
    ).resolves.toBe("target");
  });

  it("skips migration when legacy dev data is absent", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("skips migration when legacy dev data has no migratable entries", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-empty",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("rolls back already moved entries when migration rename fails", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    const renameCalls: string[] = [];
    const renameWithInjectedFailure = vi.fn(
      async (sourcePath: string, targetPath: string): Promise<void> => {
        renameCalls.push(path.basename(sourcePath));
        if (renameCalls.length === 1) {
          await fs.rename(sourcePath, targetPath);
          return;
        }

        throw new Error("injected rename failure");
      },
    );

    await expect(
      migrateLegacyDevData({
        config,
        dependencies: {
          rename: renameWithInjectedFailure,
        },
      }),
    ).rejects.toThrow("injected rename failure");

    expect(renameCalls).toEqual(["auth-secret", "bb.db"]);
    await expect(
      fs.readFile(path.join(legacyDataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("does not migrate legacy data while a legacy dev supervisor is running", async () => {
    const homeDir = await makeTempDir("bb-worktree-dev-home-");
    const legacyDataDir = path.join(homeDir, ".bb-dev");
    const config = resolveWorktreeDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "bb"),
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "bb.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      `${process.pid}\n`,
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-dev-process-running",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "bb.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });
});
