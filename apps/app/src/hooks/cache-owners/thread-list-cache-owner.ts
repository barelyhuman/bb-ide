import type { QueryClient } from "@tanstack/react-query";
import {
  SIDEBAR_BOOTSTRAP_QUERY_KEY,
  THREADS_DISABLED_QUERY_KEY,
  THREADS_QUERY_KEY,
  sidebarBootstrapQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import type { EnvironmentArchiveThreadsResponse } from "@bb/server-contract";
import type { CacheOwnerDescriptor } from "./cache-owner-types";
import {
  restoreCachedSidebarBootstrap,
  snapshotCachedSidebarBootstrap,
  type CachedSidebarBootstrapSnapshot,
} from "./query-cache";
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

export interface ArchiveEnvironmentThreadsTransaction {
  archivedThreadIds: string[];
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
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
