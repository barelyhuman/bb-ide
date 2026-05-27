import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  jsonValueSchema,
  type JsonValue,
  type StatusDataKey,
} from "@bb/domain";
import {
  parseStatusDataFileName,
  statusDataFileName,
  STATUS_DATA_DIRECTORY_NAME,
} from "@bb/host-watcher";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES } from "./file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

interface StatusDataEntry {
  key: StatusDataKey;
  modifiedAtMs: number;
  sizeBytes: number;
  value: JsonValue;
  version: string;
}

interface StatusDataPreviousValue {
  previousValue: JsonValue | null;
  previousValuePresent: boolean;
  previousVersion: string | null;
}

interface ResolveThreadStorageRootArgs {
  rootPath: string;
}

interface ResolveStatusDataRootArgs {
  threadStorageRootPath: string;
}

interface ResolvedStatusDataRoot {
  fingerprint: StatusDataDirectoryFingerprint;
  path: string;
}

export type StatusDataDirectoryFingerprint = string;

export interface ReadStatusDataDirectoryFingerprintFromRootArgs {
  rootPath: string;
}

interface HostStatusDataCommandOptions {
  threadStorageRootPath: string;
}

type HostStatusDataCommand = CommandOf<
  | "host.status_data.list"
  | "host.status_data.get"
  | "host.status_data.set"
  | "host.status_data.delete"
>;

interface ReadStatusDataEntryArgs {
  key: StatusDataKey;
  statusDataRootPath: string;
}

interface WriteStatusDataEntryArgs extends ReadStatusDataEntryArgs {
  value: JsonValue;
}

interface ParseStatusDataJsonArgs {
  bytes: Buffer;
  key: StatusDataKey;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function statusDataDirectoryFingerprint(stat: Stats): string {
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
}

function canonicalizeStatusJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function statusDataRelativePath(key: StatusDataKey): string {
  return statusDataFileName(key);
}

function statusDataFilePath(
  statusDataRootPath: string,
  key: StatusDataKey,
): string {
  return path.join(statusDataRootPath, statusDataRelativePath(key));
}

function createMissingStatusDataKeyError(key: StatusDataKey): Error {
  return new ExpectedCommandDispatchError(
    "ENOENT",
    `Path does not exist: ${statusDataRelativePath(key)}`,
  );
}

function parseStatusDataJson(args: ParseStatusDataJsonArgs): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(args.bytes.toString("utf8")));
  } catch {
    throw new CommandDispatchError(
      "invalid_json",
      `STATUS-data/${args.key}.json does not contain valid JSON`,
    );
  }
}

function createStatusDataFileTooLargeError(stat: Stats): CommandDispatchError {
  return new CommandDispatchError(
    "file_too_large",
    `File size ${stat.size} bytes exceeds the ${Math.floor(NON_IMAGE_FILE_SIZE_LIMIT_BYTES / (1024 * 1024))} MB limit`,
  );
}

