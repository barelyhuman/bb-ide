import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";

const EXECUTABLE_PERMISSION_MASK = 0o111;

interface PrepareRuntimeShellEnvOptions {
  localApiPort: number;
  serverUrl: string;
  inheritedPath?: string;
  cliPackageManifestPath?: string;
}

interface DaemonManagedBbExecutable {
  executableDirectoryPath: string;
}

function getDefaultCliPackageManifestPath(): string {
  return fileURLToPath(new URL("../../cli/package.json", import.meta.url));
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function getCliBinPathFromManifest(
  manifestText: string,
  manifestPath: string,
): string {
  const parsed: unknown = JSON.parse(manifestText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid CLI package manifest at ${manifestPath}`);
  }

  const binValue = Reflect.get(parsed, "bin");
  if (typeof binValue === "string" && binValue.length > 0) {
    return binValue;
  }

  if (binValue && typeof binValue === "object") {
    const bbBinValue = Reflect.get(binValue, "bb");
    if (typeof bbBinValue === "string" && bbBinValue.length > 0) {
      return bbBinValue;
    }
  }

  throw new Error(
    `CLI package manifest at ${manifestPath} does not define a bb bin entry`,
  );
}

async function resolveCliEntryPath(
  cliPackageManifestPath: string,
): Promise<string> {
  const manifestText = await fs.readFile(cliPackageManifestPath, "utf8");
  const cliBinPath = getCliBinPathFromManifest(
    manifestText,
    cliPackageManifestPath,
  );
  const cliEntryPath = resolve(dirname(cliPackageManifestPath), cliBinPath);

  try {
    const stats = await fs.stat(cliEntryPath);
    if (!stats.isFile()) {
      throw new Error(`Resolved bb CLI entry is not a file: ${cliEntryPath}`);
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error(
        `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
      );
    }
    throw error;
  }

  return cliEntryPath;
}

async function isExecutable(cliEntryPath: string): Promise<boolean> {
  const stats = await fs.stat(cliEntryPath);
  return (
    stats.isFile() && (stats.mode & EXECUTABLE_PERMISSION_MASK) !== 0
  );
}

async function resolveBbExecutable(
  cliPackageManifestPath?: string,
): Promise<DaemonManagedBbExecutable> {
  const resolvedCliPackageManifestPath =
    cliPackageManifestPath ?? getDefaultCliPackageManifestPath();
  const cliEntryPath = await resolveCliEntryPath(resolvedCliPackageManifestPath);

  if (!(await isExecutable(cliEntryPath))) {
    throw new Error(
      `Built bb CLI executable is not executable: ${cliEntryPath}. Rebuild @bb/cli before starting the host daemon.`,
    );
  }

  return {
    executableDirectoryPath: dirname(cliEntryPath),
  };
}

function prependPath(
  executableDirectoryPath: string,
  inheritedPath?: string,
): string {
  return inheritedPath
    ? `${executableDirectoryPath}:${inheritedPath}`
    : executableDirectoryPath;
}

export async function prepareRuntimeShellEnv(
  options: PrepareRuntimeShellEnvOptions,
): Promise<NonNullable<AgentRuntimeOptions["shellEnv"]>> {
  const bbExecutable = await resolveBbExecutable(options.cliPackageManifestPath);

  return {
    PATH: prependPath(
      bbExecutable.executableDirectoryPath,
      options.inheritedPath ?? process.env.PATH,
    ),
    BB_SERVER_URL: options.serverUrl,
    BB_HOST_DAEMON_PORT: String(options.localApiPort),
  };
}
