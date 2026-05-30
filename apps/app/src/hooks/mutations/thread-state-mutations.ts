import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ManagerArchiveThreadsResponse,
  ProjectResponse,
  ReorderPinnedThreadRequest,
  UpdateThreadRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import type { LifecycleErrorOperation } from "@/lib/lifecycle-errors";
import {
  invalidateThreadDeleteQueries,
  invalidateThreadListMembershipQueries,
  invalidateThreadListQueries,
  removeEnvironmentScopedQueries,
  removeThreadScopedQueries,
} from "../cache-effects";
import {
  projectsQueryKey,
  sidebarBootstrapQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import {
  applyToCachedSidebarBootstrapThreads,
  restoreCachedSidebarBootstrap,
  snapshotCachedSidebarBootstrap,
  type CachedSidebarBootstrapSnapshot,
} from "../queries/query-cache";
import {
  applyToCachedThreadLists,
  restoreCachedThreadLists,
  snapshotCachedThreadLists,
  type CachedThreadListSnapshot,
} from "../queries/thread-list-cache-data";
import {
  getCachedLiveThreadIdsMatching,
  getCachedThreadSnapshots,
  optimisticallyArchiveThreads,
  removeLiveThreadsFromCachedLists,
  type CachedThreadSnapshot,
} from "./thread-archive-cache";

interface ThreadMutationRequest {
  id: string;
}

type UpdateThreadMutationRequest = ThreadMutationRequest & UpdateThreadRequest;
type ReorderPinnedThreadMutationRequest = ThreadMutationRequest &
  ReorderPinnedThreadRequest;

interface UpdateThreadMutationOptions {
  errorMessage?: string | undefined;
  lifecycleOperation?: LifecycleErrorOperation | undefined;
}

interface ArchiveThreadMutationRequest {
  id: string;
}

interface ArchiveManagerThreadsMutationRequest {
  id: string;
}

interface DeleteThreadMutationRequest {
  id: string;
  managerChildThreadsConfirmed: boolean;
}

interface DeleteThreadMutationContext {
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
  previousProjects: ProjectResponse[] | undefined;
  environmentId: string | null | undefined;
}

interface ThreadListMutationContext {
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
}

interface PinnedThreadOrderMutationContext {
  previousThreadLists: CachedThreadListSnapshot;
}

interface ArchiveManagerThreadsMutationContext {
  archivedThreadIds: string[];
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

interface UpdateThreadInListsArgs {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
}

interface UpdateThreadPinStateInListsArgs extends UpdateThreadInListsArgs {
  pinSortKey: string | null;
}

interface ApplyPinnedRootResponseToListsArgs {
  orderedRoots: readonly ThreadListEntry[];
  queryClient: QueryClient;
}

interface ApplyOptimisticPinnedRootOrderArgs {
  queryClient: QueryClient;
  request: ReorderPinnedThreadMutationRequest;
}

function removeThreadFromLists(queryClient: QueryClient, id: string): void {
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) => list.filter((thread) => thread.id !== id),
  });
}

function updateThreadInLists({
  queryClient,
  thread,
}: UpdateThreadInListsArgs): void {
  const updateThread = (list: ThreadListEntry[]) =>
    list.map((candidate) =>
      candidate.id === thread.id ? { ...candidate, ...thread } : candidate,
    );
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: updateThread,
  });
  applyToCachedSidebarBootstrapThreads({
    queryClient,
    mapper: updateThread,
  });
}

function updateThreadPinStateInLists({
  pinSortKey,
  queryClient,
  thread,
}: UpdateThreadPinStateInListsArgs): void {
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) =>
      list.map((candidate) =>
        candidate.id === thread.id
          ? { ...candidate, ...thread, pinSortKey }
          : candidate,
      ),
  });
}

function applyPinnedRootResponseToLists({
  orderedRoots,
  queryClient,
}: ApplyPinnedRootResponseToListsArgs): void {
  const rootsById = new Map(orderedRoots.map((thread) => [thread.id, thread]));
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) =>
      list.map((candidate) => rootsById.get(candidate.id) ?? candidate),
  });
}

