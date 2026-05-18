import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEnvironmentMergeBaseBranches } from "../../../hooks/queries/environment-queries";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import {
  pendingGitDiffScrollPathAtom,
  selectedMergeBaseBranchAtom,
} from "../threadSecondaryPanelAtoms";

type ThreadSecondaryPanelSetter = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

interface UseGitDiffPanelParams {
  activeSecondaryPanel: ThreadSecondaryPanelTab | null;
  clearActiveFileTabs: () => void;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  mergeBaseBranchOptionsEnabled?: boolean;
  setThreadSecondaryPanel: ThreadSecondaryPanelSetter;
}

export function useGitDiffPanel({
  activeSecondaryPanel,
  clearActiveFileTabs,
  defaultMergeBaseBranch,
  environmentId,
  mergeBaseBranchOptionsEnabled = false,
  setThreadSecondaryPanel,
}: UseGitDiffPanelParams) {
  const selectedMergeBaseBranch = useAtomValue(selectedMergeBaseBranchAtom);
  const setSelectedMergeBaseBranch = useSetAtom(selectedMergeBaseBranchAtom);
  const setPendingGitDiffScrollPath = useSetAtom(pendingGitDiffScrollPathAtom);

  const {
    data: mergeBaseBranchOptions,
    isLoading: isLoadingMergeBaseBranchOptions,
  } = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    // Branch options are only needed once the picker can open or the diff
    // panel is visible; initial thread load can use the persisted/default base.
    enabled:
      Boolean(environmentId) &&
      (mergeBaseBranchOptionsEnabled || activeSecondaryPanel === "git-diff"),
  });

  useEffect(() => {
    setSelectedMergeBaseBranch(undefined);
  }, [environmentId, setSelectedMergeBaseBranch]);

  const openThreadSecondaryPanel = useCallback(
    (panel: ThreadSecondaryPanelTab) => {
      setThreadSecondaryPanel(panel);
    },
    [setThreadSecondaryPanel],
  );

  const openThreadDiffPanel = useCallback(() => {
    openThreadSecondaryPanel("git-diff");
  }, [openThreadSecondaryPanel]);

  const closeThreadSecondaryPanel = useCallback(() => {
    if (activeSecondaryPanel === null) {
      return;
    }
    setThreadSecondaryPanel(null);
  }, [activeSecondaryPanel, setThreadSecondaryPanel]);

  const openDiffFile = useCallback(
    (path: string) => {
      clearActiveFileTabs();
      setPendingGitDiffScrollPath(path);
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, openThreadDiffPanel, setPendingGitDiffScrollPath],
  );

  return {
    closeThreadSecondaryPanel,
    defaultMergeBaseBranch,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    openDiffFile,
    openThreadDiffPanel,
    openThreadSecondaryPanel,
    selectedMergeBaseBranch,
    setSelectedMergeBaseBranch,
  };
}
