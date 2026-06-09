import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast";
import type { Thread } from "@bb/domain";
import {
  useArchiveThread,
  useArchiveThreadAndChildren,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useUnarchiveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import { getThreadChildSummary } from "@/lib/api";
import { useAppRoute } from "@/hooks/useAppRoute";
import { useDialogState } from "@/hooks/useDialogState";
import {
  getMutationErrorMessage,
  shouldShowMutationErrorToast,
} from "@/lib/mutation-errors";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  ThreadRenameDialog,
  type ThreadRenameDialogTarget,
} from "@/components/dialogs/ThreadRenameDialog";
import {
  ThreadDeleteDialog,
  type ThreadDeleteDialogTarget,
} from "@/components/dialogs/ThreadDeleteDialog";
import { destroyPersistedBrowserViewsForThread } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getThreadReadToggleAction } from "@/components/sidebar/threadReadState";
import { getRootComposeRoutePath } from "@/lib/app-route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

export interface ThreadActionsContextValue {
  archiveAllChildren: (thread: Thread) => void;
  requestRename: (thread: Thread) => void;
  requestDelete: (thread: Thread) => void;
  toggleArchive: (thread: Thread) => void;
  togglePin: (thread: Thread) => void;
  toggleRead: (thread: Thread) => void;
}

const ThreadActionsContext = createContext<ThreadActionsContextValue | null>(
  null,
);

export function useThreadActions(): ThreadActionsContextValue {
  const value = useContext(ThreadActionsContext);
  if (!value) {
    throw new Error(
      "useThreadActions must be used within a <ThreadActionsProvider>",
    );
  }
  return value;
}

interface ThreadActionsProviderProps {
  children: ReactNode;
}

interface DeleteThreadActionRequest {
  childThreadsConfirmed: boolean;
  closeDialog: () => void;
  thread: Thread;
}

interface ThreadActionContext {
  childThreadCount: number;
}

function formatArchiveAllSuccessMessage(archivedThreadCount: number): string {
  if (archivedThreadCount <= 1) {
    return "Archived thread";
  }
  const childThreadCount = archivedThreadCount - 1;
  return childThreadCount === 1
    ? "Archived thread and 1 child thread"
    : `Archived thread and ${childThreadCount} child threads`;
}

