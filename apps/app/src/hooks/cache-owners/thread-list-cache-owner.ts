import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  EnvironmentArchiveThreadsResponse,
  ProjectWithThreadsResponse,
  ReorderManagerThreadRequest,
  ThreadListResponse,
} from "@bb/server-contract";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import {
  optimisticallyInsertThread,
  restoreCachedSidebarNavigation,
  snapshotCachedSidebarNavigation,
  type CachedSidebarNavigationSnapshot,
} from "./query-cache";
import { invalidateThreadListQueries } from "./mutation-cache-effects";
import {
  restoreCachedThreadLists,
  snapshotCachedThreadLists,
  type CachedThreadListSnapshot,
} from "./thread-list-cache-data";
import {
  getCachedLiveThreadIdsMatching,
  getCachedThreadSnapshots,
  optimisticallyArchiveThreads,
  removeLiveThreadsFromCachedLists,
  type CachedThreadSnapshot,
} from "./thread-archive-cache";

interface ArchiveEnvironmentThreadsTransactionArgs {
  environmentId: string;
  queryClient: QueryClient;
}

interface RollbackArchiveEnvironmentThreadsTransactionArgs {
  queryClient: QueryClient;
  transaction: ArchiveEnvironmentThreadsTransaction | undefined;
}

interface SettleArchiveEnvironmentThreadsTransactionArgs {
  queryClient: QueryClient;
  response: EnvironmentArchiveThreadsResponse | undefined;
  transaction: ArchiveEnvironmentThreadsTransaction | undefined;
}

interface CreatedThreadCacheArgs {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
}

interface ReorderProjectManagerTransactionRequest extends ReorderManagerThreadRequest {
  projectId: string;
  threadId: string;
}

interface ReorderProjectManagerTransactionArgs {
  queryClient: QueryClient;
  request: ReorderProjectManagerTransactionRequest;
}

interface RollbackReorderProjectManagerTransactionArgs {
  queryClient: QueryClient;
  request: ReorderProjectManagerTransactionRequest;
  transaction: ReorderProjectManagerTransaction | undefined;
}

interface ApplyReorderProjectManagerResultArgs {
  projectId: string;
  queryClient: QueryClient;
  threads: ThreadListResponse;
}

export interface ArchiveEnvironmentThreadsTransaction {
  archivedThreadIds: string[];
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

export interface ReorderProjectManagerTransaction {
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreadList: ThreadListResponse | undefined;
}

function applyThreadListOrderToExistingThreads(
  currentThreads: readonly ThreadListEntry[],
  orderedThreads: readonly ThreadListEntry[],
): ThreadListResponse {
  const currentThreadsById = new Map(
    currentThreads.map((thread) => [thread.id, thread]),
  );
  return orderedThreads.map(
    (thread) => currentThreadsById.get(thread.id) ?? thread,
  );
}

function applyManagerThreadReorderToThreadList(
  threads: readonly ThreadListEntry[],
  request: ReorderProjectManagerTransactionRequest,
): ThreadListResponse {
  const managerThreads = threads.filter((thread) => thread.type === "manager");
  const reorderedManagers = applyNeighborReorder({
    items: managerThreads,
    request: {
      itemId: request.threadId,
      previousItemId: request.previousThreadId,
      nextItemId: request.nextThreadId,
    },
  });
  let managerIndex = 0;
  return threads.map((thread) => {
    if (thread.type !== "manager") {
      return thread;
    }
    const reorderedManager = reorderedManagers[managerIndex];
    managerIndex += 1;
    return reorderedManager ?? thread;
  });
}

function replaceSidebarNavigationProjectThreads(
  navigation: NonNullable<CachedSidebarNavigationSnapshot>,
  projectId: string,
  threads: ThreadListResponse,
): NonNullable<CachedSidebarNavigationSnapshot> {
  const replaceThreads = (
    project: ProjectWithThreadsResponse,
  ): ProjectWithThreadsResponse =>
    project.id === projectId
      ? {
          ...project,
          threads: applyThreadListOrderToExistingThreads(
            project.threads,
            threads,
          ),
        }
      : project;
  return {
    projects: navigation.projects.map(replaceThreads),
    personalProject: replaceThreads(navigation.personalProject),
  };
}

export function insertCreatedThreadIntoCachedLists({
  queryClient,
  thread,
}: CreatedThreadCacheArgs): void {
  optimisticallyInsertThread(queryClient, thread);
}

export function beginReorderProjectManagerTransaction({
  queryClient,
  request,
}: ReorderProjectManagerTransactionArgs): ReorderProjectManagerTransaction {
  const threadListKey = threadListQueryKey({
    projectId: request.projectId,
    archived: false,
  });
  const previousThreadList =
    queryClient.getQueryData<ThreadListResponse>(threadListKey);
  const previousSidebarNavigation = queryClient.getQueryData<
    NonNullable<CachedSidebarNavigationSnapshot>
  >(sidebarNavigationQueryKey());

  void queryClient.cancelQueries(
    { queryKey: threadListKey },
    { revert: false },
  );
  void queryClient.cancelQueries(
    { queryKey: sidebarNavigationQueryKey() },
    { revert: false },
  );
  queryClient.setQueryData<ThreadListResponse>(
    threadListKey,
    (currentThreads) =>
      currentThreads
        ? applyManagerThreadReorderToThreadList(currentThreads, request)
        : currentThreads,
  );
  queryClient.setQueryData<NonNullable<CachedSidebarNavigationSnapshot>>(
    sidebarNavigationQueryKey(),
    (currentNavigation) => {
      if (!currentNavigation) {
        return currentNavigation;
      }
      const reorderProjectManagers = (
        project: ProjectWithThreadsResponse,
      ): ProjectWithThreadsResponse =>
        project.id === request.projectId
          ? {
              ...project,
              threads: applyManagerThreadReorderToThreadList(
                project.threads,
                request,
              ),
            }
          : project;
      return {
        projects: currentNavigation.projects.map(reorderProjectManagers),
        personalProject: reorderProjectManagers(
          currentNavigation.personalProject,
        ),
      };
    },
  );

  return { previousThreadList, previousSidebarNavigation };
}

export function rollbackReorderProjectManagerTransaction({
  queryClient,
  request,
  transaction,
}: RollbackReorderProjectManagerTransactionArgs): void {
  const threadListKey = threadListQueryKey({
    projectId: request.projectId,
    archived: false,
  });
  queryClient.setQueryData(threadListKey, transaction?.previousThreadList);
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    transaction?.previousSidebarNavigation,
  );
  invalidateThreadListQueries({ queryClient });
}

