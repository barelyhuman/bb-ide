import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import { useQueries } from "@tanstack/react-query";
import {
  findLocalPathProjectSourceForHost,
  type ThreadListEntry,
} from "@bb/domain";
import { Folder, Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  getConnectionAwareQueryState,
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import { useProjects } from "@/hooks/queries/project-queries";
import {
  isLocalPathMissing,
  useLocalPathExistence,
} from "@/hooks/queries/host-path-queries";
import {
  projectSourceWorkspaceStatusQueryKey,
  threadListQueryKey,
} from "@/hooks/queries/query-keys";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import type { WebSocketConnectionState } from "@/lib/ws";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "@bb/ui-core";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@bb/ui-core";
import {
  COARSE_POINTER_ADD_PROJECT_BUTTON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/ui-core";
import { ProjectRow } from "./project-list/ProjectRow";
import type { ProjectThreadListState } from "./project-list/ProjectRow";
import {
  collapsedManagerIdsAtom,
  collapsedProjectIdsAtom,
} from "./project-list/collapsedState";

interface ProjectListProps {
  onNewProject?: () => void;
  onProjectSelect?: () => void;
  selectedProjectId?: string;
  isCreatingProject?: boolean;
}

interface ProjectSourceStatusTarget {
  projectId: string;
  sourceId: string;
}

interface ProjectThreadQueryState {
  status: ConnectionAwareQueryStatus;
}

interface ProjectThreadQueryResult {
  data: ThreadListEntry[] | undefined;
  isFetching: boolean;
  isLoadingError: boolean;
}

interface ProjectThreadQueryAggregation {
  threads: ThreadListEntry[];
  threadStatesByProjectId: Map<string, ProjectThreadQueryState>;
}

interface BuildProjectThreadQueryAggregationArgs {
  projectIds: readonly string[];
  queryResults: readonly ProjectThreadQueryResult[];
  serverConnectionState: WebSocketConnectionState;
}

interface ProjectThreadListStateArgs {
  status: ConnectionAwareQueryStatus | undefined;
  threads: ThreadListEntry[] | undefined;
}

function buildProjectThreadQueryAggregation({
  projectIds,
  queryResults,
  serverConnectionState,
}: BuildProjectThreadQueryAggregationArgs): ProjectThreadQueryAggregation {
  const threads: ThreadListEntry[] = [];
  const threadStatesByProjectId = new Map<string, ProjectThreadQueryState>();

  for (let index = 0; index < queryResults.length; index += 1) {
    const projectId = projectIds[index];
    const result = queryResults[index];
    if (!projectId || !result) {
      continue;
    }

    if (result.data !== undefined) {
      threads.push(...result.data);
    }
    threadStatesByProjectId.set(projectId, {
      status: getConnectionAwareQueryState({
        hasResolvedData: result.data !== undefined,
        isFetching: result.isFetching,
        isLoadingError: result.isLoadingError,
        serverConnectionState,
      }).status,
    });
  }

  return {
    threads,
    threadStatesByProjectId,
  };
}

function getProjectThreadListState({
  status,
  threads,
}: ProjectThreadListStateArgs): ProjectThreadListState {
  switch (status) {
    case "ready":
      return {
        status: "ready",
        threads: threads ?? [],
      };
    case "unavailable":
      return { status: "unavailable" };
    case "loading":
    case undefined:
      return { status: "loading" };
  }
}

export function ProjectList({
  onNewProject,
  onProjectSelect,
  selectedProjectId,
  isCreatingProject = false,
}: ProjectListProps) {
  const projectsQuery = useProjects();
  const {
    data: projects,
    isFetching: projectsFetching,
    isLoadingError: projectsLoadingError,
  } = projectsQuery;
  const serverConnectionState = useServerConnectionState();
  const projectsState = useConnectionAwareQueryState({
    hasResolvedData: projects !== undefined,
    isFetching: projectsFetching,
    isLoadingError: projectsLoadingError,
  });
  const projectIds = useMemo(
    () => (projects ?? []).map((project) => project.id),
    [projects],
  );
  const { threads, threadStatesByProjectId } = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: threadListQueryKey({ projectId, archived: false }),
      queryFn: ({ signal }) =>
        api.listThreads({ projectId, archived: false }, signal),
      staleTime: 10_000,
    })),
    combine: (results) =>
      buildProjectThreadQueryAggregation({
        projectIds,
        queryResults: results,
        serverConnectionState,
      }),
  });
  const { localHostId } = useHostDaemon();
  const location = useLocation();

  const localSourceTargets = useMemo(() => {
    if (!localHostId || !projects) return [];
    const targets: ProjectSourceStatusTarget[] = [];
    for (const project of projects) {
      const source = findLocalPathProjectSourceForHost(
        project.sources,
        localHostId,
      );
      if (source) {
        targets.push({
          projectId: project.id,
          sourceId: source.id,
        });
      }
    }
    return targets;
  }, [localHostId, projects]);

  const promotedBranchNamesByProjectId = useQueries({
    queries: localSourceTargets.map((target) => ({
      queryKey: projectSourceWorkspaceStatusQueryKey(
        target.projectId,
        target.sourceId,
      ),
      queryFn: () =>
        api.getProjectSourceWorkspaceStatus(target.projectId, target.sourceId),
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    })),
    combine: (results) => {
      const branchNamesByProjectId = new Map<string, string | null>();
      for (let index = 0; index < results.length; index += 1) {
        const target = localSourceTargets[index];
        if (!target) continue;
        branchNamesByProjectId.set(
          target.projectId,
          results[index].data?.workspace?.branch.currentBranch ?? null,
        );
      }
      return branchNamesByProjectId;
    },
  });

  const localPaths = useMemo(() => {
    if (!localHostId || !projects) return [];
    return projects
      .map(
        (project) =>
          findLocalPathProjectSourceForHost(project.sources, localHostId)?.path,
      )
      .filter((path): path is string => typeof path === "string");
  }, [localHostId, projects]);
  const pathExistence = useLocalPathExistence(localPaths);

  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const [collapsedManagerIdList, setCollapsedManagerIdList] = useAtom(
    collapsedManagerIdsAtom,
  );
  const selectedThreadId = location.pathname.match(
    /^\/projects\/[^/]+\/threads\/([^/]+)/,
  )?.[1];
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const collapsedManagerIds = useMemo(
    () => new Set(collapsedManagerIdList),
    [collapsedManagerIdList],
  );
  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, ThreadListEntry[]>();

    for (const thread of threads) {
      const existing = grouped.get(thread.projectId);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(thread.projectId, [thread]);
      }
    }

    return grouped;
  }, [threads]);

  const toggleProjectCollapsed = useCallback(
    (projectId: string) => {
      setCollapsedProjectIdList((current) => {
        const next = new Set(current);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }

        return Array.from(next);
      });
    },
    [setCollapsedProjectIdList],
  );

  const toggleManagerCollapsed = useCallback(
    (threadId: string) => {
      setCollapsedManagerIdList((current) => {
        const next = new Set(current);
        if (next.has(threadId)) {
          next.delete(threadId);
        } else {
          next.add(threadId);
        }

        return Array.from(next);
      });
    },
    [setCollapsedManagerIdList],
  );

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="mb-1 flex items-center justify-between pr-1">
        Projects
        {onNewProject ? (
          <button
            type="button"
            onClick={onNewProject}
            disabled={isCreatingProject}
            title={isCreatingProject ? "Creating project..." : "Add project"}
            aria-label="Add project"
            className={cn(
              "inline-flex items-center justify-center rounded text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground disabled:opacity-50",
              COARSE_POINTER_ADD_PROJECT_BUTTON_SIZE_CLASS,
            )}
          >
            <Plus className={COARSE_POINTER_ICON_SIZE_CLASS} />
          </button>
        ) : null}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-2">
          {projectsState.status === "loading" ? (
            <>
              <SidebarMenuSkeleton />
              <SidebarMenuSkeleton />
            </>
          ) : projects && projects.length > 0 ? (
            projects.map((project) => {
              const threadState = threadStatesByProjectId.get(project.id);
              const threadListState = getProjectThreadListState({
                status: threadState?.status,
                threads: threadsByProject.get(project.id),
              });
              const localSourcePath = localHostId
                ? findLocalPathProjectSourceForHost(
                    project.sources,
                    localHostId,
                  )?.path
                : undefined;
              const isLocalPathInvalid = isLocalPathMissing(
                pathExistence,
                localSourcePath,
              );
              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  threadListState={threadListState}
                  selectedThreadId={selectedThreadId}
                  isActive={
                    selectedProjectId === project.id && !selectedThreadId
                  }
                  isCollapsed={collapsedProjectIds.has(project.id)}
                  collapsedManagerIds={collapsedManagerIds}
                  isLocalPathInvalid={isLocalPathInvalid}
                  localHostId={localHostId}
                  onProjectSelect={onProjectSelect}
                  onToggleProjectCollapsed={toggleProjectCollapsed}
                  onToggleManagerCollapsed={toggleManagerCollapsed}
                  promotedBranchName={
                    promotedBranchNamesByProjectId.get(project.id) ?? null
                  }
                />
              );
            })
          ) : (
            <SidebarMenuItem>
              <EmptyState
                message={
                  projectsState.status === "unavailable"
                    ? "Projects unavailable"
                    : "No projects"
                }
                icon={Folder}
                className="px-2 py-1.5"
                iconClassName="size-3.5"
                messageClassName="text-xs"
              />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
