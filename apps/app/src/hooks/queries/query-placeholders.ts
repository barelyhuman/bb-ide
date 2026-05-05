import type { QueryKey } from "@tanstack/react-query";
import type {
  ThreadWithRuntime,
  ThreadGitDiffResponse,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  ManagerTimelineView,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import {
  ENVIRONMENT_GIT_DIFF_QUERY_KEY,
  ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  THREAD_QUERY_KEY,
  THREAD_TIMELINE_QUERY_KEY,
  managerTimelineViewFromThreadTimelineQueryKey,
} from "./query-keys";

type ThreadScopedQueryKeyPrefix =
  | typeof THREAD_QUERY_KEY
  | typeof ENVIRONMENT_WORK_STATUS_QUERY_KEY
  | typeof ENVIRONMENT_GIT_DIFF_QUERY_KEY
  | typeof THREAD_TIMELINE_QUERY_KEY;

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

  return extractThreadIdFromThreadScopedQueryKey(
    previousQueryKey,
    queryKeyPrefix,
  ) === nextThreadId
    ? previousData
    : undefined;
}

export function resolveEnvironmentWorkStatusPlaceholder(
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
  previousData: ThreadWithRuntime | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
): ThreadWithRuntime | undefined {
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
  nextManagerTimelineView: ManagerTimelineView | undefined,
): ThreadTimelineResponse | undefined {
  if (previousData === undefined) {
    return undefined;
  }

  const previousThreadId = extractThreadIdFromThreadScopedQueryKey(
    previousQueryKey,
    THREAD_TIMELINE_QUERY_KEY,
  );
  const previousManagerTimelineView =
    managerTimelineViewFromThreadTimelineQueryKey(previousQueryKey);

  return previousThreadId === nextThreadId &&
    previousManagerTimelineView === nextManagerTimelineView
    ? previousData
    : undefined;
}