export function applyReorderProjectManagerResult({
  projectId,
  queryClient,
  threads,
}: ApplyReorderProjectManagerResultArgs): void {
  const threadListKey = threadListQueryKey({
    projectId,
    archived: false,
  });
  queryClient.setQueryData<ThreadListResponse>(
    threadListKey,
    (currentThreads) =>
      currentThreads
        ? applyThreadListOrderToExistingThreads(currentThreads, threads)
        : threads,
  );
  queryClient.setQueryData<NonNullable<CachedSidebarNavigationSnapshot>>(
    sidebarNavigationQueryKey(),
    (currentNavigation) =>
      currentNavigation
        ? replaceSidebarNavigationProjectThreads(
            currentNavigation,
            projectId,
            threads,
          )
        : currentNavigation,
  );
}

export async function beginArchiveEnvironmentThreadsTransaction({
  environmentId,
  queryClient,
}: ArchiveEnvironmentThreadsTransactionArgs): Promise<ArchiveEnvironmentThreadsTransaction> {
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  const archivedThreadIds = getCachedLiveThreadIdsMatching({
    matchesThread: (thread) => thread.environmentId === environmentId,
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
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  const previousThreads = getCachedThreadSnapshots({
    queryClient,
    threadIds: archivedThreadIds,
  });

  optimisticallyArchiveThreads({
    queryClient,
    threadIds: archivedThreadIds,
  });
  removeLiveThreadsFromCachedLists({
    matchesThread: (thread) => thread.environmentId === environmentId,
    queryClient,
  });

  return {
    archivedThreadIds,
    previousSidebarNavigation,
    previousThreadLists,
    previousThreads,
  };
}

export function rollbackArchiveEnvironmentThreadsTransaction({
  queryClient,
  transaction,
}: RollbackArchiveEnvironmentThreadsTransactionArgs): void {
  if (!transaction) {
    return;
  }

  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  restoreCachedSidebarNavigation(
    queryClient,
    transaction.previousSidebarNavigation,
  );
  for (const snapshot of transaction.previousThreads) {
    queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
  }
}

export function settleArchiveEnvironmentThreadsTransaction({
  queryClient,
  response,
  transaction,
}: SettleArchiveEnvironmentThreadsTransactionArgs): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  for (const threadId of response?.archivedThreadIds ??
    transaction?.archivedThreadIds ??
    []) {
    queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  }
}
