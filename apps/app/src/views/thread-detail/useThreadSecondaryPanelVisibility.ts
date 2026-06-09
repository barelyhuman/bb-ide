import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";

type ThreadSecondaryPanelThreadId = string | undefined;

export type ThreadSecondaryPanelOpenHandler = (
  panel: ThreadSecondaryPanel,
) => void;
export type ThreadSecondaryPanelDiffFileOpenHandler = (path: string) => void;
export type ThreadSecondaryPanelCommitDiffOpenHandler = (sha: string) => void;

export interface UseThreadSecondaryPanelVisibilityArgs {
  closePersistedPanel: () => void;
  isCompactViewport: boolean;
  isPersistedOpen: boolean;
  openPersistedCommitDiff: ThreadSecondaryPanelCommitDiffOpenHandler;
  openPersistedDiffFile: ThreadSecondaryPanelDiffFileOpenHandler;
  openPersistedDiffPanel: () => void;
  openPersistedPanel: ThreadSecondaryPanelOpenHandler;
  threadId: ThreadSecondaryPanelThreadId;
  togglePersistedPanel: () => void;
}

export interface ThreadSecondaryPanelVisibility {
  closePanel: () => void;
  isOpen: boolean;
  openCommitDiff: ThreadSecondaryPanelCommitDiffOpenHandler;
  openDiffFile: ThreadSecondaryPanelDiffFileOpenHandler;
  openDiffPanel: () => void;
  openPanel: ThreadSecondaryPanelOpenHandler;
  togglePanel: () => void;
}

function hasThreadId(threadId: ThreadSecondaryPanelThreadId): threadId is string {
  return threadId !== undefined && threadId.length > 0;
}

export function useThreadSecondaryPanelVisibility({
  closePersistedPanel,
  isCompactViewport,
  isPersistedOpen,
  openPersistedCommitDiff,
  openPersistedDiffFile,
  openPersistedDiffPanel,
  openPersistedPanel,
  threadId,
  togglePersistedPanel,
}: UseThreadSecondaryPanelVisibilityArgs): ThreadSecondaryPanelVisibility {
  const [openDrawerThreadId, setOpenDrawerThreadId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setOpenDrawerThreadId(null);
  }, [threadId]);

  useEffect(() => {
    if (!isCompactViewport) {
      setOpenDrawerThreadId(null);
    }
  }, [isCompactViewport]);

  const openDrawerForCurrentThread = useCallback(() => {
    if (!hasThreadId(threadId)) {
      return;
    }
    setOpenDrawerThreadId(threadId);
  }, [threadId]);

  const closeDrawerForCurrentThread = useCallback(() => {
    setOpenDrawerThreadId((currentThreadId) =>
      currentThreadId === threadId ? null : currentThreadId,
    );
  }, [threadId]);

  const isDrawerVisible =
    hasThreadId(threadId) && openDrawerThreadId === threadId;
  const isOpen = isCompactViewport ? isDrawerVisible : isPersistedOpen;

  const openPanel = useCallback<ThreadSecondaryPanelOpenHandler>(
    (panel) => {
      openPersistedPanel(panel);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [isCompactViewport, openDrawerForCurrentThread, openPersistedPanel],
  );

  const openDiffPanel = useCallback(() => {
    openPersistedDiffPanel();
    if (isCompactViewport) {
      openDrawerForCurrentThread();
    }
  }, [isCompactViewport, openDrawerForCurrentThread, openPersistedDiffPanel]);

  const openDiffFile = useCallback<ThreadSecondaryPanelDiffFileOpenHandler>(
    (path) => {
      openPersistedDiffFile(path);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [isCompactViewport, openDrawerForCurrentThread, openPersistedDiffFile],
  );

  const openCommitDiff = useCallback<ThreadSecondaryPanelCommitDiffOpenHandler>(
    (sha) => {
      openPersistedCommitDiff(sha);
      if (isCompactViewport) {
        openDrawerForCurrentThread();
      }
    },
    [isCompactViewport, openDrawerForCurrentThread, openPersistedCommitDiff],
  );

  const closePanel = useCallback(() => {
    if (isCompactViewport) {
      closeDrawerForCurrentThread();
      return;
    }
    closePersistedPanel();
  }, [closeDrawerForCurrentThread, closePersistedPanel, isCompactViewport]);

  const togglePanel = useCallback(() => {
    if (!isCompactViewport) {
      togglePersistedPanel();
      return;
    }
    if (isDrawerVisible) {
      closeDrawerForCurrentThread();
      return;
    }
    openDrawerForCurrentThread();
  }, [
    closeDrawerForCurrentThread,
    isCompactViewport,
    isDrawerVisible,
    openDrawerForCurrentThread,
    togglePersistedPanel,
  ]);

  return useMemo(
    () => ({
      closePanel,
      isOpen,
      openCommitDiff,
      openDiffFile,
      openDiffPanel,
      openPanel,
      togglePanel,
    }),
    [
      closePanel,
      isOpen,
      openCommitDiff,
      openDiffFile,
      openDiffPanel,
      openPanel,
      togglePanel,
    ],
  );
}
