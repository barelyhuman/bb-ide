import { useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Thread, ThreadQueuedMessage } from "@bb/domain";
import type {
  CreateDraftRequest,
  CreateThreadRequest,
  ProjectResponse,
  SendDraftResponse,
  SendMessageRequest,
  UpdateThreadRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { wsManager } from "@/lib/ws";
import {
  environmentGitDiffQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentWorkStatusQueryKeyPrefix,
  optimisticallyInsertThread,
  projectsQueryKey,
  statusQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDraftsQueryKey,
  threadQueryKey,
  threadStorageFilesQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadTimelineQueryKeyPrefix,
  threadsQueryKey,
  updateCachedThread,
  useApiClient,
} from "../queries/shared";

interface ThreadMutationRequest {
  id: string;
}

interface SendThreadMessageMutationRequest extends SendMessageRequest {
  id: string;
}

interface CreateThreadDraftMutationRequest extends CreateDraftRequest {
  id: string;
}

interface SendThreadDraftMutationRequest {
  id: string;
  queuedMessageId: string;
}

interface DeleteThreadDraftMutationRequest {
  id: string;
  queuedMessageId: string;
}

interface ArchiveThreadMutationRequest {
  id: string;
  force: boolean;
}

interface DeleteThreadMutationContext {
  previousThread: Thread | undefined;
  previousThreadLists: Array<readonly [readonly unknown[], Thread[] | undefined]>;
  previousProjects: ProjectResponse[] | undefined;
  environmentId: string | null | undefined;
}

interface ArchiveThreadMutationContext {
  previousThread: Thread | undefined;
  previousThreadLists: Array<readonly [readonly unknown[], Thread[] | undefined]>;
}

function removeThreadScopedQueries(queryClient: QueryClient, threadId: string): void {
  queryClient.removeQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.removeQueries({ queryKey: threadTimelineQueryKeyPrefix(threadId) });
  queryClient.removeQueries({ queryKey: threadDefaultExecutionOptionsQueryKey(threadId) });
  queryClient.removeQueries({ queryKey: threadDraftsQueryKey(threadId) });
  queryClient.removeQueries({ queryKey: threadStorageFilesQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadStorageFilePreviewQueryKeyPrefix(threadId),
  });
}

function removeEnvironmentScopedQueries(
  queryClient: QueryClient,
  environmentId: string | null | undefined,
): void {
  if (!environmentId) {
    return;
  }

  queryClient.removeQueries({
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentGitDiffQueryKeyPrefix(environmentId),
  });
  queryClient.removeQueries({
    queryKey: environmentMergeBaseBranchesQueryKeyPrefix(environmentId),
  });
}

function restoreThreadLists(
  queryClient: QueryClient,
  threadLists: Array<readonly [readonly unknown[], Thread[] | undefined]>,
): void {
  for (const [queryKey, data] of threadLists) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function useCreateThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: (request: CreateThreadRequest) => api.createThread(request),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<Thread>(threadQueryKey(thread.id), thread);
      optimisticallyInsertThread(queryClient, thread);

      void queryClient.refetchQueries({
        queryKey: threadsQueryKey(),
        type: "active",
      });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useSendThreadMessage() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
      model,
      serviceTier,
      reasoningLevel,
      sandboxMode,
      mode,
    }: SendThreadMessageMutationRequest) =>
      api.sendThreadMessage(id, {
        input,
        model,
        serviceTier,
        reasoningLevel,
        sandboxMode,
        mode,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(variables.id) });

      const previousThread = queryClient.getQueryData<Thread>(threadQueryKey(variables.id));
      const optimisticCreatedAt = Date.now();

      updateCachedThread(queryClient, variables.id, (thread) => ({
        ...thread,
        status: "active",
        updatedAt: Math.max(thread.updatedAt, optimisticCreatedAt),
      }));

      return {
        previousThread,
      };
    },
    onError: (_error, variables, context) => {
      if (!context?.previousThread) {
        return;
      }

      queryClient.setQueryData<Thread>(threadQueryKey(variables.id), context.previousThread);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: threadDefaultExecutionOptionsQueryKey(variables.id),
      });
      if (wsManager.getConnectionState() !== "connected") {
        queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
        queryClient.invalidateQueries({
          queryKey: threadTimelineQueryKeyPrefix(variables.id),
        });
        queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: statusQueryKey() });
      }
    },
  });
}

export function useCreateThreadDraft() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({
      id,
      input,
      model,
      serviceTier,
      reasoningLevel,
      sandboxMode,
    }: CreateThreadDraftMutationRequest): Promise<ThreadQueuedMessage> =>
      api.createThreadDraft(id, {
        input,
        model,
        serviceTier,
        reasoningLevel,
        sandboxMode,
      }),
    onSuccess: (_queuedMessage, variables) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadDraftsQueryKey(variables.id) });
    },
  });
}

