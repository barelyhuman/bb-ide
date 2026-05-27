import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { IconName } from "@/components/ui/icon.js";
import { PersistentHostIconName } from "@/lib/host-display";

export function getEnvironmentWorkspaceDisplayIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName | null {
  switch (kind) {
    case "managed-worktree":
      return "GitBranch";
    case "unmanaged-worktree":
      return "GitBranch";
    case "personal":
      return "Folder";
    case "other":
      return null;
  }
}

export function getEnvironmentWorkspaceLabelIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName {
  return getEnvironmentWorkspaceDisplayIconName(kind) ?? PersistentHostIconName;
}

export function getEnvironmentWorkspaceDisplayIconLabel(
  kind: EnvironmentWorkspaceDisplayKind,
): string | null {
  switch (kind) {
    case "managed-worktree":
      return "Managed worktree environment";
    case "unmanaged-worktree":
      return "Git worktree environment";
    case "personal":
      return "Personal workspace";
    case "other":
      return null;
  }
}