function applyOptimisticPinnedRootOrder({
  queryClient,
  request,
}: ApplyOptimisticPinnedRootOrderArgs): void {
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) => {
      const pinnedRoots = list.filter(
        (thread) => thread.pinnedAt !== null && thread.pinSortKey !== null,
      );
      const reorderedRoots = applyNeighborReorder({
        items: pinnedRoots,
        request: {
          itemId: request.id,
          previousItemId: request.previousThreadId,
          nextItemId: request.nextThreadId,
        },
      });
      const reorderedRootKeysById = new Map(
        reorderedRoots.map((thread, index) => [
          thread.id,
          pinnedRoots[index]?.pinSortKey ?? thread.pinSortKey,
        ]),
      );
      return list.map((thread) => {
        const pinSortKey = reorderedRootKeysById.get(thread.id);
        return pinSortKey === undefined ? thread : { ...thread, pinSortKey };
      });
    },
  });
}

export function useUpdateThread(options?: UpdateThreadMutationOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: options?.errorMessage ?? "Failed to update thread.",
      ...(options?.lifecycleOperation
        ? { lifecycleOperation: options.lifecycleOperation }
        : {}),
    },
    mutationFn: ({ id, ...request }: UpdateThreadMutationRequest) =>
      api.updateThread(id, request),
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      invalidateThreadListQueries({ queryClient });
    },
  });
}

export function usePinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to pin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.pinThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
      );
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });
      const pinnedAt = Date.now();

      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
        (thread) => {
          if (!thread) {
            return thread;
          }

          return {
            ...thread,
            pinnedAt,
          };
        },
      );
      applyToCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
        mapper: (list) =>
          list.map((thread) =>
            thread.id === id
              ? { ...thread, pinnedAt, pinSortKey: null }
              : thread,
          ),
      });

      return {
        previousThread,
        previousThreadLists,
      };
    },
    onError: (_error, variables, context?: ThreadListMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(
        threadQueryKey(variables.id),
        context.previousThread,
      );
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      updateThreadPinStateInLists({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useUnpinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to unpin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.unpinThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
      );
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });

      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
        (thread) => {
          if (!thread) {
            return thread;
          }

          return {
            ...thread,
            pinnedAt: null,
          };
        },
      );
      applyToCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
        mapper: (list) =>
          list.map((thread) =>
            thread.id === id
              ? { ...thread, pinnedAt: null, pinSortKey: null }
              : thread,
          ),
      });

      return {
        previousThread,
        previousThreadLists,
      };
    },
    onError: (_error, variables, context?: ThreadListMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(
        threadQueryKey(variables.id),
        context.previousThread,
      );
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      updateThreadPinStateInLists({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useReorderPinnedThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder pinned threads.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      previousThreadId,
      nextThreadId,
    }: ReorderPinnedThreadMutationRequest) =>
      api.reorderPinnedThread(id, {
        previousThreadId,
        nextThreadId,
      }),
    onMutate: async (request): Promise<PinnedThreadOrderMutationContext> => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });
      applyOptimisticPinnedRootOrder({ queryClient, request });
      return { previousThreadLists };
    },
    onError: (_error, _variables, context) => {
      if (!context) {
        return;
      }
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
      invalidateThreadListQueries({ queryClient });
    },
    onSuccess: (orderedRoots) => {
      applyPinnedRootResponseToLists({ orderedRoots, queryClient });
    },
    onSettled: () => {
      invalidateThreadListQueries({ queryClient });
    },
  });
}

