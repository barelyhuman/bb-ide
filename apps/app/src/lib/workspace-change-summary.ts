import type { WorkspaceStatus } from "@bb/domain";

type ChangeCounts = {
  changedFiles: number;
  insertions: number;
  deletions: number;
};

type WorkspaceChangeCounts = Pick<
  WorkspaceStatus["workingTree"],
  "changedFiles" | "insertions" | "deletions"
>;

export function formatWorkspaceChangedFilesLabel(changedFiles: number): string {
  return `${changedFiles} file${changedFiles === 1 ? "" : "s"}`;
}

function hasLineChanges(counts: Pick<ChangeCounts, "insertions" | "deletions">): boolean {
  return counts.insertions > 0 || counts.deletions > 0;
}

export function formatChangeSummary(counts: ChangeCounts): string {
  const filesLabel = formatWorkspaceChangedFilesLabel(counts.changedFiles);
  if (!hasLineChanges(counts)) {
    return filesLabel;
  }

  return `${filesLabel}, +${counts.insertions} -${counts.deletions}`;
}

export function formatWorkspaceChangeSummary(counts: WorkspaceChangeCounts): string {
  return formatChangeSummary({
    changedFiles: counts.changedFiles,
    insertions: counts.insertions,
    deletions: counts.deletions,
  });
}

export function formatWorkspaceFileStatus(status: string): string {
  if (status === "??") {
    return "A?";
  }

  // Git porcelain status is open_external; preserve unknown values intentionally.
  return status;
}
