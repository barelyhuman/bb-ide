import { memo, useState } from "react";
import type { ThreadListEntry } from "@bb/domain";
import {
  Pill,
  SidebarMenuBadge,
  SidebarStickyTier,
  StatusPill,
} from "@bb/ui-core";
import { ChevronRight, CircleDashed, UserRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { ThreadActionsMenu } from "@/components/thread/ThreadActionsMenu";
import {
  COARSE_POINTER_DOT_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@bb/ui-core";
import {
  getEnvironmentWorkspaceDisplayIcon,
  getEnvironmentWorkspaceDisplayIconLabel,
} from "@/lib/environment-workspace-display";
import { isBusyThread, isUnreadDoneThread } from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@/lib/utils";

export type ThreadRowOptions =
  | {
      kind: "default";
    }
  | {
      kind: "manager";
      isCollapsed: boolean;
      managedChildCount: number;
      managedChildBusyCount: number;
      onToggleCollapsed: (threadId: string) => void;
    };

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  isPromoted?: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

interface ManagerChevronProps {
  isCollapsed: boolean;
  onToggle: () => void;
  threadTitle: string;
}

function ManagerChevron({
  isCollapsed,
  onToggle,
  threadTitle,
}: ManagerChevronProps) {
  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={
        isCollapsed
          ? `Expand ${threadTitle} threads`
          : `Collapse ${threadTitle} threads`
      }
      title={
        isCollapsed ? "Expand managed threads" : "Collapse managed threads"
      }
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none ring-sidebar-ring transition-colors hover:text-sidebar-foreground focus-visible:ring-2",
        COARSE_POINTER_GLYPH_BOX_CLASS,
      )}
    >
      <ChevronRight
        className={cn(
          "transition-transform duration-150",
          COARSE_POINTER_ICON_SIZE_CLASS,
          !isCollapsed && "rotate-90",
        )}
      />
    </button>
  );
}

interface ThreadLeadingGlyphProps {
  hasPendingInteraction: boolean;
  isBusy: boolean;
  showUnreadBadge: boolean;
}

function ThreadLeadingGlyph({
  hasPendingInteraction,
  isBusy,
  showUnreadBadge,
}: ThreadLeadingGlyphProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-sidebar-foreground/60",
        COARSE_POINTER_GLYPH_BOX_CLASS,
      )}
    >
      {hasPendingInteraction ? (
        <span
          className={cn(
            "rounded-full bg-attention",
            COARSE_POINTER_DOT_SIZE_CLASS,
          )}
          aria-label="Pending interaction requires attention"
          title="Pending interaction"
        />
      ) : isBusy ? (
        <CircleDashed
          className={cn("animate-spin", COARSE_POINTER_ICON_SIZE_CLASS)}
          aria-label="Thread working"
        />
      ) : showUnreadBadge ? (
        <span
          className={cn(
            "rounded-full bg-primary",
            COARSE_POINTER_DOT_SIZE_CLASS,
          )}
          aria-label="Unread thread requires attention"
          title="Unread thread requires attention"
        />
      ) : null}
    </span>
  );
}

