import type { QueryClient } from "@tanstack/react-query";
import type {
  ProjectResponse,
  ReorderProjectRequest,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import {
  PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  PROJECT_PATHS_QUERY_KEY,
  PROJECT_PROMPT_HISTORY_QUERY_KEY,
  PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  PROJECTS_QUERY_KEY,
  projectsQueryKey,
  sidebarBootstrapQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";
import {
  invalidateProjectDeleteQueries,
  invalidateProjectListQueries,
} from "./mutation-cache-effects";

interface ReorderProjectTransactionArgs {
  queryClient: QueryClient;
  request: ReorderProjectTransactionRequest;
}

interface ReorderProjectTransactionRequest extends ReorderProjectRequest {
  projectId: string;
}

interface RollbackReorderProjectTransactionArgs {
  queryClient: QueryClient;
  transaction: ReorderProjectTransaction | undefined;
}

interface ApplyReorderProjectResultArgs {
  projects: readonly ProjectResponse[];
  queryClient: QueryClient;
}

interface ApplyProjectDeleteResultArgs {
  projectId: string;
  queryClient: QueryClient;
}

export interface ReorderProjectTransaction {
  previousProjects: ProjectResponse[] | undefined;
  previousSidebarBootstrap: SidebarBootstrapResponse | undefined;
}

export const projectCacheOwner = {
  id: "project",
  ownedQueryRoots: [
    PROJECTS_QUERY_KEY,
    PROJECT_PATHS_QUERY_KEY,
    PROJECT_SOURCE_BRANCHES_QUERY_KEY,
    PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
    PROJECT_PROMPT_HISTORY_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "project", kind: "project-created" },
    { entity: "project", kind: "project-updated" },
    { entity: "project", kind: "project-deleted" },
    { entity: "project", kind: "project-sources-changed" },
    { entity: "project", kind: "threads-changed" },
    { entity: "project", kind: "project-order-changed" },
    { entity: "project", kind: "automations-changed" },
    { entity: "project", kind: "nudges-changed" },
  ],
  bootstrapPolicy:
    "Owns project records, source/path/default/prompt projections, and project-scoped bootstrap ingestion.",
  deletionBehavior:
    "Removes deleted project records and delegates sidebar route cleanup through cache events.",
  reconnectBehavior:
    "Refreshes project records, source/path suggestions, and project prompt projections after reconnect.",
} satisfies CacheOwnerDescriptor;

function applyProjectOrderToProjectList(
  currentProjects: readonly ProjectResponse[],
  orderedProjects: readonly ProjectResponse[],
): ProjectResponse[] {
  const currentProjectsById = new Map(
    currentProjects.map((project) => [project.id, project]),
  );
  return orderedProjects.map(
    (project) => currentProjectsById.get(project.id) ?? project,
  );
}

function applyProjectOrderToSidebarBootstrap(
  currentBootstrap: SidebarBootstrapResponse,
  orderedProjects: readonly ProjectResponse[],
): SidebarBootstrapResponse {
  const currentProjectsById = new Map(
    currentBootstrap.projects.map((project) => [project.id, project]),
  );
  return {
    ...currentBootstrap,
    projects: orderedProjects.map((project) => {
      const currentProject = currentProjectsById.get(project.id);
      return currentProject ?? { ...project, threads: [] };
    }),
  };
}

function removeProjectFromProjectList(
  currentProjects: readonly ProjectResponse[],
  projectId: string,
): ProjectResponse[] {
  return currentProjects.filter((project) => project.id !== projectId);
}

function removeProjectFromSidebarBootstrap(
  currentBootstrap: SidebarBootstrapResponse,
  projectId: string,
): SidebarBootstrapResponse {
  return {
    ...currentBootstrap,
    projects: currentBootstrap.projects.filter(
      (project) => project.id !== projectId,
    ),
  };
}

export function beginReorderProjectTransaction({
  queryClient,
  request,
}: ReorderProjectTransactionArgs): ReorderProjectTransaction {
  const previousProjects =
    queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
  const previousSidebarBootstrap =
    queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarBootstrapQueryKey(),
    );

  void queryClient.cancelQueries(
    { queryKey: projectsQueryKey() },
    { revert: false },
  );
  void queryClient.cancelQueries(
    { queryKey: sidebarBootstrapQueryKey() },
    { revert: false },
  );
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? applyNeighborReorder({
            items: currentProjects,
            request: {
              itemId: request.projectId,
              previousItemId: request.previousProjectId,
              nextItemId: request.nextProjectId,
            },
          })
        : currentProjects,
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarBootstrapQueryKey(),
    (currentBootstrap) =>
      currentBootstrap
        ? {
            ...currentBootstrap,
            projects: applyNeighborReorder({
              items: currentBootstrap.projects,
              request: {
                itemId: request.projectId,
                previousItemId: request.previousProjectId,
                nextItemId: request.nextProjectId,
              },
            }),
          }
        : currentBootstrap,
  );

  return { previousProjects, previousSidebarBootstrap };
}

export function rollbackReorderProjectTransaction({
  queryClient,
  transaction,
}: RollbackReorderProjectTransactionArgs): void {
  queryClient.setQueryData(projectsQueryKey(), transaction?.previousProjects);
  queryClient.setQueryData(
    sidebarBootstrapQueryKey(),
    transaction?.previousSidebarBootstrap,
  );
  invalidateProjectListQueries({ queryClient });
}

export function applyReorderProjectResult({
  projects,
  queryClient,
}: ApplyReorderProjectResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? applyProjectOrderToProjectList(currentProjects, projects)
        : [...projects],
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarBootstrapQueryKey(),
    (currentBootstrap) =>
      currentBootstrap
        ? applyProjectOrderToSidebarBootstrap(currentBootstrap, projects)
        : currentBootstrap,
  );
}

export function applyProjectDeleteResult({
  projectId,
  queryClient,
}: ApplyProjectDeleteResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? removeProjectFromProjectList(currentProjects, projectId)
        : currentProjects,
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarBootstrapQueryKey(),
    (currentBootstrap) =>
      currentBootstrap
        ? removeProjectFromSidebarBootstrap(currentBootstrap, projectId)
        : currentBootstrap,
  );
  invalidateProjectDeleteQueries({ queryClient });
}
