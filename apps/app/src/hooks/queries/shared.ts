import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  PromptInput,
  Thread,
  ThreadGitDiffResponse,
  TimelineRow,
  WorkspaceStatus,
} from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadListFilters } from "@/lib/api";
import { collectPromptAttachments } from "@/lib/prompt-attachments";

const HOSTS_QUERY_KEY = "hosts";
const PROJECTS_QUERY_KEY = "projects";
const PROJECT_FILES_QUERY_KEY = "projectFiles";
const THREADS_QUERY_KEY = "threads";
const THREAD_QUERY_KEY = "thread";
const THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY = "threadDefaultExecutionOptions";
const THREAD_DRAFTS_QUERY_KEY = "threadDrafts";
const THREAD_STORAGE_FILES_QUERY_KEY = "threadStorageFiles";
const THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY = "threadStorageFilePreview";
const ENVIRONMENT_QUERY_KEY = "environment";
const ENVIRONMENT_WORK_STATUS_QUERY_KEY = "environmentWorkStatus";
const ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY = "environmentMergeBaseBranches";
const ENVIRONMENT_GIT_DIFF_QUERY_KEY = "environmentGitDiff";
const THREAD_TIMELINE_QUERY_KEY = "threadTimeline";
const AVAILABLE_MODELS_QUERY_KEY = "availableModels";
const SYSTEM_PROVIDERS_QUERY_KEY = "systemProviders";
const STATUS_QUERY_KEY = "status";

type ThreadScopedQueryKeyPrefix =
  | typeof THREAD_QUERY_KEY
  | typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY
  | typeof ENVIRONMENT_GIT_DIFF_QUERY_KEY
  | typeof THREAD_TIMELINE_QUERY_KEY
  | typeof THREAD_DRAFTS_QUERY_KEY;

export interface ThreadListQueryFilters {
  projectId?: string;
  type?: ThreadListFilters["type"];
  parentThreadId?: string;
  archived?: boolean;
}

export type HostsQueryKey = readonly [typeof HOSTS_QUERY_KEY];
export type ProjectsQueryKey = readonly [typeof PROJECTS_QUERY_KEY];
export type ProjectFilesQueryKey = readonly [
  typeof PROJECT_FILES_QUERY_KEY,
  string | undefined,
  string,
  number,
];
export type ProjectFilesQueryKeyPrefix = readonly [
  typeof PROJECT_FILES_QUERY_KEY,
  string,
];
export type ThreadsQueryKey = readonly [typeof THREADS_QUERY_KEY];
export type ThreadListQueryKey = readonly [typeof THREADS_QUERY_KEY, ThreadListQueryFilters?];
export type ThreadQueryKey = readonly [typeof THREAD_QUERY_KEY, string];
export type ThreadDefaultExecutionOptionsQueryKey = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];
export type ThreadDraftsQueryKey = readonly [typeof THREAD_DRAFTS_QUERY_KEY, string];
export type ThreadStorageFilesQueryKey = readonly [typeof THREAD_STORAGE_FILES_QUERY_KEY, string];
export type ThreadStorageFilePreviewQueryKey = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  string,
  string | null,
];
export type ThreadStorageFilePreviewQueryKeyPrefix = readonly [
  typeof THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  string,
];
export type EnvironmentQueryKey = readonly [typeof ENVIRONMENT_QUERY_KEY, string | null | undefined];
export type EnvironmentWorkStatusQueryKey = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string | null | undefined,
  string | null,
];
export type EnvironmentWorkStatusQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  string,
];
export type EnvironmentMergeBaseBranchesQueryKey = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
];
export type EnvironmentMergeBaseBranchesQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  string,
];
export type ThreadTimelineQueryKey = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
  string,
  boolean,
];
export type ThreadTimelineQueryKeyPrefix = readonly [
  typeof THREAD_TIMELINE_QUERY_KEY,
  string,
];
export type EnvironmentGitDiffQueryKey = readonly [
  typeof ENVIRONMENT_GIT_DIFF_QUERY_KEY,
  string,
  string | null,
  string | null,
];
export type EnvironmentGitDiffQueryKeyPrefix = readonly [
  typeof ENVIRONMENT_GIT_DIFF_QUERY_KEY,
  string,
];
export type AvailableModelsQueryKey = readonly [
  typeof AVAILABLE_MODELS_QUERY_KEY,
  string | null,
];
export type SystemProvidersQueryKey = readonly [typeof SYSTEM_PROVIDERS_QUERY_KEY];
export type StatusQueryKey = readonly [typeof STATUS_QUERY_KEY];

