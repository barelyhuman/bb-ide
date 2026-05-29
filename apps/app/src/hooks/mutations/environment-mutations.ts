import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
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
  sidebarBootstrapQueryKey,
  threadQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import {
  restoreCachedSidebarBootstrap,
  snapshotCachedSidebarBootstrap,
  type CachedSidebarBootstrapSnapshot,
} from "../queries/query-cache";
import {
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
type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

interface ArchiveEnvironmentThreadsMutationRequest {
  id: string;
}

interface ArchiveEnvironmentThreadsMutationContext {
  archivedThreadIds: string[];
  previousSidebarBootstrap: CachedSidebarBootstrapSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
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
      const archivedThreadIds = getCachedLiveThreadIdsMatching({
        matchesThread: (thread) => thread.environmentId === id,
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
        matchesThread: (thread) => thread.environmentId === id,
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
      context?: ArchiveEnvironmentThreadsMutationContext,
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
    onSettled: (data, _error, variables, context) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
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
