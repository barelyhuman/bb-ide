import { useQuery } from "@tanstack/react-query";
import type {
  ProjectResponse,
  ProjectSourceWorkspaceStatusResponse,
  WorkspaceFileListResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  projectFilesQueryKey,
  projectsQueryKey,
  projectSourceWorkspaceStatusQueryKey,
} from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

interface RequireProjectSourceWorkspaceStatusIdsArgs {
  projectId: string | null | undefined;
  sourceId: string | null | undefined;
}

export function useProjects() {
  return useQuery<ProjectResponse[]>({
    queryKey: projectsQueryKey(),
    queryFn: () => api.listProjects(),
    staleTime: 30_000,
  });
}

export function useProjectFileSuggestions(args: {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  environmentId: string | null;
}) {
  const { projectId, query, limit = 8, environmentId } = args;
  const trimmedQuery = query?.trim() ?? "";

  return useQuery<WorkspaceFileListResponse>({
    queryKey: projectFilesQueryKey(
      projectId,
      trimmedQuery,
      limit,
      environmentId,
    ),
    queryFn: () =>
      api.searchProjectFiles({
        projectId: projectId ?? "",
        query: trimmedQuery,
        limit,
        environmentId,
      }),
    enabled: Boolean(projectId) && trimmedQuery.length > 0,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function requireProjectSourceWorkspaceStatusIds({
  projectId,
  sourceId,
}: RequireProjectSourceWorkspaceStatusIdsArgs) {
  if (!projectId || !sourceId) {
    throw new Error(
      "useProjectSourceWorkspaceStatus: projectId and sourceId are required when query is enabled",
    );
  }

  return {
    projectId,
    sourceId,
  };
}

export function useProjectSourceWorkspaceStatus(
  projectId: string | null | undefined,
  sourceId: string | null | undefined,
  options?: QueryOptions,
) {
  return useQuery<ProjectSourceWorkspaceStatusResponse>({
    queryKey: projectSourceWorkspaceStatusQueryKey(projectId, sourceId),
    queryFn: () => {
      const ids = requireProjectSourceWorkspaceStatusIds({
        projectId,
        sourceId,
      });
      return api.getProjectSourceWorkspaceStatus(ids.projectId, ids.sourceId);
    },
    enabled: (options?.enabled ?? true) && Boolean(projectId && sourceId),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}
