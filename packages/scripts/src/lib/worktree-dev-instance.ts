import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

interface WorktreeDevPortSet {
  appPort: number;
  devEnvPort: number;
  hostDaemonPort: number;
  serverPort: number;
}

export interface WorktreeDevInstanceConfig {
  dataDir: string;
  databaseUrl: string;
  instanceId: string;
  ports: WorktreeDevPortSet;
  repoRoot: string;
  serverUrl: string;
}

interface ResolveWorktreeDevInstanceConfigArgs {
  homeDir: string;
  repoRoot: string;
}

interface WorktreeDevProcessEnvArgs {
  baseEnv: NodeJS.ProcessEnv;
  config: WorktreeDevInstanceConfig;
}

export interface LegacyDevDataMigrationResult {
  migratedEntries: string[];
  skippedReason?: LegacyDevDataMigrationSkippedReason;
}

export type LegacyDevDataMigrationSkippedReason =
  | "legacy-data-not-found"
  | "legacy-data-empty"
  | "legacy-dev-process-running"
  | "target-exists";

interface MigrateLegacyDevDataArgs {
  config: WorktreeDevInstanceConfig;
  dependencies?: LegacyDevDataMigrationDependencies;
  output?: MigrationOutput;
}

interface MigrationOutput {
  write(text: string): void;
}

interface LegacyDevDataMigrationDependencies {
  rename(sourcePath: string, targetPath: string): Promise<void>;
}

interface RollbackMigratedEntriesArgs {
  entries: string[];
  legacyDataDir: string;
  removeTargetDataDir: boolean;
  targetDataDir: string;
}

const WORKTREE_DEV_DATA_ROOT_DIR = ".bb-dev";
const WORKTREE_DEV_HASH_LENGTH = 12;
const WORKTREE_DEV_PORT_BUCKETS = 8_000;
const WORKTREE_DEV_APP_PORT_BASE = 11_000;
const WORKTREE_DEV_SERVER_PORT_BASE = 19_000;
const WORKTREE_DEV_HOST_DAEMON_PORT_BASE = 27_000;
const WORKTREE_DEV_ENV_PORT_BASE = 43_000;
const LEGACY_DEV_DATA_DIR_NAME = ".bb-dev";
const LEGACY_DEV_SUPERVISOR_DIR_NAME = "dev-supervisors";
const LEGACY_DEV_SUPERVISOR_PID_FILE_NAMES = [
  "host-daemon.pid",
  "server.pid",
] as const;
const MIGRATABLE_LEGACY_ENTRY_NAMES = new Set([
  "auth-secret",
  "auth.json",
  "bb.db",
  "bb.db-shm",
  "bb.db-wal",
  "event-spool.sqlite",
  "host-id",
  "logs",
  "manager-templates",
  "replays",
  "thread-storage",
]);

function createRepoRootHash(repoRootPath: string): string {
  return createHash("sha256").update(repoRootPath).digest("hex");
}

function sanitizeInstanceLabel(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  return sanitized.length > 0 ? sanitized : "worktree";
}

function resolveRepoRootLabel(
  args: ResolveWorktreeDevInstanceConfigArgs,
): string {
  const homeRelativePath = relative(args.homeDir, args.repoRoot);
  if (
    homeRelativePath.length > 0 &&
    !homeRelativePath.startsWith("../") &&
    !homeRelativePath.startsWith("..\\") &&
    homeRelativePath !== ".." &&
    !isAbsolute(homeRelativePath)
  ) {
    return homeRelativePath;
  }

  return args.repoRoot;
}

function resolveInstanceId(args: ResolveWorktreeDevInstanceConfigArgs): string {
  const hash = createRepoRootHash(args.repoRoot);
  const label = resolveRepoRootLabel(args);
  return `${sanitizeInstanceLabel(label)}-${hash.slice(0, WORKTREE_DEV_HASH_LENGTH)}`;
}

function resolvePortOffset(repoRootPath: string): number {
  const hash = createRepoRootHash(repoRootPath);
  return Number.parseInt(hash.slice(0, 8), 16) % WORKTREE_DEV_PORT_BUCKETS;
}

function resolvePorts(repoRootPath: string): WorktreeDevPortSet {
  const offset = resolvePortOffset(repoRootPath);
  return {
    appPort: WORKTREE_DEV_APP_PORT_BASE + offset,
    devEnvPort: WORKTREE_DEV_ENV_PORT_BASE + offset,
    hostDaemonPort: WORKTREE_DEV_HOST_DAEMON_PORT_BASE + offset,
    serverPort: WORKTREE_DEV_SERVER_PORT_BASE + offset,
  };
}

