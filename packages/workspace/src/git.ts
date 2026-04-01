import { execFile, type ExecFileException } from "node:child_process";
import parcelWatcher from "@parcel/watcher";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BUFFER_BYTES = 16 * 1024 * 1024;
const WORKSPACE_STATUS_WATCH_DEBOUNCE_MS = 75;
const WORKSPACE_STATUS_WATCH_FALLBACK_POLL_INTERVAL_MS = 250;

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "WorkspaceError";
  }
}

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WorkspaceStatusChangeCallback = () => void;

type BranchStatus = {
  branchName?: string;
  aheadCount: number;
  behindCount: number;
};

export interface PorcelainEntry {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
}

interface ReadWorkspaceFileFingerprintEntryArgs {
  cwd: string;
  entry: PorcelainEntry;
}

type ParcelWatcherSubscribe = typeof parcelWatcher.subscribe;
type ParcelWatcherAsyncSubscription = Awaited<
  ReturnType<ParcelWatcherSubscribe>
>;
type ParcelWatcherOptions = Parameters<ParcelWatcherSubscribe>[2];

interface ParsedPorcelainPathToken {
  nextIndex: number;
  value: string;
}

interface GitMetadataLayout {
  commonDirPath: string;
  dotGitPath: string;
  gitDirPath: string;
}

interface GitRefRoots {
  headsRootPath: string;
  originRootPath: string;
}

interface WatchSubscriptionSpec {
  options?: ParcelWatcherOptions;
  rootPath: string;
}

const GIT_QUOTED_PATH_ESCAPE_BYTES = new Map<string, number>([
  ['"', 34],
  ["\\", 92],
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["n", 10],
  ["r", 13],
  ["t", 9],
  ["v", 11],
]);

function toExecError(error: unknown): ExecFileException | undefined {
  if (error instanceof Error) {
    return error as ExecFileException;
  }
  return undefined;
}

function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
}

function getExitCode(error: ExecFileException | undefined): number {
  if (typeof error?.code === "number") {
    return error.code;
  }
  return 1;
}

export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: DEFAULT_BUFFER_BYTES,
      timeout: options.timeoutMs,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const execError = toExecError(error);
    if (options.allowFailure) {
      return {
        stdout: execError?.stdout ?? "",
        stderr: execError?.stderr ?? "",
        exitCode: getExitCode(execError),
      };
    }

    const stderr = trimOutput(execError?.stderr ?? "");
    const detail = stderr ? `: ${stderr}` : "";
    throw new WorkspaceError("git_command_failed", `git ${args.join(" ")} failed${detail}`, {
      cause: error,
    });
  }
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function detectGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(
    ["rev-parse", "--is-inside-work-tree"],
    { cwd, allowFailure: true },
  );
  return result.exitCode === 0 && trimOutput(result.stdout) === "true";
}

export async function ensureGitRepo(cwd: string): Promise<void> {
  if (await detectGitRepo(cwd)) {
    return;
  }

  throw new WorkspaceError("not_git_repo", `Path is not a git repository: ${cwd}`);
}

export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  if (!(await detectGitRepo(cwd))) {
    return undefined;
  }

  const result = await runGit(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd, allowFailure: true },
  );
  if (result.exitCode !== 0) {
    return undefined;
  }

  const branchName = trimOutput(result.stdout);
  return branchName || undefined;
}

export function parseBranchStatus(line: string | undefined): BranchStatus {
  const cleaned = line?.trim() ?? "";
  if (!cleaned.startsWith("##")) {
    return { aheadCount: 0, behindCount: 0 };
  }

  const branchMatch = cleaned.match(/^##\s+([^.\s]+)(?:\.\.\.[^\s]+)?/u);
  const aheadMatch = cleaned.match(/ahead (\d+)/u);
  const behindMatch = cleaned.match(/behind (\d+)/u);

  return {
    branchName: branchMatch?.[1],
    aheadCount: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behindCount: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
  };
}

function appendUtf8Bytes(bytes: number[], value: string): void {
  bytes.push(...Buffer.from(value, "utf8"));
}

function isOctalDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "7";
}

