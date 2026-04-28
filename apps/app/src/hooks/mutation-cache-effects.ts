import {
  localPathExistenceQueryKeyPrefix,
  projectFilesQueryKeyPrefix,
  projectsQueryKey,
  statusQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDraftsQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadsQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadStorageFilesQueryKey,
  threadTimelineQueryKeyPrefix,
} from "./queries/query-keys";
import type {
  ProjectArg,
  QueryClientArg,
  ThreadArg,
} from "./cache-effect-types";
import {
  invalidatePrimaryCheckoutWorkspaceStateQueries,
  removeEnvironmentScopedQueries,
} from "./environment-cache-effects";

export function invalidateProjectListQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
}

export function invalidateProjectUpdateQueries({
  projectId,
  queryClient,
}: ProjectArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  queryClient.invalidateQueries({
    queryKey: projectFilesQueryKeyPrefix(projectId),
  });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
}

export function invalidateProjectDeleteQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateProjectSourceQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  queryClient.invalidateQueries({
    queryKey: localPathExistenceQueryKeyPrefix(),
  });
}

export function refetchThreadListsAfterComposerThreadCreate({
  queryClient,
}: QueryClientArg): void {
  void queryClient.refetchQueries({
    queryKey: threadsQueryKey(),
    type: "active",
  });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateProjectManagerHireQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  invalidateBackgroundThreadCreateQueries({ queryClient });
}

export function invalidateThreadListAndStatusQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateThreadListMembershipQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateThreadDeleteQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateThreadReadStateQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
}

export function invalidateThreadQueueQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.invalidateQueries({ queryKey: threadDraftsQueryKey(threadId) });
}

export function invalidateThreadDraftSendQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateThreadQueueQueries({ queryClient, threadId });
  queryClient.invalidateQueries({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
  invalidatePrimaryCheckoutWorkspaceStateQueries({ queryClient });
}

export function invalidateThreadAcceptedMessageQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
  invalidatePrimaryCheckoutWorkspaceStateQueries({ queryClient });
}

export function invalidateThreadAcceptedMessageQueriesWithoutRealtime({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateThreadAcceptedMessageQueries({ queryClient, threadId });
  queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.invalidateQueries({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateThreadStopQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function invalidateThreadPendingInteractionResolutionQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({
    queryKey: threadPendingInteractionsQueryKey(threadId),
  });
  queryClient.invalidateQueries({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });
  queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}

export function removeThreadScopedQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.removeQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
  queryClient.removeQueries({ queryKey: threadDraftsQueryKey(threadId) });
  queryClient.removeQueries({ queryKey: threadStorageFilesQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadStorageFilePreviewQueryKeyPrefix(threadId),
  });
}

export { removeEnvironmentScopedQueries };

function invalidateBackgroundThreadCreateQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: statusQueryKey() });
}
