import { useQuery } from "@tanstack/react-query";
import type { ProjectExecutionDefaults, ThreadType } from "@bb/domain";
import type {
  ProjectBranchesResponse,
  ProjectResponse,
  ProjectWithThreadsResponse,
  PromptHistoryResponse,
  SidebarBootstrapResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  projectDefaultExecutionOptionsQueryKey,
  projectPathsQueryKey,
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKey,
  sidebarBootstrapQueryKey,
} from "./query-keys";
import { resolveProjectSourceBranchesPlaceholder } from "./query-placeholders";

interface QueryOptions {
  enabled?: boolean;
}

interface BranchQueryOptions extends QueryOptions {
  limit?: number;
  query?: string;
  selectedBranch?: string;
}

interface UseProjectDefaultExecutionOptionsArgs {
  projectId: string | undefined;
  threadType: ThreadType;
}

interface UseProjectPathSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  environmentId: string | null;
  includeFiles: boolean;
  includeDirectories: boolean;
}

const PROJECT_SOURCE_BRANCHES_STALE_TIME_MS = 5_000;
const PROJECT_SOURCE_BRANCHES_LIMIT = 50;

function requireProjectId(
  projectId: string | undefined,
  hookName: string,
): string {
  if (!projectId) {
    throw new Error(`${hookName}: projectId is required when query is enabled`);
  }

  return projectId;
}

export function stripProjectThreads(
  project: ProjectWithThreadsResponse,
): ProjectResponse {
  const { threads, ...projectResponse } = project;
  return projectResponse;
}

export function useSidebarBootstrap(options?: QueryOptions) {
  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarBootstrapQueryKey(),
    queryFn: ({ signal }) => api.listProjectsWithThreads(signal),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}

export function useProjectSourceBranches(
  projectId: string | undefined,
  hostId: string | null,
  options?: BranchQueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(hostId);
  const query = options?.query?.trim() ?? "";
  const limit = options?.limit ?? PROJECT_SOURCE_BRANCHES_LIMIT;
  const selectedBranch = options?.selectedBranch?.trim() ?? "";
  return useQuery<ProjectBranchesResponse>({
    queryKey: projectSourceBranchesQueryKey(
      projectId ?? "",
      hostId ?? "",
      query,
      limit,
      selectedBranch,
    ),
    queryFn: () =>
      api.getProjectSourceBranches(
        requireProjectId(projectId, "useProjectSourceBranches"),
        hostId ?? "",
        {
          ...(query ? { query } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit,
        },
      ),
    enabled,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: PROJECT_SOURCE_BRANCHES_STALE_TIME_MS,
    placeholderData: (previousData, previousQuery) =>
      projectId && hostId
        ? resolveProjectSourceBranchesPlaceholder({
            previousData,
            previousQueryKey: previousQuery?.queryKey,
            projectId,
            hostId,
            limit,
            selectedBranch,
          })
        : undefined,
  });
}

export function useProjectPromptHistory(
  projectId: string | undefined,
  options?: QueryOptions,
) {
  return useQuery<PromptHistoryResponse>({
    queryKey: projectPromptHistoryQueryKey(projectId),
    queryFn: ({ signal }) =>
      api.listProjectPromptHistory(
        requireProjectId(projectId, "useProjectPromptHistory"),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
    staleTime: 10_000,
  });
}

export function useProjectDefaultExecutionOptions(
  args: UseProjectDefaultExecutionOptionsArgs,
  options?: QueryOptions,
) {
  const { projectId, threadType } = args;
  return useQuery<ProjectExecutionDefaults | null>({
    queryKey: projectDefaultExecutionOptionsQueryKey({
      projectId: projectId ?? "",
      threadType,
    }),
    queryFn: () =>
      api.getProjectDefaultExecutionOptions({
        projectId: requireProjectId(
          projectId,
          "useProjectDefaultExecutionOptions",
        ),
        threadType,
      }),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
    staleTime: 10_000,
    placeholderData: (previousData) => (projectId ? previousData : undefined),
  });
}

export function useProjectPathSuggestions(args: UseProjectPathSuggestionsArgs) {
  const {
    projectId,
    query,
    limit = 8,
    environmentId,
    includeFiles,
    includeDirectories,
  } = args;
  const trimmedQuery = query?.trim() ?? "";

  return useQuery<WorkspacePathListResponse>({
    queryKey: projectPathsQueryKey(
      projectId,
      trimmedQuery,
      limit,
      environmentId,
      includeFiles,
      includeDirectories,
    ),
    queryFn: () =>
      api.searchProjectPaths({
        projectId: projectId ?? "",
        query: trimmedQuery,
        limit,
        environmentId,
        includeFiles,
        includeDirectories,
      }),
    enabled: Boolean(projectId) && trimmedQuery.length > 0,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}
