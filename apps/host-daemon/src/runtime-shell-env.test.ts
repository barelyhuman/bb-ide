import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRuntimeShellEnv } from "./runtime-shell-env.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directoryPath);
  return directoryPath;
}

interface FakeCliPackageOptions {
  binPath?: string;
  executable?: boolean;
  writeEntry?: boolean;
}

interface FakeCliPackage {
  cliEntryPath: string;
  cliPackageManifestPath: string;
}

async function createFakeCliPackage(
  options: FakeCliPackageOptions = {},
): Promise<FakeCliPackage> {
  const cliPackageRoot = await makeTempDir("bb-cli-package-");
  const cliPackageManifestPath = path.join(cliPackageRoot, "package.json");
  const binPath = options.binPath ?? "./dist/bin/bb";
  const cliEntryPath = path.resolve(cliPackageRoot, binPath);

  await fs.writeFile(
    cliPackageManifestPath,
    JSON.stringify({
      name: "@bb/cli",
      bin: {
        bb: binPath,
      },
    }),
  );

  if (options.writeEntry ?? true) {
    await fs.mkdir(path.dirname(cliEntryPath), { recursive: true });
    await fs.writeFile(
      cliEntryPath,
      "#!/usr/bin/env node\nprocess.stdout.write('bb')\n",
      { mode: options.executable ? 0o755 : 0o644 },
    );
    await fs.chmod(cliEntryPath, options.executable ? 0o755 : 0o644);
  }

  return {
    cliEntryPath,
    cliPackageManifestPath,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directoryPath) =>
      fs.rm(directoryPath, { recursive: true, force: true }),
    ),
  );
});

describe("prepareRuntimeShellEnv", () => {
  it("prepends the CLI executable directory to PATH", async () => {
    const { cliEntryPath, cliPackageManifestPath } = await createFakeCliPackage({
      executable: true,
    });

    const shellEnv = await prepareRuntimeShellEnv({
      serverUrl: "http://127.0.0.1:3334",
      localApiPort: 3002,
      inheritedPath: "/usr/bin",
      cliPackageManifestPath,
    });

    const bbDirectoryPath = path.dirname(cliEntryPath);

    expect(shellEnv).toEqual({
      PATH: `${bbDirectoryPath}:/usr/bin`,
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_HOST_DAEMON_PORT: "3002",
    });
  });

  it("fails clearly when the built CLI entry is missing", async () => {
    const { cliEntryPath, cliPackageManifestPath } = await createFakeCliPackage({
      writeEntry: false,
    });

    await expect(
      prepareRuntimeShellEnv({
        serverUrl: "http://127.0.0.1:3334",
        localApiPort: 3002,
        cliPackageManifestPath,
      }),
    ).rejects.toThrow(
      `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
    );
  });

  it("fails clearly when the built CLI entry is not executable", async () => {
    const { cliEntryPath, cliPackageManifestPath } = await createFakeCliPackage({
      executable: false,
    });

    await expect(
      prepareRuntimeShellEnv({
        serverUrl: "http://127.0.0.1:3334",
        localApiPort: 3002,
        cliPackageManifestPath,
      }),
    ).rejects.toThrow(
      `Built bb CLI executable is not executable: ${cliEntryPath}. Rebuild @bb/cli before starting the host daemon.`,
    );
  });
});
