import { runGit, WorkspaceError } from "./git.js";
import { Workspace } from "./workspace.js";

export interface WorkspaceExport {
  branch: string;
  remote?: string;
}

export interface ImportResult {
  previousBranch?: string;
  stashRef?: string | null;
}

export async function exportWorkspace(
  workspace: Workspace,
  pushToRemote?: string,
): Promise<WorkspaceExport> {
  const branch = await workspace.currentBranch;
  if (!branch) {
    throw new WorkspaceError("Cannot export a detached workspace");
  }

  if (pushToRemote) {
    await workspace.fetch({ remote: pushToRemote });
    await runGit(["push", pushToRemote, branch], { cwd: workspace.path });
    return {
      branch,
      remote: pushToRemote,
    };
  }

  await workspace.detachHead();
  return { branch };
}

export async function importWorkspace(
  primary: Workspace,
  exportData: WorkspaceExport,
): Promise<ImportResult> {
  if (exportData.remote) {
    await primary.fetch({
      remote: exportData.remote,
      branch: exportData.branch,
    });
  }

  const previousBranch = await primary.currentBranch;
  if (previousBranch === exportData.branch) {
    return { previousBranch };
  }

  const stashRef = await primary.stash("bb-promote");
  await primary.checkoutBranch(exportData.branch);

  return stashRef
    ? { previousBranch, stashRef }
    : { previousBranch };
}
