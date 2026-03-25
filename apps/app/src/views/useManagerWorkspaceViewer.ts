import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadType } from "@bb/domain";
import {
  useThreadManagerWorkspaceFile,
  useThreadManagerWorkspaceFiles,
} from "../hooks/useApi";

const LEGACY_MANAGER_DEBUG_VIEW_STORAGE_KEY_PREFIX = "thread-manager-debug-view:";
const MANAGER_WORKSPACE_VIEWER_STORAGE_KEY_PREFIX = "thread-manager-workspace-viewer:";

interface UseManagerWorkspaceViewerParams {
  threadId?: string;
  threadType?: ThreadType;
}

type ManagerWorkspaceViewerToggleHandler = (checked: boolean) => void;

function getManagerWorkspaceViewerStorageKey(threadId: string) {
  return `${MANAGER_WORKSPACE_VIEWER_STORAGE_KEY_PREFIX}${threadId}`;
}

function getLegacyManagerWorkspaceViewerStorageKey(threadId: string) {
  return `${LEGACY_MANAGER_DEBUG_VIEW_STORAGE_KEY_PREFIX}${threadId}`;
}

export function useManagerWorkspaceViewer({
  threadId,
  threadType,
}: UseManagerWorkspaceViewerParams) {
  const isManagerThread = threadType === "manager";
  const [showManagerWorkspaceViewer, setShowManagerWorkspaceViewer] = useState(false);
  const [selectedManagerWorkspacePath, setSelectedManagerWorkspacePath] =
    useState<string | null>(null);
  const { data: managerWorkspaceFiles } = useThreadManagerWorkspaceFiles(
    threadId ?? "",
    {
      enabled: isManagerThread,
    },
  );
  const effectiveManagerWorkspacePath = useMemo(() => {
    if (!isManagerThread) {
      return null;
    }

    return selectedManagerWorkspacePath ?? managerWorkspaceFiles?.files?.[0]?.path ?? null;
  }, [isManagerThread, managerWorkspaceFiles?.files, selectedManagerWorkspacePath]);
  const {
    data: managerWorkspaceFile,
    isLoading: isManagerWorkspaceFileLoading,
    error: managerWorkspaceFileError,
  } = useThreadManagerWorkspaceFile(threadId ?? "", effectiveManagerWorkspacePath, {
    enabled: isManagerThread && effectiveManagerWorkspacePath !== null,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!threadId || !isManagerThread) {
      setShowManagerWorkspaceViewer(false);
      return;
    }

    const rawValue =
      window.localStorage.getItem(getManagerWorkspaceViewerStorageKey(threadId)) ??
      window.localStorage.getItem(getLegacyManagerWorkspaceViewerStorageKey(threadId));
    setShowManagerWorkspaceViewer(rawValue === "true");
  }, [isManagerThread, threadId]);

  const handleManagerWorkspaceViewerChange: ManagerWorkspaceViewerToggleHandler = useCallback(
    (checked) => {
      setShowManagerWorkspaceViewer(checked);
      if (typeof window === "undefined" || !threadId || !isManagerThread) {
        return;
      }

      const storageKey = getManagerWorkspaceViewerStorageKey(threadId);
      const legacyStorageKey = getLegacyManagerWorkspaceViewerStorageKey(threadId);
      if (checked) {
        window.localStorage.setItem(storageKey, "true");
        window.localStorage.removeItem(legacyStorageKey);
        return;
      }

      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(legacyStorageKey);
    },
    [isManagerThread, threadId],
  );

  useEffect(() => {
    if (!isManagerThread) {
      setSelectedManagerWorkspacePath(null);
      return;
    }

    const files = managerWorkspaceFiles?.files ?? [];
    if (files.length === 0) {
      setSelectedManagerWorkspacePath(null);
      return;
    }

    setSelectedManagerWorkspacePath((currentPath) =>
      currentPath && files.some((file) => file.path === currentPath)
        ? currentPath
        : null,
    );
  }, [isManagerThread, managerWorkspaceFiles?.files]);

  return {
    effectiveManagerWorkspacePath,
    handleManagerWorkspaceViewerChange,
    isManagerThread,
    isManagerWorkspaceFileLoading,
    managerWorkspaceFile,
    managerWorkspaceFileError,
    managerWorkspaceFiles,
    selectedManagerWorkspacePath,
    setSelectedManagerWorkspacePath,
    showManagerWorkspaceViewer,
  };
}
