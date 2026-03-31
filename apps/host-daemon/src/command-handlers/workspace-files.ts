import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import { runGit } from "@bb/workspace";
import type { RuntimeManager } from "../runtime-manager.js";
import {
  CommandDispatchError,
  requireWorkspaceEnvironment,
} from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { readTextFile } from "./file-read.js";

export async function listWorkspaceFiles(
  command: CommandOf<"workspace.list_files">,
  runtimeManager: RuntimeManager,
): Promise<HostDaemonCommandResult<"workspace.list_files">> {
  const entry = await requireWorkspaceEnvironment(command, runtimeManager);
  const workspacePath = entry.workspace.path;

  let filePaths: string[];
  const gitResult = await runGit(
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: workspacePath, allowFailure: true },
  );
  if (gitResult.exitCode === 0) {
    filePaths = gitResult.stdout.split("\n").filter((line) => line.length > 0);
  } else if (
    gitResult.exitCode === 128 ||
    gitResult.stderr.includes("not a git repository")
  ) {
    filePaths = await listFilesRecursively(workspacePath, workspacePath);
  } else {
    throw new CommandDispatchError(
      "git_command_failed",
      `git ls-files failed (exit ${gitResult.exitCode}): ${gitResult.stderr}`,
    );
  }

  if (command.query) {
    const lowerQuery = command.query.toLowerCase();
    filePaths = filePaths.filter((p) => p.toLowerCase().includes(lowerQuery));
  }

  let truncated = false;
  if (filePaths.length > command.limit) {
    filePaths = filePaths.slice(0, command.limit);
    truncated = true;
  }

  return {
    files: filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
    })),
    truncated,
  };
}

async function listFilesRecursively(
  dir: string,
  root: string,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(fullPath, root)));
    } else {
      results.push(path.relative(root, fullPath));
    }
  }
  return results;
}

export async function readWorkspaceFile(
  command: CommandOf<"workspace.read_file">,
  runtimeManager: RuntimeManager,
): Promise<HostDaemonCommandResult<"workspace.read_file">> {
  const entry = await requireWorkspaceEnvironment(command, runtimeManager);
  const workspacePath = entry.workspace.path;

  const resolved = path.resolve(workspacePath, command.path);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${command.path}" escapes workspace root`,
    );
  }

  return readTextFile(resolved, command.path);
}

export async function listBranches(
  command: CommandOf<"workspace.list_branches">,
  runtimeManager: RuntimeManager,
): Promise<HostDaemonCommandResult<"workspace.list_branches">> {
  const entry = await requireWorkspaceEnvironment(command, runtimeManager);
  const [branches, current] = await Promise.all([
    entry.workspace.getBranches(),
    entry.workspace.currentBranch(),
  ]);
  return { branches, current };
}
