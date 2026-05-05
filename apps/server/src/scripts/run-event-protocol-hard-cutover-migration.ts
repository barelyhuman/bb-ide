import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "@bb/db";
import {
  EventProtocolHardCutoverIntegrityError,
  EventProtocolHardCutoverPreflightError,
  runEventProtocolHardCutoverMigration,
} from "./event-protocol-hard-cutover-migration.js";

interface CliOptions {
  allowLiveMutation: boolean;
  apply: boolean;
  backupDir: string;
  confirmServicesStopped: boolean;
  copyTo: string | null;
  dbPath: string;
}

interface CliRunReport {
  backupPath: string | null;
  copiedFrom: string | null;
  dbPath: string;
  migration: ReturnType<typeof runEventProtocolHardCutoverMigration>;
}

interface CopySqliteDatabaseArgs {
  destinationPath: string;
  sourcePath: string;
}

interface PreparedDbPath {
  backupPath: string | null;
  copiedFrom: string | null;
  dbPath: string;
}

interface RunCliWithRuntimeArgs {
  argv: readonly string[];
  runtime: CliRuntime;
}

export interface TcpPortProbeArgs {
  host: string;
  port: number;
  timeoutMs: number;
}

export interface CliRuntime {
  defaultBackupDir: string;
  hostDaemonDevPortAcceptsConnections: () => Promise<boolean>;
  liveDevDbPath: string;
}

const LIVE_DEV_DB_PATH = resolve(homedir(), ".bb-dev", "bb.db");
export const DEFAULT_LIVE_BACKUP_DIR = resolve(homedir(), ".bb-dev", "backups");
const HOST_DAEMON_DEV_HOST = "127.0.0.1";
const HOST_DAEMON_DEV_PORT = 3002;
const HOST_DAEMON_DEV_PORT_PROBE_TIMEOUT_MS = 500;

const DEFAULT_CLI_RUNTIME: CliRuntime = {
  defaultBackupDir: DEFAULT_LIVE_BACKUP_DIR,
  hostDaemonDevPortAcceptsConnections: () =>
    isTcpPortAcceptingConnections({
      host: HOST_DAEMON_DEV_HOST,
      port: HOST_DAEMON_DEV_PORT,
      timeoutMs: HOST_DAEMON_DEV_PORT_PROBE_TIMEOUT_MS,
    }),
  liveDevDbPath: LIVE_DEV_DB_PATH,
};

export function isHelpRequested(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--help" || arg === "-h");
}

export function formatCliUsage(): string {
  return formatCliUsageForRuntime(DEFAULT_CLI_RUNTIME);
}

function formatCliUsageForRuntime(runtime: CliRuntime): string {
  return [
    "Usage:",
    "  pnpm --filter @bb/server dev:event-protocol-cutover -- [options]",
    "",
    "Options:",
    `  --db <path>                 Database path (default: ${runtime.liveDevDbPath})`,
    "  --copy-to <path>            Copy --db to this path before running checks/migration",
    "  --apply                     Apply mutation after preflight; default is preflight only",
    "  --preflight-only            Run read-only preflight only",
    `  --backup-dir <path>         Live-apply backup directory (default: ${runtime.defaultBackupDir})`,
    "  --allow-live-mutation       Required for direct live ~/.bb-dev/bb.db mutation",
    "  --confirm-services-stopped  Required for direct live mutation; also probes 127.0.0.1:3002",
    "  --help, -h                  Show this help",
    "",
    "Safety gates:",
    "  Direct preflight against live ~/.bb-dev/bb.db is refused; use --copy-to /tmp/...",
    "  Direct live apply requires --apply --allow-live-mutation --confirm-services-stopped.",
    "  Direct live apply refuses to run if the host daemon dev port accepts a connection.",
  ].join("\n");
}

function parseCliOptions(
  argv: readonly string[],
  runtime: CliRuntime,
): CliOptions {
  const options: CliOptions = {
    allowLiveMutation: false,
    apply: false,
    backupDir: runtime.defaultBackupDir,
    confirmServicesStopped: false,
    copyTo: null,
    dbPath: runtime.liveDevDbPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--":
        break;
      case "--help":
      case "-h":
        throw new Error("Help must be handled before parsing CLI options");
      case "--allow-live-mutation":
        options.allowLiveMutation = true;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--backup-dir":
        options.backupDir = requireNextValue(argv, index, arg);
        index += 1;
        break;
      case "--confirm-services-stopped":
        options.confirmServicesStopped = true;
        break;
      case "--copy-to":
        options.copyTo = requireNextValue(argv, index, arg);
        index += 1;
        break;
      case "--db":
        options.dbPath = requireNextValue(argv, index, arg);
        index += 1;
        break;
      case "--preflight-only":
        options.apply = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    ...options,
    backupDir: resolve(options.backupDir),
    copyTo: options.copyTo === null ? null : resolve(options.copyTo),
    dbPath: resolve(options.dbPath),
  };
}

function requireNextValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isLiveDevDbPath(path: string, runtime: CliRuntime): boolean {
  return resolve(path) === resolve(runtime.liveDevDbPath);
}

export async function isTcpPortAcceptingConnections(
  args: TcpPortProbeArgs,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = new Socket();
    let resolved = false;

    function finish(result: boolean): void {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.destroy();
      resolveProbe(result);
    }

    socket.setTimeout(args.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(args.port, args.host);
  });
}

async function assertHostDaemonDevPortClosed(
  runtime: CliRuntime,
): Promise<void> {
  const acceptsConnections =
    await runtime.hostDaemonDevPortAcceptsConnections();
  if (acceptsConnections) {
    throw new Error(
      [
        "Refusing live event protocol migration:",
        `${HOST_DAEMON_DEV_HOST}:${HOST_DAEMON_DEV_PORT} is accepting connections.`,
        "Stop the host daemon before direct live mutation.",
      ].join(" "),
    );
  }
}

async function copySqliteDatabase(args: CopySqliteDatabaseArgs): Promise<void> {
  mkdirSync(dirname(args.destinationPath), { recursive: true });
  const source = new Database(args.sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    await source.backup(args.destinationPath);
  } finally {
    source.close();
  }
}

function createLiveBackupPath(backupDir: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return join(
    backupDir,
    `bb-dev-before-event-protocol-hard-cutover-${timestamp}.db`,
  );
}

async function prepareDbPath(
  options: CliOptions,
  runtime: CliRuntime,
): Promise<PreparedDbPath> {
  if (options.copyTo) {
    await copySqliteDatabase({
      destinationPath: options.copyTo,
      sourcePath: options.dbPath,
    });
    return {
      backupPath: null,
      copiedFrom: options.dbPath,
      dbPath: options.copyTo,
    };
  }

  const isLiveApply = options.apply && isLiveDevDbPath(options.dbPath, runtime);
  if (!isLiveApply) {
    return {
      backupPath: null,
      copiedFrom: null,
      dbPath: options.dbPath,
    };
  }

  if (!options.allowLiveMutation || !options.confirmServicesStopped) {
    throw new Error(
      [
        "Refusing to mutate live ~/.bb-dev/bb.db.",
        "Coordinate with Michael, stop the dev server and host daemon, then pass",
        "--allow-live-mutation --confirm-services-stopped.",
      ].join(" "),
    );
  }

  await assertHostDaemonDevPortClosed(runtime);
  mkdirSync(options.backupDir, { recursive: true });
  const backupPath = createLiveBackupPath(options.backupDir);
  await copySqliteDatabase({
    destinationPath: backupPath,
    sourcePath: options.dbPath,
  });
  return {
    backupPath,
    copiedFrom: null,
    dbPath: options.dbPath,
  };
}

export async function runCliWithRuntime(
  args: RunCliWithRuntimeArgs,
): Promise<CliRunReport> {
  const options = parseCliOptions(args.argv, args.runtime);
  if (
    isLiveDevDbPath(options.dbPath, args.runtime) &&
    !options.copyTo &&
    !options.apply
  ) {
    throw new Error(
      "Refusing to open live ~/.bb-dev/bb.db directly for preflight; use --copy-to /tmp/...",
    );
  }

  const prepared = await prepareDbPath(options, args.runtime);
  const db = createConnection(prepared.dbPath);
  try {
    return {
      ...prepared,
      migration: runEventProtocolHardCutoverMigration({
        apply: options.apply,
        db,
      }),
    };
  } finally {
    db.$client.close();
  }
}

async function runCli(argv: readonly string[]): Promise<CliRunReport> {
  return runCliWithRuntime({ argv, runtime: DEFAULT_CLI_RUNTIME });
}

function formatCliError(error: unknown): string {
  if (error instanceof EventProtocolHardCutoverPreflightError) {
    return JSON.stringify(
      { error: error.message, preflight: error.report },
      null,
      2,
    );
  }
  if (error instanceof EventProtocolHardCutoverIntegrityError) {
    return JSON.stringify(
      { error: error.message, integrity: error.report },
      null,
      2,
    );
  }
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (isHelpRequested(argv)) {
    console.log(formatCliUsage());
  } else {
    runCli(argv)
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
      })
      .catch((error: unknown) => {
        console.error(formatCliError(error));
        process.exitCode = 1;
      });
  }
}

export { runCli };
