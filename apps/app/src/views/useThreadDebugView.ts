import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadType } from "@bb/domain";
import {
  useThreadManagerWorkspaceFile,
  useThreadManagerWorkspaceFiles,
} from "../hooks/useApi";

const MANAGER_DEBUG_VIEW_STORAGE_KEY_PREFIX = "thread-manager-debug-view:";

interface UseThreadDebugViewParams {
  threadId?: string;
  threadType?: ThreadType;
}

type DebugViewToggleHandler = (checked: boolean) => void;

function getManagerDebugViewStorageKey(threadId: string) {
  return `${MANAGER_DEBUG_VIEW_STORAGE_KEY_PREFIX}${threadId}`;
}

export function useThreadDebugView({
  threadId,
  threadType,
}: UseThreadDebugViewParams) {
  const isManagerThread = threadType === "manager";
  const [showManagerDebugView, setShowManagerDebugView] = useState(false);
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
      setShowManagerDebugView(false);
      return;
    }

    const rawValue = window.localStorage.getItem(
      getManagerDebugViewStorageKey(threadId),
    );
    setShowManagerDebugView(rawValue === "true");
  }, [isManagerThread, threadId]);

  const handleManagerDebugViewChange: DebugViewToggleHandler = useCallback(
    (checked) => {
      setShowManagerDebugView(checked);
      if (typeof window === "undefined" || !threadId || !isManagerThread) {
        return;
      }

      const storageKey = getManagerDebugViewStorageKey(threadId);
      if (checked) {
        window.localStorage.setItem(storageKey, "true");
        return;
      }

      window.localStorage.removeItem(storageKey);
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
    handleManagerDebugViewChange,
    isManagerThread,
    isManagerWorkspaceFileLoading,
    managerWorkspaceFile,
    managerWorkspaceFileError,
    managerWorkspaceFiles,
    selectedManagerWorkspacePath,
    setSelectedManagerWorkspacePath,
    showManagerDebugView,
  };
}
