import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import { Container, FolderGit2, Monitor } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function getEnvironmentWorkspaceDisplayIcon(
  kind: EnvironmentWorkspaceDisplayKind,
): LucideIcon | null {
  switch (kind) {
    case "sandbox":
      return Container;
    case "managed-worktree":
      return FolderGit2;
    case "unmanaged-worktree":
      return FolderGit2;
    case "other":
      return null;
  }
}

export function getEnvironmentWorkspaceLabelIcon(
  kind: EnvironmentWorkspaceDisplayKind,
): LucideIcon {
  return getEnvironmentWorkspaceDisplayIcon(kind) ?? Monitor;
}

export function getEnvironmentWorkspaceDisplayIconLabel(
  kind: EnvironmentWorkspaceDisplayKind,
): string | null {
  switch (kind) {
    case "sandbox":
      return "Sandbox environment";
    case "managed-worktree":
      return "Managed worktree environment";
    case "unmanaged-worktree":
      return "Git worktree environment";
    case "other":
      return null;
  }
}