export interface EnvironmentActionInvalidationParams {
  environmentId: string;
}

export function useApiClient(): QueryClient {
  return useQueryClient();
}

export function hostsQueryKey(): HostsQueryKey {
  return [HOSTS_QUERY_KEY];
}

export function projectsQueryKey(): ProjectsQueryKey {
  return [PROJECTS_QUERY_KEY];
}

export function projectFilesQueryKey(
  projectId: string | undefined,
  query: string,
  limit: number,
): ProjectFilesQueryKey {
  return [PROJECT_FILES_QUERY_KEY, projectId, query, limit];
}

export function projectFilesQueryKeyPrefix(
  projectId: string,
): ProjectFilesQueryKeyPrefix {
  return [PROJECT_FILES_QUERY_KEY, projectId];
}

export function threadsQueryKey(): ThreadsQueryKey {
  return [THREADS_QUERY_KEY];
}

export function threadListQueryKey(filters?: ThreadListQueryFilters): ThreadListQueryKey {
  return filters ? [THREADS_QUERY_KEY, filters] : [THREADS_QUERY_KEY];
}

export function threadQueryKey(threadId: string): ThreadQueryKey {
  return [THREAD_QUERY_KEY, threadId];
}

export function threadDefaultExecutionOptionsQueryKey(
  threadId: string,
): ThreadDefaultExecutionOptionsQueryKey {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, threadId];
}

export function threadDraftsQueryKey(threadId: string): ThreadDraftsQueryKey {
  return [THREAD_DRAFTS_QUERY_KEY, threadId];
}

export function threadStorageFilesQueryKey(threadId: string): ThreadStorageFilesQueryKey {
  return [THREAD_STORAGE_FILES_QUERY_KEY, threadId];
}

export function threadStorageFilePreviewQueryKey(
  threadId: string,
  path: string | null,
): ThreadStorageFilePreviewQueryKey {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY, threadId, path];
}

export function threadStorageFilePreviewQueryKeyPrefix(
  threadId: string,
): ThreadStorageFilePreviewQueryKeyPrefix {
  return [THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY, threadId];
}

export function environmentQueryKey(
  environmentId: string | null | undefined,
): EnvironmentQueryKey {
  return [ENVIRONMENT_QUERY_KEY, environmentId];
}

export function environmentWorkStatusQueryKey(
  environmentId: string | null | undefined,
  mergeBaseBranch: string | null,
): EnvironmentWorkStatusQueryKey {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId, mergeBaseBranch];
}

export function environmentWorkStatusQueryKeyPrefix(
  environmentId: string,
): EnvironmentWorkStatusQueryKeyPrefix {
  return [ENVIRONMENT_WORK_STATUS_QUERY_KEY, environmentId];
}

export function environmentMergeBaseBranchesQueryKey(
  environmentId: string,
): EnvironmentMergeBaseBranchesQueryKey {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY, environmentId];
}

export function environmentMergeBaseBranchesQueryKeyPrefix(
  environmentId: string,
): EnvironmentMergeBaseBranchesQueryKeyPrefix {
  return [ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY, environmentId];
}

