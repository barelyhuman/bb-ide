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
  SIDEBAR_BOOTSTRAP_QUERY_KEY,
  THREADS_DISABLED_QUERY_KEY,
  THREADS_QUERY_KEY,
  sidebarBootstrapQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";
import {
  optimisticallyInsertThread,
  restoreCachedSidebarBootstrap,
  snapshotCachedSidebarBootstrap,
  type CachedSidebarBootstrapSnapshot,
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

interface ReorderProjectManagerTransactionRequest
  extends ReorderManagerThreadRequest {
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
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

export interface ReorderProjectManagerTransaction {
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadList: ThreadListResponse | undefined;
}

export const threadListCacheOwner = {
  id: "thread-list",
  ownedQueryRoots: [
    THREADS_QUERY_KEY,
    THREADS_DISABLED_QUERY_KEY,
    SIDEBAR_BOOTSTRAP_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "thread", kind: "thread-created" },
    { entity: "thread", kind: "thread-deleted" },
    { entity: "thread", kind: "status-changed" },
    { entity: "thread", kind: "title-changed" },
    { entity: "thread", kind: "archived-changed" },
    { entity: "thread", kind: "pin-state-changed" },
    { entity: "thread", kind: "parent-changed" },
    { entity: "thread", kind: "read-state-changed" },
    { entity: "thread", kind: "manager-assignment-changed" },
    { entity: "thread", kind: "order-changed" },
    { entity: "project", kind: "project-created" },
    { entity: "project", kind: "project-updated" },
    { entity: "project", kind: "project-deleted" },
    { entity: "project", kind: "threads-changed" },
    { entity: "project", kind: "project-order-changed" },
  ],
  bootstrapPolicy:
    "Owns sidebar bootstrap and thread-list ingestion, including project thread membership projections.",
  deletionBehavior:
    "Removes deleted threads from list/sidebar projections and marks remote deletes for route reconciliation.",
  reconnectBehavior:
    "Refreshes list and sidebar projections after reconnect.",
} satisfies CacheOwnerDescriptor;

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

function replaceSidebarBootstrapProjectThreads(
  bootstrap: NonNullable<CachedSidebarBootstrapSnapshot>,
  projectId: string,
  threads: ThreadListResponse,
): NonNullable<CachedSidebarBootstrapSnapshot> {
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
    projects: bootstrap.projects.map(replaceThreads),
    personalProject: replaceThreads(bootstrap.personalProject),
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
  const previousSidebarBootstrap =
    queryClient.getQueryData<NonNullable<CachedSidebarBootstrapSnapshot>>(
      sidebarBootstrapQueryKey(),
    );

  void queryClient.cancelQueries({ queryKey: threadListKey }, { revert: false });
  void queryClient.cancelQueries(
    { queryKey: sidebarBootstrapQueryKey() },
    { revert: false },
  );
  queryClient.setQueryData<ThreadListResponse>(
    threadListKey,
    (currentThreads) =>
      currentThreads
        ? applyManagerThreadReorderToThreadList(currentThreads, request)
        : currentThreads,
  );
  queryClient.setQueryData<NonNullable<CachedSidebarBootstrapSnapshot>>(
    sidebarBootstrapQueryKey(),
    (currentBootstrap) => {
      if (!currentBootstrap) {
        return currentBootstrap;
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
        projects: currentBootstrap.projects.map(reorderProjectManagers),
        personalProject: reorderProjectManagers(
          currentBootstrap.personalProject,
        ),
      };
    },
  );

  return { previousThreadList, previousSidebarBootstrap };
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
    sidebarBootstrapQueryKey(),
    transaction?.previousSidebarBootstrap,
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
  queryClient.setQueryData<NonNullable<CachedSidebarBootstrapSnapshot>>(
    sidebarBootstrapQueryKey(),
    (currentBootstrap) =>
      currentBootstrap
        ? replaceSidebarBootstrapProjectThreads(
            currentBootstrap,
            projectId,
            threads,
          )
        : currentBootstrap,
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
  const previousSidebarBootstrap = snapshotCachedSidebarBootstrap(queryClient);
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
    previousSidebarBootstrap,
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
  restoreCachedSidebarBootstrap(
    queryClient,
    transaction.previousSidebarBootstrap,
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
  queryClient.invalidateQueries({ queryKey: sidebarBootstrapQueryKey() });
  for (const threadId of response?.archivedThreadIds ??
    transaction?.archivedThreadIds ??
    []) {
    queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  }
}
