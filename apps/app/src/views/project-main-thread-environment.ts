import type { BaseBranchSpec, CreateThreadRequest } from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";

export interface ProjectMainSelectedBranch {
  name: string;
  isNew: boolean;
}

export interface ResolveProjectMainThreadEnvironmentArgs {
  environmentValue: string;
  projectId: string | undefined;
  resolvedDefaultBranch: string | null;
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

  if (parsed.type === "host") {
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
          branch: { kind: "new" },
        },
      };
    }

    const branchName = args.selectedBranch?.name ?? args.resolvedDefaultBranch;
    return {
      type: "host",
      hostId: parsed.hostId,
      workspace: {
        type: "unmanaged",
        path: null,
        ...(branchName
          ? { branch: { kind: "existing", name: branchName } }
          : {}),
      },
    };
  }

  if (parsed.type === "sandbox") {
    return {
      type: "sandbox-host",
      sandboxType: parsed.backendId,
      baseBranch: resolveManagedBaseBranch(args),
    };
  }

  return null;
}
