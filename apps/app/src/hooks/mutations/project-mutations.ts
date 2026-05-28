import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PromptInput,
  ReasoningLevel,
  ThreadListEntry,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  CreateProjectRequest,
  ManagerEnvironmentArgs,
  ProjectResponse,
  ProjectWithThreadsResponse,
  ReorderManagerThreadRequest,
  ReorderProjectRequest,
  SidebarBootstrapResponse,
  ThreadListResponse,
  UpdateProjectRequest,
  UploadedPromptAttachment,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import { optimisticallyInsertThread } from "../queries/query-cache";
import {
  projectsQueryKey,
  sidebarBootstrapQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import {
  invalidateProjectListQueries,
  invalidateProjectDeleteQueries,
  invalidateProjectManagerHireQueries,
  invalidateProjectSourceQueries,
  invalidateProjectUpdateQueries,
  invalidateThreadListQueries,
} from "../cache-effects";

interface AddLocalProjectSourceRequest {
  projectId: string;
  hostId: string;
  path: string;
}

interface UpdateLocalProjectSourceRequest {
  projectId: string;
  sourceId: string;
  path: string;
}

export interface HireProjectManagerRequest {
  projectId: string;
  name?: string;
  providerId?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  templateName?: string;
  environment: ManagerEnvironmentArgs;
  /** Optional user-provided first message; when empty the server uses
   * its welcome-message template instead. */
  input?: PromptInput[];
}

const HIRE_PROJECT_MANAGER_MUTATION_KEY = ["hireProjectManager"] as const;

interface UpdateProjectMutationRequest extends UpdateProjectRequest {
  id: string;
}

interface ReorderProjectMutationRequest extends ReorderProjectRequest {
  projectId: string;
}

interface ReorderProjectManagerMutationRequest extends ReorderManagerThreadRequest {
  projectId: string;
  threadId: string;
}

interface ReorderProjectMutationContext {
  previousProjects: ProjectResponse[] | undefined;
  previousSidebarBootstrap: SidebarBootstrapResponse | undefined;
}

interface ReorderProjectManagerMutationContext {
  previousSidebarBootstrap: SidebarBootstrapResponse | undefined;
  previousThreadList: ThreadListResponse | undefined;
}

interface UploadPromptAttachmentRequest {
  projectId: string;
  file: File;
}

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

function applyThreadListOrderToExistingThreads(
  currentThreads: readonly ThreadListEntry[],
  orderedThreads: readonly ThreadListEntry[],
): ThreadListResponse {
  const currentThreadsById = new Map(
    currentThreads.map((thread) => [thread.id, thread]),
  );
  return orderedThreads.map(
    (thread) => currentThreadsById.get(thread.id) ?? thread,
  );
}

function applyManagerThreadReorderToThreadList(
  threads: readonly ThreadListEntry[],
  request: ReorderProjectManagerMutationRequest,
): ThreadListResponse {
  const managerThreads = threads.filter((thread) => thread.type === "manager");
  const reorderedManagers = applyNeighborReorder({
    items: managerThreads,
    request: {
      itemId: request.threadId,
      previousItemId: request.previousThreadId,
      nextItemId: request.nextThreadId,
    },
  });
  let managerIndex = 0;
  return threads.map((thread) => {
    if (thread.type !== "manager") {
      return thread;
    }
    const reorderedManager = reorderedManagers[managerIndex];
    managerIndex += 1;
    return reorderedManager ?? thread;
  });
}

function replaceSidebarBootstrapProjectThreads(
  bootstrap: SidebarBootstrapResponse,
  projectId: string,
  threads: ThreadListResponse,
): SidebarBootstrapResponse {
  const replaceThreads = (
    project: ProjectWithThreadsResponse,
  ): ProjectWithThreadsResponse =>
    project.id === projectId
      ? {
          ...project,
          threads: applyThreadListOrderToExistingThreads(
            project.threads,
            threads,
          ),
        }
      : project;
  return {
    projects: bootstrap.projects.map(replaceThreads),
    personalProject: replaceThreads(bootstrap.personalProject),
  };
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create project.",
    },
    mutationFn: (request: CreateProjectRequest) => api.createProject(request),
    onSuccess: () => {
      invalidateProjectListQueries({ queryClient });
    },
  });
}

export function useHireProjectManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: HIRE_PROJECT_MANAGER_MUTATION_KEY,
    meta: {
      errorMessage: "Failed to hire manager.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      name,
      providerId,
      model,
      reasoningLevel,
      templateName,
      environment,
      input,
    }: HireProjectManagerRequest) =>
      api.hireProjectManager(projectId, {
        name,
        ...(providerId ? { providerId } : {}),
        ...(model ? { model } : {}),
        ...(reasoningLevel ? { reasoningLevel } : {}),
        ...(templateName ? { templateName } : {}),
        environment,
        ...(input && input.length > 0 ? { input } : {}),
      }),
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(thread.id),
        thread,
      );
      optimisticallyInsertThread(queryClient, thread);
      invalidateProjectManagerHireQueries({ queryClient });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update project.",
    },
    mutationFn: ({ id, ...request }: UpdateProjectMutationRequest) =>
      api.updateProject(id, request),
    onSuccess: (_data, variables) => {
      invalidateProjectUpdateQueries({ projectId: variables.id, queryClient });
    },
  });
}

