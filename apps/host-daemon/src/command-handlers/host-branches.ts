import path from "node:path";
import {
  detectGitRepo,
  getCheckoutRef,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  listBranches,
  readDefaultBranch,
} from "@bb/host-workspace";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";

export async function listHostBranches(
  command: CommandOf<"host.list_branches">,
): Promise<HostDaemonCommandResult<"host.list_branches">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  if (!(await detectGitRepo(command.path))) {
    return {
      branches: [],
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
    };
  }

  const [branches, checkout, defaultBranch, dirty, operation] =
    await Promise.all([
      listBranches(command.path),
      getCheckoutRef(command.path),
      readDefaultBranch(command.path),
      hasUncommittedChanges(command.path),
      getWorkspaceGitOperation(command.path),
    ]);
  // Pin the source's default branch to the top of the list so the picker
  // surfaces it first; everything else preserves git's alphabetical order.
  const sorted =
    defaultBranch && branches.includes(defaultBranch)
      ? [defaultBranch, ...branches.filter((b) => b !== defaultBranch)]
      : branches;
  return {
    branches: sorted,
    checkout,
    defaultBranch: defaultBranch ?? null,
    hasUncommittedChanges: dirty,
    operation,
  };
}