function createPreviousValue(
  entry: StatusDataEntry | null,
): StatusDataPreviousValue {
  return {
    previousValue: entry?.value ?? null,
    previousValuePresent: entry !== null,
    previousVersion: entry?.version ?? null,
  };
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function resolveCommandThreadStoragePath(
  command: HostStatusDataCommand,
  options: HostStatusDataCommandOptions,
): string {
  if (!path.isAbsolute(options.threadStorageRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "threadStorageRootPath must be absolute",
    );
  }
  const rootPath = path.resolve(
    options.threadStorageRootPath,
    command.threadId,
  );
  if (!isPathWithinRoot(rootPath, options.threadStorageRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "threadId resolves outside thread storage root",
    );
  }
  return rootPath;
}

function isStatusDataKey(key: StatusDataKey | null): key is StatusDataKey {
  return key !== null;
}

async function resolveExistingThreadStorageRoot(
  args: ResolveThreadStorageRootArgs,
): Promise<string | null> {
  if (!path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  try {
    return await resolveNonSymlinkDirectoryPath({
      description: "Thread storage root",
      path: args.rootPath,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function ensureThreadStorageRoot(
  args: ResolveThreadStorageRootArgs,
): Promise<string> {
  if (!path.isAbsolute(args.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }
  await fs.mkdir(args.rootPath, { recursive: true });
  return resolveNonSymlinkDirectoryPath({
    description: "Thread storage root",
    path: args.rootPath,
  });
}

async function resolveExistingStatusDataRoot(
  args: ResolveStatusDataRootArgs,
): Promise<ResolvedStatusDataRoot | null> {
  const statusDataRootPath = path.join(
    args.threadStorageRootPath,
    STATUS_DATA_DIRECTORY_NAME,
  );
  try {
    const resolvedPath = await resolveNonSymlinkDirectoryPath({
      description: "STATUS-data directory",
      path: statusDataRootPath,
    });
    const stat = await fs.stat(resolvedPath);
    return {
      fingerprint: statusDataDirectoryFingerprint(stat),
      path: resolvedPath,
    };
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function ensureStatusDataRoot(
  args: ResolveStatusDataRootArgs,
): Promise<ResolvedStatusDataRoot> {
  const statusDataRootPath = path.join(
    args.threadStorageRootPath,
    STATUS_DATA_DIRECTORY_NAME,
  );
  try {
    await fs.mkdir(statusDataRootPath, { recursive: true });
  } catch (error) {
    if (!isFsErrorWithCode(error, "EEXIST")) {
      throw error;
    }
  }
  const resolvedPath = await resolveNonSymlinkDirectoryPath({
    description: "STATUS-data directory",
    path: statusDataRootPath,
  });
  const stat = await fs.stat(resolvedPath);
  return {
    fingerprint: statusDataDirectoryFingerprint(stat),
    path: resolvedPath,
  };
}

async function readStatusDataEntryOrNull(
  args: ReadStatusDataEntryArgs,
): Promise<StatusDataEntry | null> {
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new CommandDispatchError(
      "invalid_path",
      `STATUS-data/${args.key}.json is a symlink, not a file`,
    );
  }
  if (!stat.isFile()) {
    throw new CommandDispatchError(
      "invalid_path",
      `STATUS-data/${args.key}.json is not a file`,
    );
  }
  if (stat.size > NON_IMAGE_FILE_SIZE_LIMIT_BYTES) {
    throw createStatusDataFileTooLargeError(stat);
  }

  const bytes = await fs.readFile(filePath);
  return {
    key: args.key,
    value: parseStatusDataJson({ key: args.key, bytes }),
    version: sha256(bytes),
    sizeBytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
  };
}

async function requireStatusDataEntry(
  args: ReadStatusDataEntryArgs,
): Promise<StatusDataEntry> {
  const entry = await readStatusDataEntryOrNull(args);
  if (!entry) {
    throw createMissingStatusDataKeyError(args.key);
  }
  return entry;
}

async function writeStatusDataEntry(
  args: WriteStatusDataEntryArgs,
): Promise<StatusDataEntry> {
  await fs.mkdir(args.statusDataRootPath, { recursive: true });
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  const content = canonicalizeStatusJson(args.value);
  const bytes = Buffer.from(content, "utf8");
  const tempPath = path.join(
    args.statusDataRootPath,
    `.${args.key}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await fs.writeFile(tempPath, bytes, { flag: "wx" });
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  const stat = await fs.stat(filePath);
  return {
    key: args.key,
    value: args.value,
    version: sha256(bytes),
    sizeBytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
  };
}

async function deleteStatusDataEntry(
  args: ReadStatusDataEntryArgs,
): Promise<void> {
  const filePath = statusDataFilePath(args.statusDataRootPath, args.key);
  try {
    await fs.rm(filePath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

export async function listHostStatusData(
  command: CommandOf<"host.status_data.list">,
  options: HostStatusDataCommandOptions,
): Promise<HostDaemonCommandResult<"host.status_data.list">> {
  return listHostStatusDataFromRoot({
    rootPath: resolveCommandThreadStoragePath(command, options),
  });
}

export async function listHostStatusDataFromRoot(
  args: ResolveThreadStorageRootArgs,
): Promise<HostDaemonCommandResult<"host.status_data.list">> {
  const threadStorageRootPath = await resolveExistingThreadStorageRoot({
    rootPath: args.rootPath,
  });
  if (threadStorageRootPath === null) {
    return {
      values: {},
      versions: {},
      hash: sha256(Buffer.from("")),
    };
  }

  const statusDataRoot = await resolveExistingStatusDataRoot({
    threadStorageRootPath,
  });
  if (statusDataRoot === null) {
    return {
      values: {},
      versions: {},
      hash: sha256(Buffer.from("")),
    };
  }
  let entries;
  try {
    entries = await fs.readdir(statusDataRoot.path, { withFileTypes: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return {
        values: {},
        versions: {},
        hash: sha256(Buffer.from("")),
      };
    }
    throw error;
  }

  const keys = entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseStatusDataFileName(entry.name))
    .filter(isStatusDataKey);
  const statusEntries = await Promise.all(
    keys.map((key) =>
      requireStatusDataEntry({
        statusDataRootPath: statusDataRoot.path,
        key,
      }),
    ),
  );

  const values: Record<StatusDataKey, JsonValue> = {};
  const versions: Record<StatusDataKey, string> = {};
  for (const statusEntry of statusEntries) {
    values[statusEntry.key] = statusEntry.value;
    versions[statusEntry.key] = statusEntry.version;
  }

  const aggregateHash = createHash("sha256");
  for (const key of Object.keys(versions).sort()) {
    aggregateHash.update(`${key}\0${versions[key]}\n`);
  }

  return {
    values,
    versions,
    hash: aggregateHash.digest("hex"),
  };
}

export async function readStatusDataDirectoryFingerprintFromRoot(
  args: ReadStatusDataDirectoryFingerprintFromRootArgs,
): Promise<StatusDataDirectoryFingerprint | null> {
  const threadStorageRootPath = await resolveExistingThreadStorageRoot({
    rootPath: args.rootPath,
  });
  if (threadStorageRootPath === null) {
    return null;
  }

  const statusDataRoot = await resolveExistingStatusDataRoot({
    threadStorageRootPath,
  });
  return statusDataRoot?.fingerprint ?? null;
}

export async function readHostStatusData(
  command: CommandOf<"host.status_data.get">,
  options: HostStatusDataCommandOptions,
): Promise<HostDaemonCommandResult<"host.status_data.get">> {
  return readHostStatusDataFromRoot({
    rootPath: resolveCommandThreadStoragePath(command, options),
    key: command.key,
  });
}

export async function readHostStatusDataFromRoot(
  args: ResolveThreadStorageRootArgs & { key: StatusDataKey },
): Promise<HostDaemonCommandResult<"host.status_data.get">> {
  const threadStorageRootPath = await resolveExistingThreadStorageRoot({
    rootPath: args.rootPath,
  });
  if (threadStorageRootPath === null) {
    throw createMissingStatusDataKeyError(args.key);
  }
  const statusDataRoot = await resolveExistingStatusDataRoot({
    threadStorageRootPath,
  });
  if (statusDataRoot === null) {
    throw createMissingStatusDataKeyError(args.key);
  }
  return requireStatusDataEntry({
    statusDataRootPath: statusDataRoot.path,
    key: args.key,
  });
}

export async function writeHostStatusData(
  command: CommandOf<"host.status_data.set">,
  options: HostStatusDataCommandOptions,
): Promise<HostDaemonCommandResult<"host.status_data.set">> {
  const threadStorageRootPath = await ensureThreadStorageRoot({
    rootPath: resolveCommandThreadStoragePath(command, options),
  });
  const statusDataRoot = await ensureStatusDataRoot({
    threadStorageRootPath,
  });
  const previous = await readStatusDataEntryOrNull({
    statusDataRootPath: statusDataRoot.path,
    key: command.key,
  });
  const entry = await writeStatusDataEntry({
    statusDataRootPath: statusDataRoot.path,
    key: command.key,
    value: command.value,
  });
  return {
    ...entry,
    ...createPreviousValue(previous),
  };
}

export async function deleteHostStatusData(
  command: CommandOf<"host.status_data.delete">,
  options: HostStatusDataCommandOptions,
): Promise<HostDaemonCommandResult<"host.status_data.delete">> {
  const threadStorageRootPath = await resolveExistingThreadStorageRoot({
    rootPath: resolveCommandThreadStoragePath(command, options),
  });
  if (threadStorageRootPath === null) {
    return {
      key: command.key,
      deleted: false,
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    };
  }

  const statusDataRoot = await resolveExistingStatusDataRoot({
    threadStorageRootPath,
  });
  if (statusDataRoot === null) {
    return {
      key: command.key,
      deleted: false,
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    };
  }
  const previous = await readStatusDataEntryOrNull({
    statusDataRootPath: statusDataRoot.path,
    key: command.key,
  });
  if (previous === null) {
    return {
      key: command.key,
      deleted: false,
      previousValue: null,
      previousValuePresent: false,
      previousVersion: null,
    };
  }

  await deleteStatusDataEntry({
    statusDataRootPath: statusDataRoot.path,
    key: command.key,
  });
  return {
    key: command.key,
    deleted: true,
    ...createPreviousValue(previous),
  };
}
