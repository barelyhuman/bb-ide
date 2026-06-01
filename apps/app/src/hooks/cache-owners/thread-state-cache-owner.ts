import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ManagerArchiveThreadsResponse,
  ProjectResponse,
  ReorderPinnedThreadRequest,
} from "@bb/server-contract";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import {
  projectsQueryKey,
  sidebarBootstrapQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import { removeEnvironmentScopedQueries } from "./environment-cache-effects";
import {
  invalidateThreadDeleteQueries,
  invalidateThreadListMembershipQueries,
  invalidateThreadListQueries,
  removeThreadScopedQueries,
} from "./mutation-cache-effects";
import {
  applyToCachedSidebarBootstrapThreads,
  restoreCachedSidebarBootstrap,
  snapshotCachedSidebarBootstrap,
  type CachedSidebarBootstrapSnapshot,
} from "./query-cache";
import {
  applyToCachedThreadLists,
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

interface ThreadIdCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface ThreadRuntimeCacheArgs {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
}

interface ThreadPinSuccessArgs extends ThreadRuntimeCacheArgs {
  pinSortKey: string | null;
}

interface BeginThreadPinTransactionArgs extends ThreadIdCacheArgs {
  pinnedAt: number;
}

interface ReorderPinnedThreadTransactionRequest
  extends ReorderPinnedThreadRequest {
  id: string;
}

interface ReorderPinnedThreadTransactionArgs {
  queryClient: QueryClient;
  request: ReorderPinnedThreadTransactionRequest;
}

interface PinnedRootResponseArgs {
  orderedRoots: readonly ThreadListEntry[];
  queryClient: QueryClient;
}

interface RollbackThreadListMutationTransactionArgs extends ThreadIdCacheArgs {
  transaction: ThreadListMutationTransaction | undefined;
}

interface RollbackPinnedThreadOrderTransactionArgs {
  queryClient: QueryClient;
  transaction: PinnedThreadOrderTransaction | undefined;
}

interface SettleReorderPinnedThreadTransactionArgs {
  queryClient: QueryClient;
}

interface ArchiveManagerThreadsTransactionArgs {
  managerThreadId: string;
  queryClient: QueryClient;
}

interface RollbackArchiveThreadsTransactionArgs {
  queryClient: QueryClient;
  transaction: ArchiveThreadsTransaction | undefined;
}

interface SettleArchiveThreadsTransactionArgs {
  queryClient: QueryClient;
  response: ManagerArchiveThreadsResponse | undefined;
  transaction: ArchiveThreadsTransaction | undefined;
}

interface DeleteThreadTransactionArgs extends ThreadIdCacheArgs {}

interface RollbackDeleteThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: DeleteThreadTransaction | undefined;
}

interface SettleDeleteThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: DeleteThreadTransaction | undefined;
}

export interface ThreadListMutationTransaction {
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
}

export interface PinnedThreadOrderTransaction {
  previousThreadLists: CachedThreadListSnapshot;
}

export interface ArchiveThreadsTransaction {
  archivedThreadIds: string[];
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

export interface DeleteThreadTransaction {
  environmentId: string | null | undefined;
  previousProjects: ProjectResponse[] | undefined;
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
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
}: ThreadRuntimeCacheArgs): void {
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
}: ThreadPinSuccessArgs): void {
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
}: PinnedRootResponseArgs): void {
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
}: ReorderPinnedThreadTransactionArgs): void {
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

export function applyThreadUpdateResult({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(threadQueryKey(thread.id), thread);
  invalidateThreadListQueries({ queryClient });
}

export async function beginPinThreadTransaction({
  pinnedAt,
  queryClient,
  threadId,
}: BeginThreadPinTransactionArgs): Promise<ThreadListMutationTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
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
        thread.id === threadId
          ? { ...thread, pinnedAt, pinSortKey: null }
          : thread,
      ),
  });

  return {
    previousThread,
    previousThreadLists,
  };
}

export async function beginUnpinThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
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
        thread.id === threadId
          ? { ...thread, pinnedAt: null, pinSortKey: null }
          : thread,
      ),
  });

  return {
    previousThread,
    previousThreadLists,
  };
}

export function rollbackThreadListMutationTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackThreadListMutationTransactionArgs): void {
  if (!transaction) {
    return;
  }

  queryClient.setQueryData(threadQueryKey(threadId), transaction.previousThread);
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
}

