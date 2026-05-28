import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { flushSync } from "react-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { NavLink, useNavigate } from "react-router-dom";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import { useArchiveEnvironmentThreads } from "@/hooks/mutations/environment-mutations";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import {
  SidebarStickyTier,
  type SidebarStickyTierKind,
} from "@/components/ui/sidebar.js";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "@/components/project/ProjectActionsMenu";
import {
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_PROJECT_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  getCollapsedChildActivity,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { cn } from "@/lib/utils";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
  type NeighborReorderRequest,
} from "@/lib/neighbor-reorder";
import { appToast } from "@/components/ui/app-toast";
import {
  ThreadRow,
  ThreadStatusGlyph,
  type ThreadRowDragBindings,
  type ThreadRowOptions,
} from "./ThreadRow";
import {
  buildProjectThreadGroups,
  type EnvironmentThreadGroup,
  type ManagerThreadGroup,
} from "./projectThreadGroups";
import {
  SIDEBAR_MANAGED_ENV_GROUP_LINE_CLASS,
  SIDEBAR_MANAGER_CHILD_ROW_PADDING_CLASS,
  SIDEBAR_MANAGER_GROUP_LINE_CLASS,
  SIDEBAR_MANAGER_LINE_CONTINUATION_CLASS,
  SIDEBAR_MANAGER_ROW_PADDING_CLASS,
  SIDEBAR_PROJECT_GROUP_LINE_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
} from "./sidebarRowClasses";
import { SIDEBAR_SORTABLE_TRANSITION } from "./sortableMotion";
import {
  useDragClickSuppression,
  type ConsumeDragClickSuppression,
} from "./useDragClickSuppression";

const THREAD_ROW_DEFAULT_OPTIONS: ThreadRowOptions = { kind: "default" };
const THREAD_ROW_MANAGED_CHILD_OPTIONS: ThreadRowOptions = {
  kind: "managed-child",
};
const THREAD_ROW_ENV_GROUPED_CHILD_OPTIONS: ThreadRowOptions = {
  kind: "env-grouped-child",
};
const THREAD_ROW_ENV_GROUPED_MANAGED_CHILD_OPTIONS: ThreadRowOptions = {
  kind: "env-grouped-managed-child",
};

type EnvironmentStickyTier = Extract<
  SidebarStickyTierKind,
  "manager" | "environment"
>;

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

export interface ProjectRowDragBindings {
  attributes: DraggableAttributes;
  disabled: boolean;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLDivElement | null) => void;
}

export interface ProjectManagerReorderCallbacks {
  onSettled: () => void;
}

export interface ProjectRowProps {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  selectedThreadId?: string;
  isActive: boolean;
  isCollapsed: boolean;
  collapsedManagerIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  isLocalPathInvalid: boolean;
  onProjectSelect?: () => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleManagerCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  isManagerReorderPending?: boolean;
  isProjectDragging?: boolean;
  onReorderManager?: (
    projectId: string,
    request: NeighborReorderRequest,
    callbacks: ProjectManagerReorderCallbacks,
  ) => void;
  consumeProjectClickSuppression?: ConsumeDragClickSuppression;
  projectDragBindings?: ProjectRowDragBindings;
  projectRowRef?: (element: HTMLLIElement | null) => void;
  projectRowStyle?: CSSProperties;
}

type ProjectItemClickCaptureHandler = MouseEventHandler<HTMLLIElement>;
type ProjectThreadListClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

const EMPTY_PROJECT_THREADS: ThreadListEntry[] = [];

interface ManagerThreadOrderEntry {
  id: string;
}

function getManagerThreadGroupId(
  managerThreadGroup: ManagerThreadGroup,
): string {
  return managerThreadGroup.managerThread.id;
}

function hasSameManagerThreadOrder(
  order: readonly ManagerThreadOrderEntry[],
  managerThreadGroups: readonly ManagerThreadGroup[],
): boolean {
  if (order.length !== managerThreadGroups.length) {
    return false;
  }
  return order.every(
    (item, index) => item.id === managerThreadGroups[index]?.managerThread.id,
  );
}