function readEscapedPorcelainPathBytes(
  bytes: number[],
  rawPath: string,
  startIndex: number,
): number {
  const escapeChar = rawPath[startIndex + 1];
  if (escapeChar === undefined) {
    return startIndex + 1;
  }
  if (isOctalDigit(escapeChar)) {
    let octalValue = escapeChar;
    let index = startIndex + 2;
    while (octalValue.length < 3 && isOctalDigit(rawPath[index])) {
      octalValue += rawPath[index] ?? "";
      index += 1;
    }
    bytes.push(Number.parseInt(octalValue, 8));
    return index;
  }
  const escapedByte = GIT_QUOTED_PATH_ESCAPE_BYTES.get(escapeChar);
  if (escapedByte !== undefined) {
    bytes.push(escapedByte);
  } else {
    appendUtf8Bytes(bytes, escapeChar);
  }
  return startIndex + 2;
}

function parseQuotedPorcelainPathToken(
  rawPath: string,
  startIndex: number,
): ParsedPorcelainPathToken {
  const bytes: number[] = [];
  let index = startIndex + 1;
  while (index < rawPath.length) {
    const currentChar = rawPath[index];
    if (currentChar === '"') {
      return {
        nextIndex: index + 1,
        value: Buffer.from(bytes).toString("utf8"),
      };
    }
    if (currentChar === "\\") {
      index = readEscapedPorcelainPathBytes(bytes, rawPath, index);
      continue;
    }
    const codePoint = rawPath.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    appendUtf8Bytes(bytes, character);
    index += character.length;
  }
  return {
    nextIndex: rawPath.length,
    value: rawPath.slice(startIndex),
  };
}

function parseUnquotedPorcelainPathToken(
  rawPath: string,
  startIndex: number,
): ParsedPorcelainPathToken {
  const separatorIndex = rawPath.indexOf(" -> ", startIndex);
  const endIndex = separatorIndex === -1 ? rawPath.length : separatorIndex;
  return {
    nextIndex: endIndex,
    value: rawPath.slice(startIndex, endIndex),
  };
}

function parsePorcelainPathToken(
  rawPath: string,
  startIndex: number,
): ParsedPorcelainPathToken {
  if (rawPath[startIndex] === '"') {
    return parseQuotedPorcelainPathToken(rawPath, startIndex);
  }
  return parseUnquotedPorcelainPathToken(rawPath, startIndex);
}

function parsePorcelainPath(rawPath: string): string {
  const sourcePath = parsePorcelainPathToken(rawPath, 0);
  if (rawPath.slice(sourcePath.nextIndex, sourcePath.nextIndex + 4) !== " -> ") {
    return sourcePath.value;
  }
  return parsePorcelainPathToken(rawPath, sourcePath.nextIndex + 4).value;
}

export function parsePorcelainEntries(statusOutput: string): PorcelainEntry[] {
  return statusOutput
    .split("\n")
    .filter((line) => line && !line.startsWith("##"))
    .map((line) => {
      const indexStatus = line[0] ?? " ";
      const worktreeStatus = line[1] ?? " ";
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = line.slice(3).trim();

      return {
        path: parsePorcelainPath(rawPath),
        status,
        indexStatus,
        worktreeStatus,
      };
    });
}

export function summarizeNumstat(output: string): {
  changedFiles: number;
  insertions: number;
  deletions: number;
} {
  const lines = output.split("\n").filter(Boolean);

  return lines.reduce(
    (summary, line) => {
      const [insertionsText, deletionsText] = line.split("\t");
      const insertions = Number.parseInt(insertionsText ?? "", 10);
      const deletions = Number.parseInt(deletionsText ?? "", 10);

      return {
        changedFiles: summary.changedFiles + 1,
        insertions: summary.insertions + (Number.isFinite(insertions) ? insertions : 0),
        deletions: summary.deletions + (Number.isFinite(deletions) ? deletions : 0),
      };
    },
    { changedFiles: 0, insertions: 0, deletions: 0 },
  );
}

