import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { BaseBranchSpec, CreateThreadRequest } from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";

export interface ProjectMainSelectedBranch {
  name: string;
  isNew: boolean;
}

export interface ResolveProjectMainThreadEnvironmentArgs {
  environmentValue: string;
  projectId: string | undefined;
  selectedBranch: ProjectMainSelectedBranch | null;
}

interface ResolveManagedBaseBranchArgs {
  selectedBranch: ProjectMainSelectedBranch | null;
}

function resolveManagedBaseBranch(
  args: ResolveManagedBaseBranchArgs,
): BaseBranchSpec {
  if (!args.selectedBranch) {
    return { kind: "default" };
  }

  return { kind: "named", name: args.selectedBranch.name };
}

export function resolveProjectMainThreadEnvironment(
  args: ResolveProjectMainThreadEnvironmentArgs,
): CreateThreadRequest["environment"] | null {
  if (!args.projectId) return null;
  const parsed = parseEnvironmentValue(args.environmentValue);
  if (!parsed) return null;

  if (parsed.type === "reuse") {
    // Bare reuse value (mode picked but no worktree chosen yet) is an
    // incomplete state — submit is disabled by returning null.
    if (parsed.environmentId === null) return null;
    return { type: "reuse", environmentId: parsed.environmentId };
  }

  if (parsed.type === "host") {
    if (args.projectId === PERSONAL_PROJECT_ID) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: { type: "personal" },
      };
    }

    if (parsed.mode === "worktree") {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: resolveManagedBaseBranch(args),
        },
      };
    }

    if (args.selectedBranch?.isNew) {
      return {
        type: "host",
        hostId: parsed.hostId,
        workspace: {
          type: "unmanaged",
          path: null,
          branch: {
            kind: "new",
            baseBranch: args.selectedBranch.name,
          },
        },
      };
    }

    return {
      type: "host",
      hostId: parsed.hostId,
      workspace: {
        type: "unmanaged",
        path: null,
        ...(args.selectedBranch
          ? {
              branch: {
                kind: "existing",
                name: args.selectedBranch.name,
              },
            }
          : {}),
      },
    };
  }

  return null;
}
