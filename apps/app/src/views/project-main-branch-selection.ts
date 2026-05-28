import { useCallback, useMemo, useState } from "react";
import type { ProjectMainSelectedBranch } from "./project-main-thread-environment";

interface BranchSelectionScope {
  environmentValue: string;
  projectId: string;
}

interface BranchSelectionScopeArgs {
  environmentValue: string;
  projectId: string | undefined;
}

interface ScopedSelectedBranch {
  branch: ProjectMainSelectedBranch;
  scope: BranchSelectionScope;
}

export type UseScopedBranchSelectionArgs = BranchSelectionScopeArgs;

export interface UseScopedBranchSelectionResult {
  onBranchChange: (name: string) => void;
  onClearBranch: () => void;
  onCreateBranch: (currentBranch: string | null) => void;
  onCreateBranchFrom: (name: string) => void;
  selectedBranch: ProjectMainSelectedBranch | null;
}

function resolveBranchSelectionScope(
  args: BranchSelectionScopeArgs,
): BranchSelectionScope | null {
  if (!args.projectId || !args.environmentValue) {
    return null;
  }

  return {
    environmentValue: args.environmentValue,
    projectId: args.projectId,
  };
}

function matchesBranchSelectionScope(
  left: BranchSelectionScope | undefined,
  right: BranchSelectionScope | null,
) {
  return (
    left !== undefined &&
    right !== null &&
    left.projectId === right.projectId &&
    left.environmentValue === right.environmentValue
  );
}

export function useScopedBranchSelection(
  args: UseScopedBranchSelectionArgs,
): UseScopedBranchSelectionResult {
  const [selectedBranchState, setSelectedBranchState] =
    useState<ScopedSelectedBranch | null>(null);
  const scope = useMemo(
    () =>
      resolveBranchSelectionScope({
        environmentValue: args.environmentValue,
        projectId: args.projectId,
      }),
    [args.environmentValue, args.projectId],
  );
  const selectedBranch =
    selectedBranchState !== null &&
    matchesBranchSelectionScope(selectedBranchState.scope, scope)
      ? selectedBranchState.branch
      : null;

  const onBranchChange = useCallback(
    (name: string) => {
      if (!scope) {
        return;
      }

      setSelectedBranchState({
        scope,
        branch: {
          name,
          isNew: false,
        },
      });
    },
    [scope],
  );

  const onCreateBranch = useCallback(
    (currentBranch: string | null) => {
      if (!scope) {
        return;
      }

      setSelectedBranchState((previous) => {
        const scopedPrevious = matchesBranchSelectionScope(
          previous?.scope,
          scope,
        )
          ? previous?.branch
          : null;
        const branchName = scopedPrevious?.name ?? currentBranch;
        if (!branchName) {
          return matchesBranchSelectionScope(previous?.scope, scope)
            ? null
            : previous;
        }

        return {
          scope,
          branch: {
            name: branchName,
            isNew: true,
          },
        };
      });
    },
    [scope],
  );

  const onCreateBranchFrom = useCallback(
    (name: string) => {
      if (!scope) {
        return;
      }

      setSelectedBranchState({
        scope,
        branch: { name, isNew: true },
      });
    },
    [scope],
  );

  const onClearBranch = useCallback(() => {
    if (!scope) {
      return;
    }

    setSelectedBranchState((previous) =>
      matchesBranchSelectionScope(previous?.scope, scope) ? null : previous,
    );
  }, [scope]);

  return {
    onBranchChange,
    onClearBranch,
    onCreateBranch,
    onCreateBranchFrom,
    selectedBranch,
  };
}