export async function readDefaultBranch(cwd: string): Promise<string | undefined> {
  await ensureGitRepo(cwd);

  const originHead = await runGit(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    { cwd, allowFailure: true },
  );
  const remoteHead = trimOutput(originHead.stdout);
  if (remoteHead.startsWith("refs/remotes/origin/")) {
    return remoteHead.replace("refs/remotes/origin/", "");
  }

  const branches = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd },
  );
  const localBranches = branches.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  if (localBranches.includes("main")) {
    return "main";
  }
  if (localBranches.includes("master")) {
    return "master";
  }

  return localBranches[0];
}

export async function hasRef(cwd: string, ref: string): Promise<boolean> {
  await ensureGitRepo(cwd);
  const result = await runGit(
    ["show-ref", "--verify", "--quiet", ref],
    { cwd, allowFailure: true },
  );
  return result.exitCode === 0;
}

export async function readMergeBaseRef(
  cwd: string,
  ref: string,
): Promise<string | undefined> {
  await ensureGitRepo(cwd);
  const result = await runGit(
    ["merge-base", ref, "HEAD"],
    { cwd, allowFailure: true },
  );
  if (result.exitCode !== 0) {
    return undefined;
  }

  const mergeBaseRef = trimOutput(result.stdout);
  return mergeBaseRef || undefined;
}

export async function revParse(cwd: string, ref: string): Promise<string> {
  await ensureGitRepo(cwd);
  const result = await runGit(["rev-parse", ref], { cwd });
  return trimOutput(result.stdout);
}

export async function listBranches(cwd: string): Promise<string[]> {
  await ensureGitRepo(cwd);
  const result = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd },
  );
  return result.stdout
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  await ensureGitRepo(cwd);
  const status = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd },
  );
  return status.stdout.trim().length > 0;
}

export async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function resolveGitDirectory(cwd: string): Promise<string | undefined> {
  const dotGitPath = path.join(cwd, ".git");
  try {
    const dotGitStat = await fs.lstat(dotGitPath);
    if (dotGitStat.isDirectory()) {
      return dotGitPath;
    }
    if (!dotGitStat.isFile()) {
      return undefined;
    }
    const dotGitContents = await fs.readFile(dotGitPath, "utf8");
    const firstLine = dotGitContents.split("\n")[0]?.trim() ?? "";
    if (!firstLine.startsWith("gitdir:")) {
      return undefined;
    }
    const relativeGitDir = firstLine.slice("gitdir:".length).trim();
    if (relativeGitDir.length === 0) {
      return undefined;
    }
    return path.resolve(cwd, relativeGitDir);
  } catch {
    return undefined;
  }
}

async function resolveGitCommonDirectory(gitDirPath: string): Promise<string> {
  try {
    const relativeCommonDirPath = trimOutput(
      await fs.readFile(path.join(gitDirPath, "commondir"), "utf8"),
    );
    if (relativeCommonDirPath.length === 0) {
      return gitDirPath;
    }
    return path.resolve(gitDirPath, relativeCommonDirPath);
  } catch {
    return gitDirPath;
  }
}

async function resolveGitMetadataLayout(cwd: string): Promise<GitMetadataLayout> {
  const dotGitPath = path.join(cwd, ".git");
  const gitDirPath = (await resolveGitDirectory(cwd)) ?? dotGitPath;
  return {
    commonDirPath: await resolveGitCommonDirectory(gitDirPath),
    dotGitPath,
    gitDirPath,
  };
}