export function threadTimelineQueryKey(
  threadId: string,
  includeAllEvents: boolean,
): ThreadTimelineQueryKey {
  return [THREAD_TIMELINE_QUERY_KEY, threadId, includeAllEvents];
}

export function threadTimelineQueryKeyPrefix(
  threadId: string,
): ThreadTimelineQueryKeyPrefix {
  return [THREAD_TIMELINE_QUERY_KEY, threadId];
}

export function environmentGitDiffQueryKey(
  environmentId: string,
  targetType: string | null,
  targetKey: string | null,
): EnvironmentGitDiffQueryKey {
  return [ENVIRONMENT_GIT_DIFF_QUERY_KEY, environmentId, targetType, targetKey];
}

export function environmentGitDiffQueryKeyPrefix(
  environmentId: string,
): EnvironmentGitDiffQueryKeyPrefix {
  return [ENVIRONMENT_GIT_DIFF_QUERY_KEY, environmentId];
}

export function availableModelsQueryKey(
  providerId: string | null,
): AvailableModelsQueryKey {
  return [AVAILABLE_MODELS_QUERY_KEY, providerId];
}

export function systemProvidersQueryKey(): SystemProvidersQueryKey {
  return [SYSTEM_PROVIDERS_QUERY_KEY];
}

export function statusQueryKey(): StatusQueryKey {
  return [STATUS_QUERY_KEY];
}

function extractThreadIdFromThreadScopedQueryKey(
  queryKey: QueryKey | undefined,
  queryKeyPrefix: ThreadScopedQueryKeyPrefix,
): string | undefined {
  if (!queryKey || queryKey[0] !== queryKeyPrefix) {
    return undefined;
  }

  const threadId = queryKey[1];
  return typeof threadId === "string" ? threadId : undefined;
}

function resolveThreadScopedPlaceholder<TData>(
  previousData: TData | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
  queryKeyPrefix: ThreadScopedQueryKeyPrefix,
): TData | undefined {
  if (previousData === undefined) {
    return undefined;
  }

  return extractThreadIdFromThreadScopedQueryKey(previousQueryKey, queryKeyPrefix) ===
    nextThreadId
    ? previousData
    : undefined;
}

export function resolveWorkspaceStatusPlaceholder(
  previousData: WorkspaceStatus | null | undefined,
  previousQueryKey: QueryKey | undefined,
  nextEnvironmentId: string,
): WorkspaceStatus | null | undefined {
  return resolveThreadScopedPlaceholder(
    previousData,
    previousQueryKey,
    nextEnvironmentId,
    ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  );
}

export function resolveEnvironmentGitDiffPlaceholder(
  previousData: ThreadGitDiffResponse | undefined,
  previousQueryKey: QueryKey | undefined,
  nextEnvironmentId: string,
): ThreadGitDiffResponse | undefined {
  return resolveThreadScopedPlaceholder(
    previousData,
    previousQueryKey,
    nextEnvironmentId,
    ENVIRONMENT_GIT_DIFF_QUERY_KEY,
  );
}

export function resolveThreadPlaceholder(
  previousData: Thread | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
): Thread | undefined {
  return resolveThreadScopedPlaceholder(
    previousData,
    previousQueryKey,
    nextThreadId,
    THREAD_QUERY_KEY,
  );
}

export function resolveThreadTimelinePlaceholder(
  previousData: ThreadTimelineResponse | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
): ThreadTimelineResponse | undefined {
  return resolveThreadScopedPlaceholder(
    previousData,
    previousQueryKey,
    nextThreadId,
    THREAD_TIMELINE_QUERY_KEY,
  );
}

export function getEnvironmentStateInvalidationQueryKeys({
  environmentId,
}: EnvironmentActionInvalidationParams): QueryKey[] {
  return [
    environmentQueryKey(environmentId),
    environmentWorkStatusQueryKeyPrefix(environmentId),
    environmentGitDiffQueryKeyPrefix(environmentId),
    environmentMergeBaseBranchesQueryKeyPrefix(environmentId),
  ];
}

