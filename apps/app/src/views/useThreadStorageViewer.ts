import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadType } from "@bb/domain";
import {
  useThreadStorageFilePreview,
  useThreadStorageFiles,
} from "../hooks/useApi";

const THREAD_STORAGE_VIEWER_STORAGE_KEY_PREFIX = "thread-storage-viewer:";

interface UseThreadStorageViewerParams {
  threadId?: string;
  threadType?: ThreadType;
}

type ThreadStorageViewerToggleHandler = (checked: boolean) => void;

function getThreadStorageViewerStorageKey(threadId: string) {
  return `${THREAD_STORAGE_VIEWER_STORAGE_KEY_PREFIX}${threadId}`;
}

export function useThreadStorageViewer({
  threadId,
  threadType,
}: UseThreadStorageViewerParams) {
  const isManagerThread = threadType === "manager";
  const [showThreadStorageViewer, setShowThreadStorageViewer] = useState(false);
  const [selectedThreadStoragePath, setSelectedThreadStoragePath] =
    useState<string | null>(null);
  const { data: threadStorageFiles } = useThreadStorageFiles(
    threadId ?? "",
    {
      enabled: isManagerThread,
    },
  );
  const effectiveThreadStoragePath = useMemo(() => {
    if (!isManagerThread) {
      return null;
    }

    return selectedThreadStoragePath ?? threadStorageFiles?.files?.[0]?.path ?? null;
  }, [isManagerThread, threadStorageFiles?.files, selectedThreadStoragePath]);
  const {
    data: threadStorageFilePreview,
    isLoading: isThreadStorageFilePreviewLoading,
    error: threadStorageFilePreviewError,
  } = useThreadStorageFilePreview(threadId ?? "", effectiveThreadStoragePath, {
    enabled: isManagerThread && effectiveThreadStoragePath !== null,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!threadId || !isManagerThread) {
      setShowThreadStorageViewer(false);
      return;
    }

    const rawValue = window.localStorage.getItem(
      getThreadStorageViewerStorageKey(threadId),
    );
    setShowThreadStorageViewer(rawValue === "true");
  }, [isManagerThread, threadId]);

  const handleThreadStorageViewerChange: ThreadStorageViewerToggleHandler = useCallback(
    (checked) => {
      setShowThreadStorageViewer(checked);
      if (typeof window === "undefined" || !threadId || !isManagerThread) {
        return;
      }

      const storageKey = getThreadStorageViewerStorageKey(threadId);
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
      setSelectedThreadStoragePath(null);
      return;
    }

    const files = threadStorageFiles?.files ?? [];
    if (files.length === 0) {
      setSelectedThreadStoragePath(null);
      return;
    }

    setSelectedThreadStoragePath((currentPath) =>
      currentPath && files.some((file) => file.path === currentPath)
        ? currentPath
        : null,
    );
  }, [isManagerThread, threadStorageFiles?.files]);

  return {
    effectiveThreadStoragePath,
    handleThreadStorageViewerChange,
    isManagerThread,
    isThreadStorageFilePreviewLoading,
    threadStorageFilePreview,
    threadStorageFilePreviewError,
    threadStorageFiles,
    selectedThreadStoragePath,
    setSelectedThreadStoragePath,
    showThreadStorageViewer,
  };
}