export function useArchiveThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive thread.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({ id }: ArchiveThreadMutationRequest) => api.archiveThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
      );
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });

      const archivedAt = Date.now();

      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
        (thread) => {
          if (!thread) {
            return thread;
          }

          return {
            ...thread,
            archivedAt,
          };
        },
      );

      removeThreadFromLists(queryClient, id);

      return {
        previousThread,
        previousThreadLists,
      };
    },
    onError: (_error, variables, context?: ThreadListMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(
        threadQueryKey(variables.id),
        context.previousThread,
      );
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
    },
    onSettled: (_data, _error, variables) => {
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useArchiveManagerThreads() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive manager threads.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
    }: ArchiveManagerThreadsMutationRequest): Promise<ManagerArchiveThreadsResponse> =>
      api.archiveManagerThreads(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
      const archivedThreadIds = getCachedLiveThreadIdsMatching({
        matchesThread: (thread) =>
          thread.id === id || thread.parentThreadId === id,
        queryClient,
      });
      await Promise.all(
        archivedThreadIds.map((threadId) =>
          queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) }),
        ),
      );

      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });
      const previousSidebarBootstrap =
        snapshotCachedSidebarBootstrap(queryClient);
      const previousThreads = getCachedThreadSnapshots({
        queryClient,
        threadIds: archivedThreadIds,
      });

      optimisticallyArchiveThreads({
        queryClient,
        threadIds: archivedThreadIds,
      });
      removeLiveThreadsFromCachedLists({
        matchesThread: (thread) =>
          thread.id === id || thread.parentThreadId === id,
        queryClient,
      });

      return {
        archivedThreadIds,
        previousSidebarBootstrap,
        previousThreadLists,
        previousThreads,
      };
    },
    onError: (
      _error,
      _variables,
      context?: ArchiveManagerThreadsMutationContext,
    ) => {
      if (!context) {
        return;
      }

      restoreCachedThreadLists(queryClient, context.previousThreadLists);
      restoreCachedSidebarBootstrap(
        queryClient,
        context.previousSidebarBootstrap,
      );
      for (const snapshot of context.previousThreads) {
        queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
      }
    },
    onSettled: (data, _error, _variables, context) => {
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: sidebarBootstrapQueryKey() });
      for (const threadId of data?.archivedThreadIds ??
        context?.archivedThreadIds ??
        []) {
        queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
      }
    },
  });
}

export function useUnarchiveThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to unarchive thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) => api.unarchiveThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
      );
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });

      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
        (thread) => {
          if (!thread) {
            return thread;
          }

          return {
            ...thread,
            archivedAt: null,
          };
        },
      );

      removeThreadFromLists(queryClient, id);

      return {
        previousThread,
        previousThreadLists,
      };
    },
    onError: (_error, variables, context?: ThreadListMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(
        threadQueryKey(variables.id),
        context.previousThread,
      );
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
    },
    onSettled: (_data, _error, variables) => {
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to delete thread.",
    },
    mutationFn: ({
      id,
      managerChildThreadsConfirmed,
    }: DeleteThreadMutationRequest) =>
      api.deleteThread(id, { managerChildThreadsConfirmed }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
      await queryClient.cancelQueries({ queryKey: projectsQueryKey() });

      const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
      );
      const previousThreadLists = snapshotCachedThreadLists(queryClient, {
        queryKey: threadsQueryKey(),
      });
      const previousProjects =
        queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
      const environmentId = previousThread?.environmentId;

      removeThreadScopedQueries({ queryClient, threadId: id });
      removeEnvironmentScopedQueries({ environmentId, queryClient });

      removeThreadFromLists(queryClient, id);

      return {
        previousThread,
        previousThreadLists,
        previousProjects,
        environmentId,
      };
    },
    onError: (_error, variables, context?: DeleteThreadMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(
        threadQueryKey(variables.id),
        context.previousThread,
      );
      restoreCachedThreadLists(queryClient, context.previousThreadLists);
      queryClient.setQueryData(projectsQueryKey(), context.previousProjects);
    },
    onSettled: (_data, _error, variables, context) => {
      removeThreadScopedQueries({ queryClient, threadId: variables.id });
      removeEnvironmentScopedQueries({
        environmentId: context?.environmentId,
        queryClient,
      });
      invalidateThreadDeleteQueries({ queryClient });
    },
  });
}

export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread read.",
      showErrorToast: false,
    },
    mutationFn: (threadId: string) => api.markThreadRead(threadId),
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      updateThreadInLists({ queryClient, thread });
    },
  });
}

export function useMarkThreadUnread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread unread.",
      showErrorToast: false,
    },
    mutationFn: (threadId: string) => api.markThreadUnread(threadId),
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      updateThreadInLists({ queryClient, thread });
    },
  });
}