export function getEnvironmentActionInvalidationQueryKeys({
  environmentId,
}: EnvironmentActionInvalidationParams): QueryKey[] {
  return [
    ...getEnvironmentStateInvalidationQueryKeys({ environmentId }),
    threadsQueryKey(),
    statusQueryKey(),
  ];
}

function getThreadListFiltersFromQueryKey(
  queryKey: QueryKey,
): ThreadListQueryFilters | undefined {
  if (queryKey[0] !== THREADS_QUERY_KEY) {
    return undefined;
  }

  const candidate = queryKey[1];
  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }

  return candidate;
}

export function getCachedThreadListPlaceholder(
  queryClient: QueryClient,
  threadId: string,
): Thread | undefined {
  if (!threadId) {
    return undefined;
  }

  const threadLists = queryClient.getQueriesData<Thread[]>({
    queryKey: threadsQueryKey(),
  });
  for (const [, threads] of threadLists) {
    const match = threads?.find((thread) => thread.id === threadId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function updateCachedThread(
  queryClient: QueryClient,
  threadId: string,
  updater: (thread: Thread) => Thread,
): void {
  queryClient.setQueryData<Thread>(threadQueryKey(threadId), (thread) => {
    if (!thread) {
      return thread;
    }

    return updater(thread);
  });
}

function buildOptimisticUserMessageText(input: PromptInput[]): string {
  return input
    .filter((entry): entry is Extract<PromptInput, { type: "text" }> => entry.type === "text")
    .map((entry) => entry.text.trim())
    .filter((entry) => entry.length > 0)
    .join("\n\n");
}

export function buildOptimisticUserThreadRow(
  threadId: string,
  input: PromptInput[],
  createdAt: number,
): TimelineRow {
  const id = `optimistic-user-${createdAt}`;

  return {
    kind: "message",
    id,
    message: {
      id,
      kind: "user",
      threadId,
      text: buildOptimisticUserMessageText(input),
      attachments: collectPromptAttachments(input),
      sourceSeqStart: Number.MAX_SAFE_INTEGER,
      sourceSeqEnd: Number.MAX_SAFE_INTEGER,
      createdAt,
    },
  };
}

export function appendOptimisticUserRowToTimeline(
  timeline: ThreadTimelineResponse | undefined,
  threadId: string,
  input: PromptInput[],
  createdAt: number,
): ThreadTimelineResponse | undefined {
  if (!timeline) {
    return timeline;
  }

  return {
    ...timeline,
    rows: [...timeline.rows, buildOptimisticUserThreadRow(threadId, input, createdAt)],
  };
}

function threadMatchesListFilters(
  thread: Thread,
  filters: ThreadListQueryFilters | undefined,
): boolean {
  if (filters?.archived === true && thread.archivedAt == null) {
    return false;
  }
  if (filters?.archived !== true && thread.archivedAt != null) {
    return false;
  }
  if (filters?.projectId && thread.projectId !== filters.projectId) {
    return false;
  }
  if (filters?.type && thread.type !== filters.type) {
    return false;
  }
  if (
    filters?.parentThreadId !== undefined &&
    thread.parentThreadId !== filters.parentThreadId
  ) {
    return false;
  }

  return true;
}

export function optimisticallyInsertThread(
  queryClient: QueryClient,
  thread: Thread,
): void {
  const threadLists = queryClient.getQueriesData<Thread[]>({
    queryKey: threadsQueryKey(),
  });

  for (const [queryKey, list] of threadLists) {
    if (!list) {
      continue;
    }

    const filters = getThreadListFiltersFromQueryKey(queryKey);
    if (!threadMatchesListFilters(thread, filters)) {
      continue;
    }
    if (list.some((candidate) => candidate.id === thread.id)) {
      continue;
    }

    queryClient.setQueryData<Thread[]>(queryKey, [thread, ...list]);
  }
}