export function useSendThreadDraft() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({
      id,
      queuedMessageId,
    }: SendThreadDraftMutationRequest): Promise<SendDraftResponse> =>
      api.sendThreadDraft(id, queuedMessageId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadDraftsQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadTimelineQueryKeyPrefix(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useDeleteThreadDraft() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({
      id,
      queuedMessageId,
    }: DeleteThreadDraftMutationRequest) => api.deleteThreadDraft(id, queuedMessageId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadDraftsQueryKey(variables.id) });
    },
  });
}

export function useStopThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: (threadId: string) => api.stopThread(threadId),
    onSuccess: (_data, threadId) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useUpdateThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({ id, ...request }: ThreadMutationRequest & UpdateThreadRequest) =>
      api.updateThread(id, request),
    onSuccess: (thread) => {
      queryClient.setQueryData<Thread>(threadQueryKey(thread.id), thread);
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useArchiveThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({ id, force }: ArchiveThreadMutationRequest) =>
      api.archiveThread(id, { force }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<Thread>(threadQueryKey(id));
      const previousThreadLists = queryClient.getQueriesData<Thread[]>({
        queryKey: threadsQueryKey(),
      });
      const archivedAt = Date.now();

      queryClient.setQueryData<Thread>(threadQueryKey(id), (thread) => {
        if (!thread) {
          return thread;
        }

        return {
          ...thread,
          archivedAt,
        };
      });

      for (const [queryKey, list] of previousThreadLists) {
        if (!list) {
          continue;
        }

        queryClient.setQueryData<Thread[]>(
          queryKey,
          list.filter((thread) => thread.id !== id),
        );
      }

      return { previousThread, previousThreadLists };
    },
    onError: (_error, variables, context?: ArchiveThreadMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(threadQueryKey(variables.id), context.previousThread);
      restoreThreadLists(queryClient, context.previousThreadLists);
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useUnarchiveThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({ id }: ThreadMutationRequest) => api.unarchiveThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });

      const previousThread = queryClient.getQueryData<Thread>(threadQueryKey(id));
      const previousThreadLists = queryClient.getQueriesData<Thread[]>({
        queryKey: threadsQueryKey(),
      });

      queryClient.setQueryData<Thread>(threadQueryKey(id), (thread) => {
        if (!thread) {
          return thread;
        }

        return {
          ...thread,
          archivedAt: null,
        };
      });

      for (const [queryKey, list] of previousThreadLists) {
        if (!list) {
          continue;
        }

        queryClient.setQueryData<Thread[]>(
          queryKey,
          list.map((thread) =>
            thread.id === id
              ? {
                  ...thread,
                  archivedAt: null,
                }
              : thread,
          ),
        );
      }

      return { previousThread, previousThreadLists };
    },
    onError: (_error, variables, context?: ArchiveThreadMutationContext) => {
      if (!context) {
        return;
      }

      queryClient.setQueryData(threadQueryKey(variables.id), context.previousThread);
      restoreThreadLists(queryClient, context.previousThreadLists);
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: threadQueryKey(variables.id) });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useDeleteThread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({ id }: ThreadMutationRequest) => api.deleteThread(id),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: threadQueryKey(id) });
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
      await queryClient.cancelQueries({ queryKey: projectsQueryKey() });

      const previousThread = queryClient.getQueryData<Thread>(threadQueryKey(id));
      const previousThreadLists = queryClient.getQueriesData<Thread[]>({
        queryKey: threadsQueryKey(),
      });
      const previousProjects = queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
      const environmentId = previousThread?.environmentId;

      removeThreadScopedQueries(queryClient, id);
      removeEnvironmentScopedQueries(queryClient, environmentId);

      for (const [queryKey, list] of previousThreadLists) {
        if (!list) {
          continue;
        }

        queryClient.setQueryData<Thread[]>(
          queryKey,
          list.filter((thread) => thread.id !== id),
        );
      }

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

      queryClient.setQueryData(threadQueryKey(variables.id), context.previousThread);
      restoreThreadLists(queryClient, context.previousThreadLists);
      queryClient.setQueryData(projectsQueryKey(), context.previousProjects);
    },
    onSettled: (_data, _error, variables, context) => {
      removeThreadScopedQueries(queryClient, variables.id);
      removeEnvironmentScopedQueries(queryClient, context?.environmentId);
      queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      queryClient.invalidateQueries({ queryKey: statusQueryKey() });
    },
  });
}

export function useMarkThreadRead() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: (threadId: string) => api.markThreadRead(threadId),
    onSuccess: (thread) => {
      queryClient.setQueryData<Thread>(threadQueryKey(thread.id), thread);
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
    },
  });
}

export function useMarkThreadUnread() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: (threadId: string) => api.markThreadUnread(threadId),
    onSuccess: (thread) => {
      queryClient.setQueryData<Thread>(threadQueryKey(thread.id), thread);
      queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
    },
  });
}