export function applyThreadPinStateResult({
  pinSortKey,
  queryClient,
  thread,
}: ThreadPinSuccessArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(threadQueryKey(thread.id), thread);
  updateThreadPinStateInLists({ queryClient, thread, pinSortKey });
}

export function settleThreadListMembershipMutation({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadListMembershipQueries({ queryClient, threadId });
}

export async function beginReorderPinnedThreadTransaction({
  queryClient,
  request,
}: ReorderPinnedThreadTransactionArgs): Promise<PinnedThreadOrderTransaction> {
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  applyOptimisticPinnedRootOrder({ queryClient, request });
  return { previousThreadLists };
}

export function rollbackReorderPinnedThreadTransaction({
  queryClient,
  transaction,
}: RollbackPinnedThreadOrderTransactionArgs): void {
  if (!transaction) {
    return;
  }
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  invalidateThreadListQueries({ queryClient });
}

export function applyReorderPinnedThreadResult({
  orderedRoots,
  queryClient,
}: PinnedRootResponseArgs): void {
  applyPinnedRootResponseToLists({ orderedRoots, queryClient });
}

export function settleReorderPinnedThreadTransaction({
  queryClient,
}: SettleReorderPinnedThreadTransactionArgs): void {
  invalidateThreadListQueries({ queryClient });
}

export async function beginArchiveThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const archivedAt = Date.now();

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
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

  removeThreadFromLists(queryClient, threadId);

  return {
    previousThread,
    previousThreadLists,
  };
}

export async function beginUnarchiveThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
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

  removeThreadFromLists(queryClient, threadId);

  return {
    previousThread,
    previousThreadLists,
  };
}

export async function beginArchiveManagerThreadsTransaction({
  managerThreadId,
  queryClient,
}: ArchiveManagerThreadsTransactionArgs): Promise<ArchiveThreadsTransaction> {
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  const archivedThreadIds = getCachedLiveThreadIdsMatching({
    matchesThread: (thread) =>
      thread.id === managerThreadId ||
      thread.parentThreadId === managerThreadId,
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
    matchesThread: (thread) =>
      thread.id === managerThreadId ||
      thread.parentThreadId === managerThreadId,
    queryClient,
  });

  return {
    archivedThreadIds,
    previousSidebarBootstrap,
    previousThreadLists,
    previousThreads,
  };
}

export function rollbackArchiveThreadsTransaction({
  queryClient,
  transaction,
}: RollbackArchiveThreadsTransactionArgs): void {
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

export function settleArchiveThreadsTransaction({
  queryClient,
  response,
  transaction,
}: SettleArchiveThreadsTransactionArgs): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: sidebarBootstrapQueryKey() });
  for (const threadId of response?.archivedThreadIds ??
    transaction?.archivedThreadIds ??
    []) {
    queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  }
}

export async function beginDeleteThreadTransaction({
  queryClient,
  threadId,
}: DeleteThreadTransactionArgs): Promise<DeleteThreadTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: projectsQueryKey() });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousProjects =
    queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
  const environmentId = previousThread?.environmentId;

  removeThreadScopedQueries({ queryClient, threadId });
  removeEnvironmentScopedQueries({ environmentId, queryClient });
  removeThreadFromLists(queryClient, threadId);

  return {
    environmentId,
    previousThread,
    previousThreadLists,
    previousProjects,
  };
}

export function rollbackDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackDeleteThreadTransactionArgs): void {
  if (!transaction) {
    return;
  }

  queryClient.setQueryData(threadQueryKey(threadId), transaction.previousThread);
  restoreCachedThreadLists(queryClient, transaction.previousThreadLists);
  queryClient.setQueryData(projectsQueryKey(), transaction.previousProjects);
}

export function settleDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: SettleDeleteThreadTransactionArgs): void {
  removeThreadScopedQueries({ queryClient, threadId });
  removeEnvironmentScopedQueries({
    environmentId: transaction?.environmentId,
    queryClient,
  });
  invalidateThreadDeleteQueries({ queryClient });
}

export function applyThreadReadStateResult({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(threadQueryKey(thread.id), thread);
  updateThreadInLists({ queryClient, thread });
}