interface ManagerThreadGroupRowProps {
  projectId: string;
  managerThreadGroup: ManagerThreadGroup;
  selectedThreadId?: string;
  isManagerCollapsed: boolean;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleManagerCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  isDragging?: boolean;
  dragBindings?: ThreadRowDragBindings;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

interface SortableManagerThreadGroupRowProps extends ManagerThreadGroupRowProps {
  disabled: boolean;
}

interface EnvironmentThreadGroupHeaderProps {
  environmentId: string;
  representativeThread: ThreadListEntry;
  paddingClass: string;
  stickyTier: EnvironmentStickyTier;
  parentLineClass?: string;
  childCount: number;
  childActivity: CollapsedChildActivity;
  isCollapsed: boolean;
  archiveThreadsPending?: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onToggleCollapsed: (environmentId: string) => void;
}

interface EnvironmentThreadGroupHeaderActionsProps {
  archiveThreadsPending: boolean;
  onArchiveThreads?: () => void;
  onCreateNewThread?: () => void;
  onOpenChange: (open: boolean) => void;
}

interface UseArchiveEnvironmentThreadGroupActionArgs {
  environmentId: string;
  projectId: string;
  selectedThreadId?: string;
}

interface UseArchiveEnvironmentThreadGroupActionResult {
  archiveThreadsPending: boolean;
  onArchiveThreads: () => void;
}

function formatArchivedWorktreeThreadMessage(threadCount: number): string {
  return threadCount === 1
    ? "Archived 1 worktree thread"
    : `Archived ${threadCount} worktree threads`;
}

function useArchiveEnvironmentThreadGroupAction({
  environmentId,
  projectId,
  selectedThreadId,
}: UseArchiveEnvironmentThreadGroupActionArgs): UseArchiveEnvironmentThreadGroupActionResult {
  const navigate = useNavigate();
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const {
    isPending: archiveThreadsIsPending,
    mutate: archiveThreads,
    variables,
  } = archiveEnvironmentThreads;
  const archiveThreadsPending =
    archiveThreadsIsPending && variables?.id === environmentId;
  const onArchiveThreads = useCallback(() => {
    archiveThreads(
      { id: environmentId },
      {
        onSuccess: (response) => {
          appToast.success(
            formatArchivedWorktreeThreadMessage(
              response.archivedThreadIds.length,
            ),
          );
          if (
            selectedThreadId &&
            response.archivedThreadIds.includes(selectedThreadId)
          ) {
            navigate(`/projects/${projectId}`);
          }
        },
      },
    );
  }, [archiveThreads, environmentId, navigate, projectId, selectedThreadId]);

  return {
    archiveThreadsPending,
    onArchiveThreads,
  };
}

function EnvironmentThreadGroupHeaderActions({
  archiveThreadsPending,
  onArchiveThreads,
  onCreateNewThread,
  onOpenChange,
}: EnvironmentThreadGroupHeaderActionsProps) {
  if (!onCreateNewThread && !onArchiveThreads) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Worktree actions"
            title="Worktree actions"
            className={cn(
              "rounded-md p-0 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onCreateNewThread ? (
            <DropdownMenuItem onSelect={onCreateNewThread}>
              New thread
            </DropdownMenuItem>
          ) : null}
          {onArchiveThreads ? (
            <DropdownMenuItem
              disabled={archiveThreadsPending}
              onSelect={(event) => {
                if (archiveThreadsPending) {
                  event.preventDefault();
                  return;
                }
                onArchiveThreads();
              }}
            >
              Archive worktree
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function EnvironmentThreadGroupHeader({
  environmentId,
  representativeThread,
  paddingClass,
  stickyTier,
  parentLineClass,
  childCount,
  childActivity,
  isCollapsed,
  archiveThreadsPending = false,
  onArchiveThreads,
  onCreateNewThread,
  onToggleCollapsed,
}: EnvironmentThreadGroupHeaderProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const branchName = representativeThread.environmentBranchName;
  const headerTitle = branchName ? `Worktree: ${branchName}` : "Worktree";
  const iconName = getEnvironmentWorkspaceLabelIconName(
    representativeThread.environmentWorkspaceDisplayKind,
  );
  // Collapsed: the header speaks for its hidden children through one status
  // glyph (pending > working > unread). Expanded: the children show their own
  // glyphs, and the synthetic header has no status of its own.
  const showRollupGlyph =
    isCollapsed &&
    (childActivity.pending || childActivity.working || childActivity.unread);
  return (
    <SidebarStickyTier
      tier={stickyTier}
      className={cn(
        "group/env-row",
        SIDEBAR_ROW_BASE_CLASS,
        paddingClass,
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
      )}
      title={headerTitle}
    >
      {parentLineClass ? (
        <span className={parentLineClass} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-label={
          isCollapsed
            ? `Expand ${headerTitle} threads`
            : `Collapse ${headerTitle} threads`
        }
        title={
          isCollapsed ? "Expand worktree threads" : "Collapse worktree threads"
        }
        onClick={() => {
          onToggleCollapsed(environmentId);
        }}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      <span
        className={cn(
          "pointer-events-none relative z-10 inline-flex shrink-0 items-center justify-center text-subtle-foreground",
          COARSE_POINTER_GLYPH_BOX_CLASS,
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "absolute inline-flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover/env-row:opacity-0 group-has-[:focus-visible]/env-row:opacity-0",
            COARSE_POINTER_ICON_SIZE_CLASS,
          )}
        >
          <Icon
            name={iconName}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
        <span
          className={cn(
            "absolute inline-flex items-center justify-center opacity-0 transition-all duration-150 group-hover/env-row:opacity-100 group-has-[:focus-visible]/env-row:opacity-100",
            COARSE_POINTER_ICON_SIZE_CLASS,
            !isCollapsed && "rotate-90",
          )}
        >
          <Icon
            name="ChevronRight"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </span>
      </span>
      <span className="pointer-events-none relative z-10 min-w-0 flex-1 truncate text-left">
        <span>Worktree</span>
        {branchName ? (
          <>
            <span>:</span>{" "}
            <span className="text-muted-foreground">{branchName}</span>
          </>
        ) : null}
      </span>
      <span
        className={cn(
          "relative z-10 shrink-0",
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        )}
      >
        {showRollupGlyph ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center text-subtle-foreground transition-opacity",
              isActionsOpen
                ? "opacity-0"
                : "group-hover/env-row:opacity-0 group-has-[:focus-visible]/env-row:opacity-0",
            )}
          >
            <ThreadStatusGlyph
              hasPendingInteraction={childActivity.pending}
              isBusy={childActivity.working}
              showUnreadBadge={childActivity.unread}
            />
          </span>
        ) : null}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-end transition-opacity",
            isActionsOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover/env-row:pointer-events-auto group-hover/env-row:opacity-100 group-has-[:focus-visible]/env-row:pointer-events-auto group-has-[:focus-visible]/env-row:opacity-100",
          )}
        >
          <EnvironmentThreadGroupHeaderActions
            archiveThreadsPending={archiveThreadsPending}
            onArchiveThreads={onArchiveThreads}
            onCreateNewThread={onCreateNewThread}
            onOpenChange={setIsActionsOpen}
          />
        </div>
      </span>
    </SidebarStickyTier>
  );
}

interface EnvironmentThreadGroupRowProps {
  projectId: string;
  environmentThreadGroup: EnvironmentThreadGroup;
  selectedThreadId?: string;
  isCollapsed: boolean;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

const EnvironmentThreadGroupRow = memo(function EnvironmentThreadGroupRow({
  projectId,
  environmentThreadGroup,
  selectedThreadId,
  isCollapsed,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
}: EnvironmentThreadGroupRowProps) {
  const { environmentId, threads } = environmentThreadGroup;
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId,
    environmentId,
  });
  const { archiveThreadsPending, onArchiveThreads } =
    useArchiveEnvironmentThreadGroupAction({
      environmentId,
      projectId,
      selectedThreadId,
    });
  const handleCreateNewThread = useCallback(() => {
    onProjectSelect?.();
    createThreadInWorktree();
  }, [createThreadInWorktree, onProjectSelect]);
  return (
    <>
      <EnvironmentThreadGroupHeader
        environmentId={environmentId}
        representativeThread={threads[0]}
        paddingClass={SIDEBAR_MANAGER_ROW_PADDING_CLASS}
        stickyTier="manager"
        childCount={threads.length}
        childActivity={getCollapsedChildActivity(threads)}
        isCollapsed={isCollapsed}
        archiveThreadsPending={archiveThreadsPending}
        onArchiveThreads={onArchiveThreads}
        onCreateNewThread={handleCreateNewThread}
        onToggleCollapsed={onToggleEnvironmentCollapsed}
      />
      {!isCollapsed ? (
        <div
          className={cn(
            "relative space-y-px",
            SIDEBAR_MANAGER_GROUP_LINE_CLASS,
          )}
        >
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              projectId={projectId}
              thread={thread}
              isActive={selectedThreadId === thread.id}
              onProjectSelect={onProjectSelect}
              options={THREAD_ROW_ENV_GROUPED_CHILD_OPTIONS}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

interface ManagedEnvironmentThreadSubGroupProps {
  projectId: string;
  environmentThreadGroup: EnvironmentThreadGroup;
  selectedThreadId?: string;
  isCollapsed: boolean;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
}

function ManagedEnvironmentThreadSubGroup({
  projectId,
  environmentThreadGroup,
  selectedThreadId,
  isCollapsed,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
}: ManagedEnvironmentThreadSubGroupProps) {
  const { environmentId, threads } = environmentThreadGroup;
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId,
    environmentId,
  });
  const { archiveThreadsPending, onArchiveThreads } =
    useArchiveEnvironmentThreadGroupAction({
      environmentId,
      projectId,
      selectedThreadId,
    });
  const handleCreateNewThread = useCallback(() => {
    onProjectSelect?.();
    createThreadInWorktree();
  }, [createThreadInWorktree, onProjectSelect]);
  return (
    <>
      <EnvironmentThreadGroupHeader
        environmentId={environmentId}
        representativeThread={threads[0]}
        paddingClass={SIDEBAR_MANAGER_CHILD_ROW_PADDING_CLASS}
        stickyTier="environment"
        parentLineClass={SIDEBAR_MANAGER_LINE_CONTINUATION_CLASS}
        childCount={threads.length}
        childActivity={getCollapsedChildActivity(threads)}
        isCollapsed={isCollapsed}
        archiveThreadsPending={archiveThreadsPending}
        onArchiveThreads={onArchiveThreads}
        onCreateNewThread={handleCreateNewThread}
        onToggleCollapsed={onToggleEnvironmentCollapsed}
      />
      {!isCollapsed ? (
        <div
          className={cn(
            "relative space-y-px",
            SIDEBAR_MANAGED_ENV_GROUP_LINE_CLASS,
          )}
        >
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              projectId={projectId}
              thread={thread}
              isActive={selectedThreadId === thread.id}
              onProjectSelect={onProjectSelect}
              options={THREAD_ROW_ENV_GROUPED_MANAGED_CHILD_OPTIONS}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

const ManagerThreadGroupRow = memo(function ManagerThreadGroupRow({
  projectId,
  managerThreadGroup,
  selectedThreadId,
  isManagerCollapsed,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleManagerCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  isDragging = false,
  dragBindings,
  sortableRef,
  sortableStyle,
}: ManagerThreadGroupRowProps) {
  const { managerThread, managedItems, stats } = managerThreadGroup;
  const managerOptions = useMemo<ThreadRowOptions>(
    () => ({
      kind: "manager",
      isCollapsed: isManagerCollapsed,
      managedChildCount: stats.managedChildCount,
      managedChildActivity: stats.managedChildActivity,
      onToggleCollapsed: onToggleManagerCollapsed,
      ...(consumeClickSuppression ? { consumeClickSuppression } : {}),
      ...(dragBindings ? { dragBindings } : {}),
    }),
    [
      consumeClickSuppression,
      dragBindings,
      isManagerCollapsed,
      onToggleManagerCollapsed,
      stats.managedChildCount,
      stats.managedChildActivity,
    ],
  );
  const showManagedChildren = !isManagerCollapsed && managedItems.length > 0;
  return (
    <div
      ref={sortableRef}
      style={sortableStyle}
      className={cn("space-y-0.5", isDragging && "relative z-20")}
    >
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
          {managedItems.map((item) =>
            item.kind === "thread" ? (
              <ThreadRow
                key={`thread:${item.thread.id}`}
                projectId={projectId}
                thread={item.thread}
                isActive={selectedThreadId === item.thread.id}
                onProjectSelect={onProjectSelect}
                options={THREAD_ROW_MANAGED_CHILD_OPTIONS}
              />
            ) : (
              <ManagedEnvironmentThreadSubGroup
                key={`env:${item.group.environmentId}`}
                projectId={projectId}
                environmentThreadGroup={item.group}
                selectedThreadId={selectedThreadId}
                isCollapsed={collapsedEnvironmentIds.has(
                  item.group.environmentId,
                )}
                onProjectSelect={onProjectSelect}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
});

const SortableManagerThreadGroupRow = memo(
  function SortableManagerThreadGroupRow({
    disabled,
    managerThreadGroup,
    ...props
  }: SortableManagerThreadGroupRowProps) {
    const managerThreadId = managerThreadGroup.managerThread.id;
    const {
      attributes,
      isDragging,
      listeners,
      setActivatorNodeRef,
      setNodeRef,
      transform,
      transition,
    } = useSortable({
      id: managerThreadId,
      disabled,
      transition: SIDEBAR_SORTABLE_TRANSITION,
    });
    const style = useMemo<CSSProperties>(
      () => ({
        transform: CSS.Transform.toString(transform),
        transition,
      }),
      [transform, transition],
    );

    return (
      <ManagerThreadGroupRow
        {...props}
        managerThreadGroup={managerThreadGroup}
        isDragging={isDragging}
        dragBindings={{
          attributes,
          disabled,
          listeners,
          setActivatorNodeRef,
        }}
        sortableRef={setNodeRef}
        sortableStyle={style}
      />
    );
  },
);

function ProjectRowComponent({
  project,
  threadListState,
  selectedThreadId,
  isActive,
  isCollapsed,
  collapsedManagerIds,
  collapsedEnvironmentIds,
  isLocalPathInvalid,
  onProjectSelect,
  onToggleProjectCollapsed,
  onToggleManagerCollapsed,
  onToggleEnvironmentCollapsed,
  isManagerReorderPending = false,
  isProjectDragging = false,
  onReorderManager,
  consumeProjectClickSuppression,
  projectDragBindings,
  projectRowRef,
  projectRowStyle,
}: ProjectRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const projectThreads =
    threadListState.status === "ready"
      ? threadListState.threads
      : EMPTY_PROJECT_THREADS;
  const { managerThreadGroups, unmanagedItems } = useMemo(
    () => buildProjectThreadGroups(projectThreads),
    [projectThreads],
  );
  const [optimisticManagerThreadOrder, setOptimisticManagerThreadOrder] =
    useState<ManagerThreadOrderEntry[] | null>(null);
  const renderedManagerThreadGroups = useMemo(() => {
    if (!optimisticManagerThreadOrder) {
      return managerThreadGroups;
    }
    const groupsById = new Map(
      managerThreadGroups.map((managerThreadGroup) => [
        getManagerThreadGroupId(managerThreadGroup),
        managerThreadGroup,
      ]),
    );
    const orderedGroups: ManagerThreadGroup[] = [];
    for (const item of optimisticManagerThreadOrder) {
      const managerThreadGroup = groupsById.get(item.id);
      if (!managerThreadGroup) {
        return managerThreadGroups;
      }
      orderedGroups.push(managerThreadGroup);
    }
    return orderedGroups;
  }, [managerThreadGroups, optimisticManagerThreadOrder]);
  const renderedManagerThreadIds = useMemo(
    () => renderedManagerThreadGroups.map(getManagerThreadGroupId),
    [renderedManagerThreadGroups],
  );
  const managerReorderDisabled =
    isManagerReorderPending ||
    !onReorderManager ||
    renderedManagerThreadGroups.length < 2;
  const {
    beginDragClickSuppression: beginManagerDragClickSuppression,
    clearDragClickSuppressionSoon: clearManagerDragClickSuppressionSoon,
    consumeDragClickSuppression: consumeManagerClickSuppression,
  } = useDragClickSuppression();
  const managerSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleManagerDragStart = useCallback((_event: DragStartEvent) => {
    beginManagerDragClickSuppression();
  }, [beginManagerDragClickSuppression]);
  const handleManagerDragCancel = useCallback(() => {
    clearManagerDragClickSuppressionSoon();
  }, [clearManagerDragClickSuppressionSoon]);
  const handleManagerDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearManagerDragClickSuppressionSoon();
      if (isManagerReorderPending) {
        return;
      }
      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: renderedManagerThreadGroups.map(
          (managerThreadGroup) => managerThreadGroup.managerThread,
        ),
      });
      if (!request) {
        return;
      }
      const nextOrder = applyNeighborReorder({
        items: renderedManagerThreadGroups.map((managerThreadGroup) => ({
          id: managerThreadGroup.managerThread.id,
        })),
        request,
      });
      flushSync(() => {
        setOptimisticManagerThreadOrder(nextOrder);
      });
      onReorderManager?.(project.id, request, {
        onSettled: () => {
          setOptimisticManagerThreadOrder(null);
        },
      });
    },
    [
      clearManagerDragClickSuppressionSoon,
      isManagerReorderPending,
      onReorderManager,
      project.id,
      renderedManagerThreadGroups,
    ],
  );
  useEffect(() => {
    if (!optimisticManagerThreadOrder) {
      return;
    }
    if (
      hasSameManagerThreadOrder(
        optimisticManagerThreadOrder,
        managerThreadGroups,
      )
    ) {
      setOptimisticManagerThreadOrder(null);
    }
  }, [managerThreadGroups, optimisticManagerThreadOrder]);
  const handleProjectRowClickCapture = useCallback<ProjectItemClickCaptureHandler>(
    (event) => {
      if (!consumeProjectClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeProjectClickSuppression],
  );
  const handleManagerListClickCapture =
    useCallback<ProjectThreadListClickCaptureHandler>(
      (event) => {
        if (!consumeManagerClickSuppression()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      [consumeManagerClickSuppression],
    );
  return (
    <SidebarMenuItem
      ref={projectRowRef}
      style={projectRowStyle}
      data-sidebar-sticky-project-item=""
      className={cn(isProjectDragging && "relative z-30")}
      onClickCapture={handleProjectRowClickCapture}
    >
      <ProjectActionsContextMenu
        project={project}
        onOpenChange={setIsContextActionsOpen}
      >
        <SidebarStickyTier
          ref={projectDragBindings?.setActivatorNodeRef}
          tier="project"
          className={cn(
            "group/project-row flex w-full items-center rounded-md text-sm transition-colors",
            isActive
              ? "bg-sidebar-border text-sidebar-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            projectDragBindings &&
              !projectDragBindings.disabled &&
              "select-none cursor-grab active:cursor-grabbing",
          )}
          title={project.name}
          {...projectDragBindings?.attributes}
          {...(projectDragBindings?.listeners ?? {})}
        >
          <NavLink
            to={`/projects/${project.id}`}
            onClick={() => {
              onProjectSelect?.();
            }}
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
              "relative z-10 flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:text-sidebar-foreground focus-visible:ring-2",
              COARSE_POINTER_PROJECT_ROW_ACTION_SIZE_CLASS,
            )}
          >
            <span
              className={cn(
                "relative inline-flex items-center justify-center",
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "absolute opacity-0 transition-all duration-150 group-hover/project-row:opacity-100",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                  !isCollapsed && "rotate-90",
                )}
              />
              {isCollapsed ? (
                <Icon
                  name="Folder"
                  className={cn(
                    "absolute opacity-100 transition-opacity duration-150 group-hover/project-row:opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              ) : (
                <Icon
                  name="FolderOpen"
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
              <Icon
                name="AlertTriangle"
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </NavLink>
          ) : null}
          <ProjectActionsMenu
            project={project}
            onOpenChange={setIsDropdownActionsOpen}
            triggerClassName={cn(
              "relative z-10 text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              isActionsOpen
                ? "opacity-100"
                : "opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100",
            )}
          />
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
            onClickCapture={handleManagerListClickCapture}
          >
            {renderedManagerThreadGroups.length > 1 ? (
              <DndContext
                sensors={managerSensors}
                collisionDetection={closestCenter}
                onDragStart={handleManagerDragStart}
                onDragCancel={handleManagerDragCancel}
                onDragEnd={handleManagerDragEnd}
              >
                <SortableContext
                  items={renderedManagerThreadIds}
                  strategy={verticalListSortingStrategy}
                >
                  {renderedManagerThreadGroups.map((managerThreadGroup) => (
                    <SortableManagerThreadGroupRow
                      key={managerThreadGroup.managerThread.id}
                      disabled={managerReorderDisabled}
                      projectId={project.id}
                      managerThreadGroup={managerThreadGroup}
                      selectedThreadId={selectedThreadId}
                      isManagerCollapsed={collapsedManagerIds.has(
                        managerThreadGroup.managerThread.id,
                      )}
                      collapsedEnvironmentIds={collapsedEnvironmentIds}
                      onProjectSelect={onProjectSelect}
                      onToggleManagerCollapsed={onToggleManagerCollapsed}
                      onToggleEnvironmentCollapsed={
                        onToggleEnvironmentCollapsed
                      }
                      consumeClickSuppression={consumeManagerClickSuppression}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              renderedManagerThreadGroups.map((managerThreadGroup) => (
                <ManagerThreadGroupRow
                  key={managerThreadGroup.managerThread.id}
                  projectId={project.id}
                  managerThreadGroup={managerThreadGroup}
                  selectedThreadId={selectedThreadId}
                  isManagerCollapsed={collapsedManagerIds.has(
                    managerThreadGroup.managerThread.id,
                  )}
                  collapsedEnvironmentIds={collapsedEnvironmentIds}
                  onProjectSelect={onProjectSelect}
                  onToggleManagerCollapsed={onToggleManagerCollapsed}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                  consumeClickSuppression={consumeManagerClickSuppression}
                />
              ))
            )}
            {unmanagedItems.map((item) =>
              item.kind === "thread" ? (
                <ThreadRow
                  key={`thread:${item.thread.id}`}
                  projectId={project.id}
                  thread={item.thread}
                  isActive={selectedThreadId === item.thread.id}
                  onProjectSelect={onProjectSelect}
                  options={THREAD_ROW_DEFAULT_OPTIONS}
                />
              ) : (
                <EnvironmentThreadGroupRow
                  key={`env:${item.group.environmentId}`}
                  projectId={project.id}
                  environmentThreadGroup={item.group}
                  selectedThreadId={selectedThreadId}
                  isCollapsed={collapsedEnvironmentIds.has(
                    item.group.environmentId,
                  )}
                  onProjectSelect={onProjectSelect}
                  onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
                />
              ),
            )}
          </div>
        ) : (
          <EmptyState
            message={
              threadListState.status === "unavailable"
                ? "Threads unavailable"
                : "No threads"
            }
            className="py-0.5 pl-8 pr-2 group-data-[collapsible=icon]:hidden"
            messageClassName="text-xs font-medium leading-4 text-sidebar-foreground/85"
          />
        )
      ) : null}
    </SidebarMenuItem>
  );
}

interface ProjectRowPropsComparisonArgs {
  prev: ProjectRowProps;
  next: ProjectRowProps;
}

function hasCollapsedManagerStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedManagerIds === next.collapsedManagerIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  for (const thread of prev.threadListState.threads) {
    if (thread.type !== "manager") continue;
    if (
      prev.collapsedManagerIds.has(thread.id) !==
      next.collapsedManagerIds.has(thread.id)
    ) {
      return true;
    }
  }

  return false;
}

function hasCollapsedEnvironmentStateChanged({
  prev,
  next,
}: ProjectRowPropsComparisonArgs): boolean {
  if (prev.collapsedEnvironmentIds === next.collapsedEnvironmentIds) {
    return false;
  }
  if (prev.threadListState.status !== "ready") {
    return false;
  }

  for (const thread of prev.threadListState.threads) {
    if (thread.environmentId === null) continue;
    if (
      prev.collapsedEnvironmentIds.has(thread.environmentId) !==
      next.collapsedEnvironmentIds.has(thread.environmentId)
    ) {
      return true;
    }
  }

  return false;
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
    prev.onToggleManagerCollapsed !== next.onToggleManagerCollapsed ||
    prev.onToggleEnvironmentCollapsed !== next.onToggleEnvironmentCollapsed ||
    prev.isManagerReorderPending !== next.isManagerReorderPending ||
    prev.isProjectDragging !== next.isProjectDragging ||
    prev.onReorderManager !== next.onReorderManager ||
    prev.consumeProjectClickSuppression !==
      next.consumeProjectClickSuppression ||
    prev.projectDragBindings !== next.projectDragBindings ||
    prev.projectRowRef !== next.projectRowRef ||
    prev.projectRowStyle !== next.projectRowStyle
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
  // Collapsed row sets are shared sidebar props; only invalidate if this
  // project's manager or worktree-env collapse state actually changed.
  if (prev.threadListState.status !== "ready") {
    return true;
  }
  return (
    !hasCollapsedManagerStateChanged({ prev, next }) &&
    !hasCollapsedEnvironmentStateChanged({ prev, next })
  );
}

export const ProjectRow = memo(ProjectRowComponent, areProjectRowPropsEqual);
