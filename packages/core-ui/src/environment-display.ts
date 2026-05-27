import type { Environment, EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import { resolveEnvironmentWorkspaceDisplayKind } from "@bb/domain";

export interface EnvironmentDisplayInfo {
  /** Human-readable mode: "Working locally", "Working remotely", "Personal workspace", or "Worktree". */
  modeLabel: string;
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

  const modeLabel =
    environment.workspaceProvisionType === "personal"
      ? "Personal workspace"
      : mode === "worktree"
        ? "Worktree"
        : isLocalHost
          ? "Working locally"
          : "Working remotely";

  const location: EnvironmentDisplayInfo["location"] = isLocalHost
    ? "local"
    : "remote";

  return {
    modeLabel,
    hostLabel: hostName ?? null,
    id: environment.id,
    location,
    mode,
    workspaceDisplayKind,
  };
}
