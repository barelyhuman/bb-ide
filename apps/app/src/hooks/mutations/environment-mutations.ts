import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Environment, ThreadWithRuntime } from "@bb/domain";
import type {
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import type { RequestEnvironmentActionMutationRequest } from "./mutation-request-types";
import {
  invalidateEnvironmentActionQueries,
  invalidateEnvironmentWorkspaceStateQueries,
} from "../cache-effects";
import {
  environmentQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  restoreCachedThreadLists,
  snapshotCachedThreadLists,
  type CachedThreadListSnapshot,
} from "../queries/thread-list-cache-data";
type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

interface ArchiveEnvironmentThreadsMutationRequest {
  id: string;
}

interface CachedThreadSnapshot {
  id: string;
  thread: ThreadWithRuntime | undefined;
}

interface ArchiveEnvironmentThreadsMutationContext {
  archivedThreadIds: string[];
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

interface EnvironmentThreadCacheArgs {
  environmentId: string;
  queryClient: QueryClient;
}

interface OptimisticallyArchiveThreadsArgs {
  queryClient: QueryClient;
  threadIds: readonly string[];
}

function getCachedLiveThreadIdsForEnvironment({
  environmentId,
  queryClient,
}: EnvironmentThreadCacheArgs): string[] {
  const threadIds = new Set<string>();
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (
        thread.environmentId === environmentId &&
        thread.archivedAt === null
      ) {
        threadIds.add(thread.id);
      }
    }
  }
  return Array.from(threadIds);
}

function removeEnvironmentThreadsFromLists({
  environmentId,
  queryClient,
}: EnvironmentThreadCacheArgs): void {
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) =>
      list.filter(
        (thread) =>
          thread.environmentId !== environmentId || thread.archivedAt !== null,
      ),
  });
}

function optimisticallyArchiveThreads({
  queryClient,
  threadIds,
}: OptimisticallyArchiveThreadsArgs): void {
  const archivedAt = Date.now();
  for (const threadId of threadIds) {
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey(threadId),
      (thread) => {
        if (!thread) {
          return thread;
        }
        return { ...thread, archivedAt };
      },
    );
  }
}

export function useRequestEnvironmentAction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to run environment action.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      ...request
    }: RequestEnvironmentActionMutationRequest): Promise<EnvironmentActionResponse> =>
      api.requestEnvironmentAction(id, request),
    onSuccess: (_response, variables) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
    },
  });
}

export function useArchiveEnvironmentThreads() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive worktree threads.",
    },
    mutationFn: ({
      id,
    }: ArchiveEnvironmentThreadsMutationRequest): Promise<EnvironmentArchiveThreadsResponse> =>
      api.archiveEnvironmentThreads(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
      const archivedThreadIds = getCachedLiveThreadIdsForEnvironment({
        environmentId: id,
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
      const previousThreads = archivedThreadIds.map((threadId) => ({
        id: threadId,
        thread: queryClient.getQueryData<ThreadWithRuntime>(
          threadQueryKey(threadId),
        ),
      }));

      optimisticallyArchiveThreads({
        queryClient,
        threadIds: archivedThreadIds,
      });
      removeEnvironmentThreadsFromLists({ environmentId: id, queryClient });

      return {
        archivedThreadIds,
        previousThreadLists,
        previousThreads,
      };
    },
    onError: (
      _error,
      _variables,
      context?: ArchiveEnvironmentThreadsMutationContext,
    ) => {
      if (!context) {
        return;
      }

      restoreCachedThreadLists(queryClient, context.previousThreadLists);
      for (const snapshot of context.previousThreads) {
        queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
      }
    },
    onSettled: (data, _error, variables, context) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      for (const threadId of data?.archivedThreadIds ??
        context?.archivedThreadIds ??
        []) {
        queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
      }
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update environment.",
      showErrorToast: false,
    },
    mutationFn: ({ id, ...request }: UpdateEnvironmentMutationRequest) =>
      api.updateEnvironment(id, request),
    onSuccess: (environment: Environment) => {
      queryClient.setQueryData<Environment>(
        environmentQueryKey(environment.id),
        environment,
      );
      invalidateEnvironmentWorkspaceStateQueries({
        environmentId: environment.id,
        queryClient,
      });
    },
  });
}