export function ThreadActionsProvider({
  children,
}: ThreadActionsProviderProps) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const { threadId: viewedThreadId } = useAppRoute();
  const archiveThread = useArchiveThread();
  const archiveThreadAndChildren = useArchiveThreadAndChildren();
  const unarchiveThread = useUnarchiveThread();
  const markThreadRead = useMarkThreadRead();
  const markThreadUnread = useMarkThreadUnread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();
  const threadActionContextAbortRef = useRef<AbortController | null>(null);
  // Destructure `.mutate` so useCallback deps see stable references across
  // renders. Depending on the full mutation objects would churn callback
  // identities on every isPending flip and force every useThreadActions()
  // consumer to re-render whenever any mutation fires.
  const { mutate: archiveMutate } = archiveThread;
  const { mutate: archiveThreadAndChildrenMutate } = archiveThreadAndChildren;
  const { mutate: unarchiveMutate } = unarchiveThread;
  const { mutate: markReadMutate } = markThreadRead;
  const { mutate: markUnreadMutate } = markThreadUnread;
  const { mutate: pinMutate } = pinThread;
  const { mutate: unpinMutate } = unpinThread;
  const { mutate: deleteMutate } = deleteThread;
  const { mutate: updateMutate } = updateThread;

  const renameDialog = useDialogState<ThreadRenameDialogTarget>();
  const deleteDialog = useDialogState<ThreadDeleteDialogTarget>();

  const { onClose: closeRenameDialog, onOpen: openRenameDialog } = renameDialog;
  const { onClose: closeDeleteDialog, onOpen: openDeleteDialog } = deleteDialog;

  useEffect(() => {
    return () => {
      threadActionContextAbortRef.current?.abort();
      threadActionContextAbortRef.current = null;
    };
  }, []);

  const navigateAwayIfViewing = useCallback(
    (thread: Thread) => {
      if (viewedThreadId === thread.id) {
        setRootComposeProjectId(thread.projectId);
        // Push (not replace) so the back button still returns the user to the
        // archived/deleted thread's URL if they want to re-open it.
        navigate(getRootComposeRoutePath());
      }
    },
    [navigate, setRootComposeProjectId, viewedThreadId],
  );

  const requestRename = useCallback(
    (thread: Thread) => {
      openRenameDialog({
        id: thread.id,
        currentTitle: getThreadDisplayTitle(thread),
      });
    },
    [openRenameDialog],
  );

  const submitRename = useCallback(
    (threadId: string, title: string) => {
      updateMutate(
        { id: threadId, title },
        {
          onSuccess: () => {
            closeRenameDialog();
          },
        },
      );
    },
    [closeRenameDialog, updateMutate],
  );

  // Fetches the delete dialog context. Returns null when the caller's request
  // was superseded (a newer click aborted us) or the fetch errored; in the
  // error case, also surfaces a toast before returning.
  const loadThreadActionContext = useCallback(
    async (
      thread: Thread,
      signal: AbortSignal,
    ): Promise<ThreadActionContext | null> => {
      try {
        const childSummary = await getThreadChildSummary(thread.id, signal);
        if (signal.aborted) return null;

        return {
          childThreadCount: childSummary?.nonDeletedChildCount ?? 0,
        };
      } catch (error) {
        if (signal.aborted) return null;
        if (shouldShowMutationErrorToast(error)) {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to check thread state",
            }),
          );
        }
        return null;
      }
    },
    [],
  );

  const claimThreadActionContextAbortController =
    useCallback((): AbortController => {
      threadActionContextAbortRef.current?.abort();
      const controller = new AbortController();
      threadActionContextAbortRef.current = controller;
      return controller;
    }, []);

  function buildDialogTargetFromContext<T extends { thread: Thread }>(
    base: T,
    context: ThreadActionContext,
  ): T & { childThreadCount?: number } {
    return {
      ...base,
      ...(context.childThreadCount > 0
        ? { childThreadCount: context.childThreadCount }
        : {}),
    };
  }

  const performDelete = useCallback(
    ({
      childThreadsConfirmed,
      closeDialog,
      thread,
    }: DeleteThreadActionRequest) => {
      deleteMutate(
        { id: thread.id, childThreadsConfirmed },
        {
          onSuccess: () => {
            destroyPersistedBrowserViewsForThread({
              desktopBrowser: getDesktopBrowserApi(),
              threadId: thread.id,
            });
            closeDialog();
            navigateAwayIfViewing(thread);
          },
        },
      );
    },
    [deleteMutate, navigateAwayIfViewing],
  );

  const requestDelete = useCallback(
    async (thread: Thread) => {
      const controller = claimThreadActionContextAbortController();
      const context = await loadThreadActionContext(thread, controller.signal);
      if (context === null || controller.signal.aborted) return;
      if (threadActionContextAbortRef.current === controller) {
        threadActionContextAbortRef.current = null;
      }
      openDeleteDialog(buildDialogTargetFromContext({ thread }, context));
    },
    [
      claimThreadActionContextAbortController,
      loadThreadActionContext,
      openDeleteDialog,
    ],
  );

  const confirmDelete = useCallback(
    (target: ThreadDeleteDialogTarget) => {
      performDelete({
        childThreadsConfirmed: target.childThreadCount !== undefined,
        closeDialog: closeDeleteDialog,
        thread: target.thread,
      });
    },
    [closeDeleteDialog, performDelete],
  );

  const showArchiveError = useCallback((thread: Thread, error: Error) => {
    appToast.error(
      getMutationErrorMessage({
        error,
        fallbackMessage: "Failed to archive thread",
        lifecycleOperation: "archive_thread",
      }),
    );
  }, []);

  const archiveWithUndoToast = useCallback(
    (thread: Thread) => {
      archiveMutate(
        { id: thread.id },
        {
          onSuccess: () => {
            navigateAwayIfViewing(thread);
            appToast.success("Thread archived", {
              cancel: {
                label: "Undo",
                onClick: () => {
                  unarchiveMutate({ id: thread.id });
                },
              },
            });
          },
          onError: (error) => {
            showArchiveError(thread, error);
          },
        },
      );
    },
    [archiveMutate, navigateAwayIfViewing, showArchiveError, unarchiveMutate],
  );

  const toggleArchive = useCallback(
    (thread: Thread) => {
      if (thread.archivedAt != null) {
        unarchiveMutate({ id: thread.id });
        return;
      }
      archiveWithUndoToast(thread);
    },
    [archiveWithUndoToast, unarchiveMutate],
  );

  const archiveAllChildren = useCallback(
    (thread: Thread) => {
      archiveThreadAndChildrenMutate(
        { id: thread.id },
        {
          onSuccess: (response) => {
            if (
              viewedThreadId &&
              response.archivedThreadIds.includes(viewedThreadId)
            ) {
              setRootComposeProjectId(thread.projectId);
              navigate(getRootComposeRoutePath());
            }
            appToast.success(
              formatArchiveAllSuccessMessage(response.archivedThreadIds.length),
            );
          },
          onError: (error) => {
            appToast.error(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to archive thread and children",
                lifecycleOperation: "archive_thread",
              }),
            );
          },
        },
      );
    },
    [
      archiveThreadAndChildrenMutate,
      navigate,
      setRootComposeProjectId,
      viewedThreadId,
    ],
  );

  const toggleRead = useCallback(
    (thread: Thread) => {
      if (getThreadReadToggleAction(thread) === "mark_unread") {
        markUnreadMutate(thread.id, {
          onError: (error) => {
            appToast.error(
              getMutationErrorMessage({
                error,
                fallbackMessage: "Failed to mark thread unread",
              }),
            );
          },
        });
        return;
      }
      markReadMutate(thread.id, {
        onError: (error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to mark thread read",
            }),
          );
        },
      });
    },
    [markReadMutate, markUnreadMutate],
  );

  const togglePin = useCallback(
    (thread: Thread) => {
      if (thread.pinnedAt !== null) {
        unpinMutate({ id: thread.id });
        return;
      }
      pinMutate({ id: thread.id });
    },
    [pinMutate, unpinMutate],
  );

  const value = useMemo<ThreadActionsContextValue>(
    () => ({
      requestRename,
      requestDelete,
      archiveAllChildren,
      toggleArchive,
      togglePin,
      toggleRead,
    }),
    [
      archiveAllChildren,
      requestRename,
      requestDelete,
      toggleArchive,
      togglePin,
      toggleRead,
    ],
  );

  return (
    <ThreadActionsContext.Provider value={value}>
      {children}
      <ThreadRenameDialog
        target={renameDialog.target}
        pending={updateThread.isPending}
        onOpenChange={renameDialog.onOpenChange}
        onRename={submitRename}
      />
      <ThreadDeleteDialog
        target={deleteDialog.target}
        pending={deleteThread.isPending}
        onOpenChange={deleteDialog.onOpenChange}
        onDelete={confirmDelete}
      />
    </ThreadActionsContext.Provider>
  );
}
