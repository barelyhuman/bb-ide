import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonCommandResult, environmentProvisionCommandSchema } from "@bb/host-daemon-contract";
import { CommandDispatchError, type CommandDispatchOptions, type CommandOf } from "../command-dispatch-support.js";

export async function provisionEnvironment(
  command: CommandOf<"environment.provision">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"environment.provision">> {
  const alreadyExists = options.runtimeManager.get(command.environmentId) != null;
  const entry = await options.runtimeManager.ensureEnvironment({
    environmentId: command.environmentId,
    provision: toProvisionWorkspaceOptions(command),
  });
  const ranSetup =
    !alreadyExists && entry.workspace.managed
      ? await detectSetupScript(command)
      : false;
  const defaultBranch = entry.workspace.isGitRepo
    ? (await entry.workspace.getStatus()).defaultBranch ?? null
    : null;
  return {
    path: entry.workspace.path,
    isGitRepo: entry.workspace.isGitRepo,
    isWorktree: entry.workspace.isWorktree,
    branchName: await entry.workspace.currentBranch(),
    defaultBranch,
    ranSetup,
  };
}

export async function detectSetupScript(
  command: typeof environmentProvisionCommandSchema._type,
): Promise<boolean> {
  const scriptName = ".bb-env-setup.sh";
  let scriptParentPath: string;
  switch (command.workspaceProvisionType) {
    case "unmanaged":
      scriptParentPath = command.path;
      break;
    case "managed-worktree":
    case "managed-clone":
      scriptParentPath = command.sourcePath;
      break;
  }
  try {
    await fs.access(path.join(scriptParentPath, scriptName));
    return true;
  } catch {
    return false;
  }
}

export function toProvisionWorkspaceOptions(
  command: typeof environmentProvisionCommandSchema._type,
) {
  switch (command.workspaceProvisionType) {
    case "unmanaged": {
      return {
        workspaceProvisionType: "unmanaged" as const,
        path: command.path,
      };
    }
    case "managed-worktree":
    case "managed-clone": {
      if (!command.sourcePath || !command.targetPath || !command.branchName) {
        throw new CommandDispatchError(
          "invalid_command",
          `Managed provision missing sourcePath/targetPath/branchName for environment ${command.environmentId}`,
        );
      }
      return {
        workspaceProvisionType: command.workspaceProvisionType,
        sourcePath: command.sourcePath,
        targetPath: command.targetPath,
        branchName: command.branchName,
      };
    }
  }
}