function ThreadRowComponent({
  projectId,
  thread,
  isActive,
  isPromoted = false,
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
  const threadTitle = getThreadDisplayTitle(thread);
  const managerOptions = options.kind === "manager" ? options : null;
  const isManager = managerOptions !== null;
  const isManagerCollapsed = managerOptions?.isCollapsed ?? false;
  const managedChildCount = managerOptions?.managedChildCount ?? 0;
  const hasManagedChildren = managedChildCount > 0;
  const managedChildBusyCount = managerOptions?.managedChildBusyCount ?? 0;
  const isManagerBusy =
    isManager && (threadIsBusy || managedChildBusyCount > 0);
  // Manager busy state is rendered over the trailing manager icon so the
  // leading glyph remains reserved for the manager expand/collapse affordance.
  const leadingGlyphIsBusy = isManager ? false : threadIsBusy;
  const EnvironmentIcon = getEnvironmentWorkspaceDisplayIcon(
    thread.environmentWorkspaceDisplayKind,
  );
  const environmentIconLabel = getEnvironmentWorkspaceDisplayIconLabel(
    thread.environmentWorkspaceDisplayKind,
  );
  const rowClassName = cn(
    "group/thread-row flex w-full items-center gap-2 rounded-md pr-0 text-sm transition-colors",
    !isManager && "relative",
    COARSE_POINTER_ROW_HEIGHT_CLASS,
    "pl-2",
    isActive
      ? "bg-sidebar-border text-sidebar-foreground"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );
  const rowContent = (
    <>
      <NavLink
        to={`/projects/${projectId}/threads/${thread.id}`}
        onClick={onProjectSelect}
        aria-label={`Open ${threadTitle}`}
        title={`Open ${threadTitle}`}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      {managerOptions && hasManagedChildren ? (
        <ManagerChevron
          isCollapsed={isManagerCollapsed}
          onToggle={() => {
            managerOptions.onToggleCollapsed(thread.id);
          }}
          threadTitle={threadTitle}
        />
      ) : (
        <ThreadLeadingGlyph
          hasPendingInteraction={hasPendingInteraction}
          isBusy={leadingGlyphIsBusy}
          showUnreadBadge={showUnreadBadge}
        />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate">{threadTitle}</span>
        {isManager ? (
          <StatusPill variant="outline" className="shrink-0">
            manager
          </StatusPill>
        ) : null}
      </span>
      {isPromoted ? (
        <Pill variant="emphasis" className="relative z-10">
          promoted
        </Pill>
      ) : null}
      <span
        className={cn(
          "flex shrink-0 items-center justify-end",
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        )}
      >
        {isManager && managedChildCount > 0 ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center",
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            )}
            aria-label={`${managedChildCount} managed thread${managedChildCount === 1 ? "" : "s"}`}
            title={`${managedChildCount} managed thread${managedChildCount === 1 ? "" : "s"}`}
          >
            <SidebarMenuBadge className="rounded-full bg-sidebar-foreground/10 px-1.5 text-sidebar-foreground/80">
              {managedChildCount}
            </SidebarMenuBadge>
          </span>
        ) : null}
        <span
          className={cn(
            "relative shrink-0",
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          )}
        >
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center transition-opacity",
              isActionsOpen ? "opacity-0" : "group-hover/thread-row:opacity-0",
            )}
          >
            {isManager ? (
              <span
                className={cn(
                  "relative inline-flex items-center justify-center",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              >
                <UserRound
                  className={cn(
                    "text-sidebar-foreground/70",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                    isManagerBusy && "opacity-40",
                  )}
                  aria-label="Manager"
                />
                {isManagerBusy ? (
                  <CircleDashed
                    className={cn(
                      "absolute animate-spin text-sidebar-foreground/80",
                      COARSE_POINTER_ICON_SIZE_CLASS,
                    )}
                    aria-label="Manager working"
                  />
                ) : null}
              </span>
            ) : EnvironmentIcon ? (
              <EnvironmentIcon
                className={cn(
                  "text-sidebar-foreground/70",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
                aria-label={environmentIconLabel ?? undefined}
              />
            ) : null}
          </span>
          <div
            className={cn(
              "absolute inset-0 z-10 flex items-center justify-end transition-opacity",
              isActionsOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 group-hover/thread-row:pointer-events-auto group-hover/thread-row:opacity-100",
            )}
          >
            <ThreadActionsMenu
              thread={thread}
              triggerClassName={cn(
                "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
              onOpenChange={setIsActionsOpen}
            />
          </div>
        </span>
      </span>
    </>
  );

  if (isManager) {
    return (
      <SidebarStickyTier tier="manager" className={rowClassName}>
        {rowContent}
      </SidebarStickyTier>
    );
  }

  return <div className={rowClassName}>{rowContent}</div>;
}

export const ThreadRow = memo(ThreadRowComponent);