export function resolveWorktreeDevInstanceConfig(
  args: ResolveWorktreeDevInstanceConfigArgs,
): WorktreeDevInstanceConfig {
  const instanceId = resolveInstanceId(args);
  const dataDir = join(args.homeDir, WORKTREE_DEV_DATA_ROOT_DIR, instanceId);
  const ports = resolvePorts(args.repoRoot);
  const serverUrl = `http://localhost:${ports.serverPort}`;
  return {
    dataDir,
    databaseUrl: join(dataDir, "bb.db"),
    instanceId,
    ports,
    repoRoot: args.repoRoot,
    serverUrl,
  };
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await access(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isDirectoryEmpty(pathToCheck: string): Promise<boolean> {
  try {
    return (await readdir(pathToCheck)).length === 0;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function isMigratableLegacyEntryName(entryName: string): boolean {
  return (
    MIGRATABLE_LEGACY_ENTRY_NAMES.has(entryName) ||
    /^bb\.db\./u.test(entryName) ||
    /^event-spool\..*\.sqlite$/u.test(entryName) ||
    /^event-spool\..*\.sqlite-(?:shm|wal)$/u.test(entryName) ||
    /^event-spool\.sqlite-(?:shm|wal)$/u.test(entryName)
  );
}

async function isProcessRunning(pidPath: string): Promise<boolean> {
  let rawPid: string;
  try {
    rawPid = await readFile(pidPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const pid = Number.parseInt(rawPid.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

async function isLegacyDevProcessRunning(
  legacyDataDir: string,
): Promise<boolean> {
  for (const pidFileName of LEGACY_DEV_SUPERVISOR_PID_FILE_NAMES) {
    if (
      await isProcessRunning(
        join(legacyDataDir, LEGACY_DEV_SUPERVISOR_DIR_NAME, pidFileName),
      )
    ) {
      return true;
    }
  }

  return false;
}

async function listMigratableLegacyEntries(
  legacyDataDir: string,
): Promise<string[]> {
  const entries = await readdir(legacyDataDir, { withFileTypes: true });
  return entries
    .filter((entry) => isMigratableLegacyEntryName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function formatMigratedEntries(entries: string[]): string {
  return entries
    .map((entry) => `${LEGACY_DEV_DATA_DIR_NAME}/${entry}`)
    .join(", ");
}

async function rollbackMigratedEntries(
  args: RollbackMigratedEntriesArgs,
): Promise<void> {
  for (const entry of [...args.entries].reverse()) {
    const legacyPath = join(args.legacyDataDir, entry);
    const targetPath = join(args.targetDataDir, entry);
    if ((await pathExists(targetPath)) && !(await pathExists(legacyPath))) {
      await rename(targetPath, legacyPath);
    }
  }

  if (
    args.removeTargetDataDir &&
    (await pathExists(args.targetDataDir)) &&
    (await isDirectoryEmpty(args.targetDataDir))
  ) {
    await rmdir(args.targetDataDir);
  }
}

export async function migrateLegacyDevData(
  args: MigrateLegacyDevDataArgs,
): Promise<LegacyDevDataMigrationResult> {
  const dependencies: LegacyDevDataMigrationDependencies =
    args.dependencies ?? {
      rename,
    };
  const legacyDataDir = dirname(args.config.dataDir);
  const targetExists = await pathExists(args.config.dataDir);
  if (targetExists && !(await isDirectoryEmpty(args.config.dataDir))) {
    return {
      migratedEntries: [],
      skippedReason: "target-exists",
    };
  }

  if (!(await pathExists(legacyDataDir))) {
    return {
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    };
  }

  if ((await stat(legacyDataDir)).isDirectory() === false) {
    return {
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    };
  }

  const entries = await listMigratableLegacyEntries(legacyDataDir);
  if (entries.length === 0) {
    return {
      migratedEntries: [],
      skippedReason: "legacy-data-empty",
    };
  }

  if (await isLegacyDevProcessRunning(legacyDataDir)) {
    return {
      migratedEntries: [],
      skippedReason: "legacy-dev-process-running",
    };
  }

  const shouldRemoveTargetDataDirOnRollback = !targetExists;
  await mkdir(args.config.dataDir, { recursive: true });
  const migratedEntries: string[] = [];
  try {
    for (const entry of entries) {
      await dependencies.rename(
        join(legacyDataDir, entry),
        join(args.config.dataDir, entry),
      );
      migratedEntries.push(entry);
    }
  } catch (error) {
    await rollbackMigratedEntries({
      entries: migratedEntries,
      legacyDataDir,
      removeTargetDataDir: shouldRemoveTargetDataDirOnRollback,
      targetDataDir: args.config.dataDir,
    });
    throw error;
  }

  args.output?.write(
    `[dev:worktree] Migrated legacy dev data into ${args.config.dataDir}: ${formatMigratedEntries(entries)}\n`,
  );
  return {
    migratedEntries: entries,
  };
}

export function resolveCurrentWorktreeDevInstanceConfig(
  repoRoot: string,
): WorktreeDevInstanceConfig {
  return resolveWorktreeDevInstanceConfig({
    homeDir: homedir(),
    repoRoot,
  });
}

export function toWorktreeDevProcessEnv(
  args: WorktreeDevProcessEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.baseEnv,
    BB_DATABASE_URL: args.config.databaseUrl,
    BB_DATA_DIR: args.config.dataDir,
    BB_DEV_APP_PORT: String(args.config.ports.appPort),
    BB_DEV_ENV_PORT: String(args.config.ports.devEnvPort),
    BB_HOST_DAEMON_PORT: String(args.config.ports.hostDaemonPort),
    BB_SERVER_PORT: String(args.config.ports.serverPort),
    BB_SERVER_URL: args.config.serverUrl,
    NODE_ENV: "development",
  };
}

export function resolveCurrentWorktreeDevProcessEnv(
  repoRoot: string,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return toWorktreeDevProcessEnv({
    baseEnv,
    config: resolveCurrentWorktreeDevInstanceConfig(repoRoot),
  });
}
