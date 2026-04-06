import fs from "node:fs/promises";
import path from "node:path";

type ParcelWatcherSubscribe = (typeof import("@parcel/watcher"))["subscribe"];
type ParcelWatcherOptions = Parameters<ParcelWatcherSubscribe>[2];

export interface WatchSubscriptionSpec {
  options?: ParcelWatcherOptions;
  rootPath: string;
}

interface GitMetadataLayout {
  commonDirPath: string;
  gitDirPath: string;
}

function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
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

async function resolveGitMetadataLayout(
  cwd: string,
): Promise<GitMetadataLayout | null> {
  const gitDirPath = await resolveGitDirectory(cwd);
  if (!gitDirPath) {
    return null;
  }
  return {
    commonDirPath: await resolveGitCommonDirectory(gitDirPath),
    gitDirPath,
  };
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

export async function resolveMetadataWatchSpecs(
  cwd: string,
): Promise<WatchSubscriptionSpec[] | null> {
  const layout = await resolveGitMetadataLayout(cwd);
  if (!layout) {
    return null;
  }
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
