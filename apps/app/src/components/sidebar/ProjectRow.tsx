import { memo, useMemo, useState } from "react";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "@/components/project/ProjectActionsMenu";
import { SidebarMenuItem, SidebarMenuSkeleton } from "@/components/ui/sidebar.js";
import { COARSE_POINTER_ICON_SIZE_CLASS, COARSE_POINTER_PROJECT_ROW_ACTION_SIZE_CLASS, COARSE_POINTER_ROW_ACTION_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import {
  buildProjectThreadGroups,
  type ManagerThreadGroup,
} from "./projectThreadGroups";
import {
  SIDEBAR_MANAGER_GROUP_LINE_CLASS,
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
} from "./sidebarRowClasses";

const THREAD_ROW_DEFAULT_OPTIONS: ThreadRowOptions = { kind: "default" };
const THREAD_ROW_MANAGED_CHILD_OPTIONS: ThreadRowOptions = {
  kind: "managed-child",
};

export type ProjectThreadListState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      threads: ThreadListEntry[];
    }
  | {
      status: "unavailable";
    };

interface ProjectRowProps {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  selectedThreadId?: string;
  isActive: boolean;
  isCollapsed: boolean;
  collapsedManagerIds: Set<string>;
  isLocalPathInvalid: boolean;
  onProjectSelect?: () => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleManagerCollapsed: (threadId: string) => void;
}

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];

interface ManagerThreadGroupRowProps {
  projectId: string;
  managerThreadGroup: ManagerThreadGroup;
  selectedThreadId?: string;
  isManagerCollapsed: boolean;
  onProjectSelect?: () => void;
  onToggleManagerCollapsed: (threadId: string) => void;
}

