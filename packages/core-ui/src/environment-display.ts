import type { Environment, EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import { resolveEnvironmentWorkspaceDisplayKind } from "@bb/domain";

export interface EnvironmentDisplayInfo {
  /**
   * Human-readable environment label: a custom environment name when present,
   * "Provisioning" while the environment is still being set up, otherwise
   * "Working locally", "Working remotely", or "Worktree".
   */
  modeLabel: string;
  /**
   * Compact mode label for constrained prompt/composer surfaces. Custom names
   * stay custom names; generated direct-workspace labels compact to
   * "Local" / "Remote".
   */
  compactModeLabel: string;
  /** Host display name, if available. Null when the host has no name. */
  hostLabel: string | null;
  id: string;
  /** "local" for the user's machine, "remote" for other hosts. */
  location: "local" | "remote";
  mode: "direct" | "worktree";
  workspaceDisplayKind: EnvironmentWorkspaceDisplayKind;
}

interface FormatEnvironmentDisplayArgs {
  environment: Environment;
  isLocalHost: boolean;
  hostName?: string;
}

/**
 * Format an environment for display across app, CLI, and prompt labels.
 */
export function formatEnvironmentDisplay({
  environment,
  isLocalHost,
  hostName,
}: FormatEnvironmentDisplayArgs): EnvironmentDisplayInfo {
  const mode: EnvironmentDisplayInfo["mode"] = environment.isWorktree
    ? "worktree"
    : "direct";
  const workspaceDisplayKind = resolveEnvironmentWorkspaceDisplayKind({
    environment: {
      isWorktree: environment.isWorktree,
      workspaceProvisionType: environment.workspaceProvisionType,
    },
  });

  // While the workspace is still being provisioned, discovered properties such
  // as `isWorktree` are not yet populated, so the mode is not yet knowable.
  // Report the lifecycle state honestly instead of guessing "Working locally".
  const generatedModeLabel =
    environment.status === "provisioning"
      ? "Provisioning"
      : mode === "worktree"
        ? "Worktree"
        : isLocalHost
          ? "Working locally"
          : "Working remotely";
  const generatedCompactModeLabel =
    environment.status === "provisioning"
      ? "Provisioning"
      : mode === "worktree"
        ? "Worktree"
        : isLocalHost
          ? "Local"
          : "Remote";
  const modeLabel = environment.name ?? generatedModeLabel;
  const compactModeLabel = environment.name ?? generatedCompactModeLabel;

  const location: EnvironmentDisplayInfo["location"] = isLocalHost
    ? "local"
    : "remote";

  return {
    modeLabel,
    compactModeLabel,
    hostLabel: hostName ?? null,
    id: environment.id,
    location,
    mode,
    workspaceDisplayKind,
  };
}
