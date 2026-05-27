import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  requireWorkspaceEnvironment,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";

export async function squashMerge(
  command: CommandOf<"workspace.squash_merge">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.squash_merge">> {
  const entry = await requireWorkspaceEnvironment(
    { ...command, dataDir: options.dataDir },
    options.runtimeManager,
  );
  const result = await entry.workspace.squashMerge({
    targetBranch: command.targetBranch,
    commitMessage: command.commitMessage,
  });
  return {
    merged: result.merged,
    commitSha: result.commitSha,
    commitSubject: result.commitSubject,
  };
}