const ManagerThreadGroupRow = memo(function ManagerThreadGroupRow({
  projectId,
  managerThreadGroup,
  selectedThreadId,
  isManagerCollapsed,
  onProjectSelect,
  onToggleManagerCollapsed,
}: ManagerThreadGroupRowProps) {
  const { managerThread, managedThreads, stats } = managerThreadGroup;
  const managerOptions = useMemo<ThreadRowOptions>(
    () => ({
      kind: "manager",
      isCollapsed: isManagerCollapsed,
      managedChildCount: stats.managedChildCount,
      onToggleCollapsed: onToggleManagerCollapsed,
    }),
    [isManagerCollapsed, onToggleManagerCollapsed, stats.managedChildCount],
  );
  const showManagedChildren = !isManagerCollapsed && managedThreads.length > 0;
  return (
    <div className="space-y-0.5">
      <ThreadRow
        projectId={projectId}
        thread={managerThread}
        isActive={selectedThreadId === managerThread.id}
        onProjectSelect={onProjectSelect}
        options={managerOptions}
      />
      {showManagedChildren ? (
        <div
          className={cn(
            "relative space-y-px",
            SIDEBAR_MANAGER_GROUP_LINE_CLASS,
          )}
        >
          {managedThreads.map((managedThread) => (
            <ThreadRow
              key={managedThread.id}
              projectId={projectId}
              thread={managedThread}
              isActive={selectedThreadId === managedThread.id}
              onProjectSelect={onProjectSelect}
              options={THREAD_ROW_MANAGED_CHILD_OPTIONS}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

function ProjectRowComponent({
  project,
  threadListState,
  selectedThreadId,
  isActive,
  isCollapsed,
  collapsedManagerIds,
  isLocalPathInvalid,
  onProjectSelect,
  onToggleProjectCollapsed,
  onToggleManagerCollapsed,
}: ProjectRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const projectThreads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const { managerThreadGroups, unmanagedStandardThreads } = useMemo(
    () => buildProjectThreadGroups(projectThreads),
    [projectThreads],
  );
  return (
    <SidebarMenuItem data-sidebar-sticky-project-item="">
      <ProjectActionsContextMenu
        project={project}
        onOpenChange={setIsContextActionsOpen}
      >
        <SidebarStickyTier
          tier="project"
          className={cn(
            "group/project-row flex w-full items-center rounded-md text-sm transition-colors",
            isActive
              ? "bg-sidebar-border text-sidebar-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          title={project.name}
        >
          <NavLink
            to={`/projects/${project.id}`}
            onClick={onProjectSelect}
            className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
          />
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Expand ${project.name}`
                : `Collapse ${project.name}`
            }
            title={
              isCollapsed
                ? "Expand project threads"
                : "Collapse project threads"
            }
            onClick={() => {
              onToggleProjectCollapsed(project.id);
            }}
            className={cn(
              "relative z-10 flex shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-colors hover:text-sidebar-foreground focus-visible:ring-2",
              COARSE_POINTER_PROJECT_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <span
              className={cn(
                "relative inline-flex items-center justify-center",
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
            >
              <Icon name="ChevronRight"
                className={cn(
                  "absolute opacity-0 transition-all duration-150 group-hover/project-row:opacity-100",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                  !isCollapsed && "rotate-90",
                )}
              />
              {isCollapsed ? (
                <Icon name="Folder"
                  className={cn(
                    "absolute opacity-100 transition-opacity duration-150 group-hover/project-row:opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              ) : (
                <Icon name="FolderOpen"
                  className={cn(
                    "absolute opacity-100 transition-opacity duration-150 group-hover/project-row:opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              )}
            </span>
          </button>
          <span className="pointer-events-none relative z-10 min-w-0 flex-1 truncate text-left">
            {project.name}
          </span>
          {isLocalPathInvalid ? (
            <NavLink
              to={`/projects/${project.id}/settings`}
              onClick={(event) => {
                event.stopPropagation();
                onProjectSelect?.();
              }}
              title="Project folder not found. Open project settings to fix."
              aria-label="Project folder not found"
              className={cn(
                "relative z-10 inline-flex shrink-0 items-center justify-center rounded-md text-destructive outline-none ring-sidebar-ring transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
            >
              <Icon name="AlertTriangle" className={COARSE_POINTER_ICON_SIZE_CLASS} />
            </NavLink>
          ) : null}
          <ProjectActionsMenu
            project={project}
            onOpenChange={setIsDropdownActionsOpen}
            triggerClassName={cn(
              "relative z-10 text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              isActionsOpen
                ? "opacity-100"
                : "opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100",
            )}
          />
          <OverflowFade placement="below" tone="sidebar" size="sm" />
        </SidebarStickyTier>
      </ProjectActionsContextMenu>

      {!isCollapsed ? (
        threadListState.status === "loading" ? (
          <div className="group-data-[collapsible=icon]:hidden">
            <SidebarMenuSkeleton />
          </div>
        ) : projectThreads.length > 0 ? (
          <div
            className={cn(
              "relative space-y-0.5 group-data-[collapsible=icon]:hidden",
              SIDEBAR_PROJECT_GROUP_LINE_CLASS,
            )}
          >
            {managerThreadGroups.map((managerThreadGroup) => (
              <ManagerThreadGroupRow
                key={managerThreadGroup.managerThread.id}
                projectId={project.id}
                managerThreadGroup={managerThreadGroup}
                selectedThreadId={selectedThreadId}
                isManagerCollapsed={collapsedManagerIds.has(
                  managerThreadGroup.managerThread.id,
                )}
                onProjectSelect={onProjectSelect}
                onToggleManagerCollapsed={onToggleManagerCollapsed}
              />
            ))}
            {unmanagedStandardThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                projectId={project.id}
                thread={thread}
                isActive={selectedThreadId === thread.id}
                onProjectSelect={onProjectSelect}
                options={THREAD_ROW_DEFAULT_OPTIONS}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            message={
              threadListState.status === "unavailable"
                ? "Threads unavailable"
                : "No threads"
            }
            className="py-0.5 pl-8 pr-2 group-data-[collapsible=icon]:hidden"
            messageClassName="text-xs leading-4 text-sidebar-foreground/60"
          />
        )
      ) : null}
    </SidebarMenuItem>
  );
}

function areProjectRowPropsEqual(
  prev: ProjectRowProps,
  next: ProjectRowProps,
): boolean {
  if (
    prev.project !== next.project ||
    prev.threadListState !== next.threadListState ||
    prev.isActive !== next.isActive ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.isLocalPathInvalid !== next.isLocalPathInvalid ||
    prev.onProjectSelect !== next.onProjectSelect ||
    prev.onToggleProjectCollapsed !== next.onToggleProjectCollapsed ||
    prev.onToggleManagerCollapsed !== next.onToggleManagerCollapsed
  ) {
    return false;
  }
  // selectedThreadId is a shared sidebar prop; only projects containing the
  // previously- or newly-selected thread need to re-render.
  if (prev.selectedThreadId !== next.selectedThreadId) {
    if (prev.threadListState.status !== "ready") {
      return false;
    }
    for (const thread of prev.threadListState.threads) {
      if (
        thread.id === prev.selectedThreadId ||
        thread.id === next.selectedThreadId
      ) {
        return false;
      }
    }
  }
  if (prev.collapsedManagerIds === next.collapsedManagerIds) {
    return true;
  }
  // collapsedManagerIds is a shared sidebar prop; only invalidate if this
  // project's manager collapse state actually changed.
  if (prev.threadListState.status !== "ready") {
    return true;
  }
  for (const thread of prev.threadListState.threads) {
    if (thread.type !== "manager") continue;
    if (
      prev.collapsedManagerIds.has(thread.id) !==
      next.collapsedManagerIds.has(thread.id)
    ) {
      return false;
    }
  }
  return true;
}

export const ProjectRow = memo(ProjectRowComponent, areProjectRowPropsEqual);
