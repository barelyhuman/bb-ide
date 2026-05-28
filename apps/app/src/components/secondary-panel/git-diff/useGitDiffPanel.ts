import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [mergeBaseBranchSearchQuery, setMergeBaseBranchSearchQuery] =
    useState("");
  const requestedMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;

  const {
    data: mergeBaseBranches,
    isFetching: isLoadingMergeBaseBranchOptions,
  } = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    // Branch options are only needed once the picker can open or the diff
    // panel is visible; initial thread load can use the persisted/default base.
    enabled:
      Boolean(environmentId) &&
      (mergeBaseBranchOptionsEnabled || activeSecondaryPanel === "git-diff"),
    query: mergeBaseBranchSearchQuery,
    selectedBranch: requestedMergeBaseBranch,
  });
  const selectedMergeBaseBranchRef = mergeBaseBranches?.selectedBranch;
  const mergeBaseBranchOptions = useMemo(() => {
    const branches = mergeBaseBranches?.branches ?? [];
    return selectedMergeBaseBranchRef?.kind === "local" &&
      !branches.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...branches]
      : branches;
  }, [mergeBaseBranches?.branches, selectedMergeBaseBranchRef]);
  const mergeBaseRemoteBranchOptions = useMemo(() => {
    const branches = mergeBaseBranches?.remoteBranches ?? [];
    return selectedMergeBaseBranchRef?.kind === "remote" &&
      !branches.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...branches]
      : branches;
  }, [mergeBaseBranches?.remoteBranches, selectedMergeBaseBranchRef]);
  const mergeBaseBranchOptionsTruncated = Boolean(
    mergeBaseBranches?.branchesTruncated ||
    mergeBaseBranches?.remoteBranchesTruncated,
  );

  useEffect(() => {
    setSelectedMergeBaseBranch(undefined);
    setMergeBaseBranchSearchQuery("");
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
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);

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
    mergeBaseBranchOptionsTruncated,
    mergeBaseRemoteBranchOptions,
    openDiffFile,
    openThreadDiffPanel,
    openThreadSecondaryPanel,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  };
}