function createGitRefRoots(commonDirPath: string): GitRefRoots {
  const refsRootPath = path.join(commonDirPath, "refs");
  const remotesRootPath = path.join(refsRootPath, "remotes");
  return {
    headsRootPath: path.join(refsRootPath, "heads"),
    originRootPath: path.join(remotesRootPath, "origin"),
  };
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

async function collectMetadataTreePaths(rootPath: string): Promise<string[]> {
  try {
    const rootStat = await fs.lstat(rootPath);
    if (!rootStat.isDirectory()) {
      return [rootPath];
    }
    const childNames = await fs.readdir(rootPath);
    const childPaths = await Promise.all(
      childNames.map((childName) =>
        collectMetadataTreePaths(path.join(rootPath, childName)),
      ),
    );
    return [rootPath, ...childPaths.flat()];
  } catch {
    return [rootPath];
  }
}

function createCommonDirWatchOptions(): ParcelWatcherOptions {
  return {
    ignore: [
      "hooks",
      "info",
      "logs",
      "modules",
      "objects",
      "worktrees",
    ],
  };
}

async function resolveMetadataWatchSpecs(cwd: string): Promise<WatchSubscriptionSpec[]> {
  const layout = await resolveGitMetadataLayout(cwd);
  const commonDirSpec = {
    options: createCommonDirWatchOptions(),
    rootPath: layout.commonDirPath,
  };
  if (layout.gitDirPath === layout.commonDirPath) {
    return [commonDirSpec];
  }
  return [
    {
      rootPath: layout.gitDirPath,
    },
    commonDirSpec,
  ];
}

async function resolveGitMetadataFingerprintPaths(
  cwd: string,
): Promise<string[]> {
  const layout = await resolveGitMetadataLayout(cwd);
  const refRoots = createGitRefRoots(layout.commonDirPath);
  const [headRefPaths, originRefPaths] = await Promise.all([
    collectMetadataTreePaths(refRoots.headsRootPath),
    collectMetadataTreePaths(refRoots.originRootPath),
  ]);
  return dedupePaths([
    // Exclude index/root mtimes here: running git status can refresh those
    // without any user-visible workspace change, which would cause false positives.
    path.join(layout.gitDirPath, "HEAD"),
    path.join(layout.commonDirPath, "packed-refs"),
    ...headRefPaths,
    ...originRefPaths,
  ]);
}

async function readMetadataFingerprintEntry(targetPath: string): Promise<string> {
  try {
    const stat = await fs.stat(targetPath);
    const statEntry = [
      targetPath,
      stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other",
      String(stat.size),
      String(stat.mtimeMs),
    ].join(":");
    if (path.basename(targetPath) === "HEAD" && stat.isFile()) {
      const headContents = await fs.readFile(targetPath, "utf8");
      return `${statEntry}:${headContents.trim()}`;
    }
    return statEntry;
  } catch {
    return `${targetPath}:missing`;
  }
}

async function readWorkspaceFileFingerprintEntry(
  args: ReadWorkspaceFileFingerprintEntryArgs,
): Promise<string> {
  try {
    const stat = await fs.lstat(path.join(args.cwd, args.entry.path));
    const fileKind = stat.isDirectory()
      ? "dir"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other";
    return [
      args.entry.path,
      fileKind,
      String(stat.size),
      String(stat.mtimeMs),
      String(stat.ctimeMs),
    ].join(":");
  } catch {
    return `${args.entry.path}:missing`;
  }
}

async function createWorkspaceStatusWatchFingerprint(cwd: string): Promise<string> {
  await ensureGitRepo(cwd);
  const [statusOutput, metadataPaths] = await Promise.all([
    runGit(
      ["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
      { cwd },
    ),
    resolveGitMetadataFingerprintPaths(cwd),
  ]);
  const statusEntries = parsePorcelainEntries(statusOutput.stdout);
  const metadataEntries = await Promise.all(
    metadataPaths.map((metadataPath) => readMetadataFingerprintEntry(metadataPath)),
  );
  const dirtyFileEntries = await Promise.all(
    statusEntries.map((entry) => readWorkspaceFileFingerprintEntry({ cwd, entry })),
  );
  return JSON.stringify({
    dirtyFileEntries,
    metadataEntries,
    status: statusOutput.stdout,
  });
}

export function watchWorkspaceStatus(
  cwd: string,
  onChange: WorkspaceStatusChangeCallback,
): () => void {
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastFingerprint = "";
  let baselineLoaded = false;
  let checkInFlight = false;
  let recheckRequested = false;
  const subscriptions = new Map<string, ParcelWatcherAsyncSubscription>();

  const stopSubscription = (rootPath: string) => {
    const subscription = subscriptions.get(rootPath);
    if (!subscription) {
      return;
    }
    subscriptions.delete(rootPath);
    void subscription.unsubscribe().catch(() => {
      // Ignore unsubscribe failures during watcher teardown.
    });
  };

  const runChecks = async () => {
    if (checkInFlight) {
      recheckRequested = true;
      return;
    }
    checkInFlight = true;
    try {
      do {
        recheckRequested = false;
        try {
          const nextFingerprint = await createWorkspaceStatusWatchFingerprint(cwd);
          if (disposed) {
            return;
          }
          if (!baselineLoaded) {
            lastFingerprint = nextFingerprint;
            baselineLoaded = true;
            continue;
          }
          if (nextFingerprint === lastFingerprint) {
            continue;
          }
          lastFingerprint = nextFingerprint;
          onChange();
        } catch {
          // Ignore watch checks for missing/non-git paths; query refetch remains the fallback.
        }
      } while (recheckRequested && !disposed);
    } finally {
      checkInFlight = false;
    }
  };

  const scheduleCheck = () => {
    if (disposed) {
      return;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runChecks();
    }, WORKSPACE_STATUS_WATCH_DEBOUNCE_MS);
  };

  const startFallbackPolling = () => {
    if (disposed || fallbackPollTimer !== null) {
      return;
    }
    fallbackPollTimer = setInterval(() => {
      if (disposed) {
        return;
      }
      void runChecks();
    }, WORKSPACE_STATUS_WATCH_FALLBACK_POLL_INTERVAL_MS);
  };

  const handleWatchFailure = () => {
    startFallbackPolling();
    scheduleCheck();
  };

  const startWatchSubscription = (spec: WatchSubscriptionSpec) => {
    void (async () => {
      if (disposed || subscriptions.has(spec.rootPath)) {
        return;
      }
      if (!(await pathExists(spec.rootPath))) {
        return;
      }
      try {
        const subscription = await parcelWatcher.subscribe(
          spec.rootPath,
          (error, events) => {
            if (disposed) {
              return;
            }
            if (error) {
              handleWatchFailure();
              return;
            }
            if (events.length === 0) {
              return;
            }
            scheduleCheck();
          },
          spec.options,
        );
        if (disposed) {
          void subscription.unsubscribe().catch(() => {
            // Ignore unsubscribe failures after late subscription setup.
          });
          return;
        }
        if (subscriptions.has(spec.rootPath)) {
          void subscription.unsubscribe().catch(() => {
            // Ignore duplicate unsubscribe failures.
          });
          return;
        }
        subscriptions.set(spec.rootPath, subscription);
      } catch {
        if (disposed) {
          return;
        }
        handleWatchFailure();
      }
    })();
  };

  void runChecks();
  startWatchSubscription({
    options: {
      ignore: [".git"],
    },
    rootPath: cwd,
  });
  void (async () => {
    try {
      const metadataSpecs = await resolveMetadataWatchSpecs(cwd);
      for (const spec of metadataSpecs) {
        startWatchSubscription(spec);
      }
    } catch {
      if (disposed) {
        return;
      }
      handleWatchFailure();
    }
  })();

  return () => {
    disposed = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (fallbackPollTimer !== null) {
      clearInterval(fallbackPollTimer);
      fallbackPollTimer = null;
    }
    for (const rootPath of subscriptions.keys()) {
      stopSubscription(rootPath);
    }
  };
}