export function useReorderProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder project.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      previousProjectId,
      nextProjectId,
    }: ReorderProjectMutationRequest): Promise<ProjectResponse[]> =>
      api.reorderProject(projectId, {
        previousProjectId,
        nextProjectId,
      }),
    onMutate: (variables): ReorderProjectMutationContext => {
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
                  itemId: variables.projectId,
                  previousItemId: variables.previousProjectId,
                  nextItemId: variables.nextProjectId,
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
                    itemId: variables.projectId,
                    previousItemId: variables.previousProjectId,
                    nextItemId: variables.nextProjectId,
                  },
                }),
              }
            : currentBootstrap,
      );

      return { previousProjects, previousSidebarBootstrap };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(projectsQueryKey(), context?.previousProjects);
      queryClient.setQueryData(
        sidebarBootstrapQueryKey(),
        context?.previousSidebarBootstrap,
      );
      invalidateProjectListQueries({ queryClient });
    },
    onSuccess: (projects) => {
      queryClient.setQueryData<ProjectResponse[]>(
        projectsQueryKey(),
        (currentProjects) =>
          currentProjects
            ? applyProjectOrderToProjectList(currentProjects, projects)
            : projects,
      );
      queryClient.setQueryData<SidebarBootstrapResponse>(
        sidebarBootstrapQueryKey(),
        (currentBootstrap) =>
          currentBootstrap
            ? applyProjectOrderToSidebarBootstrap(currentBootstrap, projects)
            : currentBootstrap,
      );
    },
  });
}

export function useReorderProjectManager() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder manager.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      threadId,
      previousThreadId,
      nextThreadId,
    }: ReorderProjectManagerMutationRequest): Promise<ThreadListResponse> =>
      api.reorderProjectManager(projectId, threadId, {
        previousThreadId,
        nextThreadId,
      }),
    onMutate: (variables): ReorderProjectManagerMutationContext => {
      const threadListKey = threadListQueryKey({
        projectId: variables.projectId,
        archived: false,
      });
      const previousThreadList =
        queryClient.getQueryData<ThreadListResponse>(threadListKey);
      const previousSidebarBootstrap =
        queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarBootstrapQueryKey(),
        );

      void queryClient.cancelQueries(
        { queryKey: threadListKey },
        { revert: false },
      );
      void queryClient.cancelQueries(
        { queryKey: sidebarBootstrapQueryKey() },
        { revert: false },
      );
      queryClient.setQueryData<ThreadListResponse>(
        threadListKey,
        (currentThreads) =>
          currentThreads
            ? applyManagerThreadReorderToThreadList(currentThreads, variables)
            : currentThreads,
      );
      queryClient.setQueryData<SidebarBootstrapResponse>(
        sidebarBootstrapQueryKey(),
        (currentBootstrap) => {
          if (!currentBootstrap) {
            return currentBootstrap;
          }
          const reorderProjectManagers = (
            project: ProjectWithThreadsResponse,
          ): ProjectWithThreadsResponse =>
            project.id === variables.projectId
              ? {
                  ...project,
                  threads: applyManagerThreadReorderToThreadList(
                    project.threads,
                    variables,
                  ),
                }
              : project;
          return {
            projects: currentBootstrap.projects.map(reorderProjectManagers),
            personalProject: reorderProjectManagers(
              currentBootstrap.personalProject,
            ),
          };
        },
      );

      return { previousThreadList, previousSidebarBootstrap };
    },
    onError: (_error, variables, context) => {
      const threadListKey = threadListQueryKey({
        projectId: variables.projectId,
        archived: false,
      });
      queryClient.setQueryData(threadListKey, context?.previousThreadList);
      queryClient.setQueryData(
        sidebarBootstrapQueryKey(),
        context?.previousSidebarBootstrap,
      );
      invalidateThreadListQueries({ queryClient });
    },
    onSuccess: (threads, variables) => {
      const threadListKey = threadListQueryKey({
        projectId: variables.projectId,
        archived: false,
      });
      queryClient.setQueryData<ThreadListResponse>(
        threadListKey,
        (currentThreads) =>
          currentThreads
            ? applyThreadListOrderToExistingThreads(currentThreads, threads)
            : threads,
      );
      queryClient.setQueryData<SidebarBootstrapResponse>(
        sidebarBootstrapQueryKey(),
        (currentBootstrap) =>
          currentBootstrap
            ? replaceSidebarBootstrapProjectThreads(
                currentBootstrap,
                variables.projectId,
                threads,
              )
            : currentBootstrap,
      );
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove project.",
    },
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: (_data, projectId) => {
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
    },
  });
}

export function useAddLocalProjectSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to add local source.",
    },
    mutationFn: ({ projectId, hostId, path }: AddLocalProjectSourceRequest) =>
      api.addProjectSource(projectId, { type: "local_path", hostId, path }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUpdateLocalProjectSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update local source.",
    },
    mutationFn: ({
      projectId,
      sourceId,
      path,
    }: UpdateLocalProjectSourceRequest) =>
      api.updateProjectSource(projectId, sourceId, {
        type: "local_path",
        path,
      }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUploadPromptAttachment() {
  return useMutation({
    meta: {
      errorMessage: "Failed to upload attachment.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      file,
    }: UploadPromptAttachmentRequest): Promise<UploadedPromptAttachment> =>
      api.uploadPromptAttachment(projectId, file),
    retry: false,
  });
}
