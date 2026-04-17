import { Container, FolderGit2, Monitor } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  getEnvironmentWorkspaceDisplayIcon,
  getEnvironmentWorkspaceDisplayIconLabel,
  getEnvironmentWorkspaceLabelIcon,
} from "./environment-workspace-display";

describe("environment workspace display", () => {
  it("keeps sidebar display icons empty for other environments", () => {
    expect(getEnvironmentWorkspaceDisplayIcon("other")).toBeNull();
  });

  it("uses a monitor fallback for environment labels", () => {
    expect(getEnvironmentWorkspaceLabelIcon("other")).toBe(Monitor);
  });

  it("maps worktree and sandbox labels", () => {
    expect(getEnvironmentWorkspaceLabelIcon("sandbox")).toBe(Container);
    expect(getEnvironmentWorkspaceLabelIcon("managed-worktree")).toBe(
      FolderGit2,
    );
    expect(getEnvironmentWorkspaceLabelIcon("unmanaged-worktree")).toBe(
      FolderGit2,
    );
    expect(getEnvironmentWorkspaceDisplayIconLabel("managed-worktree")).toBe(
      "Managed worktree environment",
    );
    expect(getEnvironmentWorkspaceDisplayIconLabel("unmanaged-worktree")).toBe(
      "Git worktree environment",
    );
  });
});
