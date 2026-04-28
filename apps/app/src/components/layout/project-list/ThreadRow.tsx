import { useState } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { Pill } from "@bb/ui-core";
import {
  ChevronDown,
  ChevronRight,
  CircleDashed,
  UserRound,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { ThreadActionsMenu } from "@/components/thread/ThreadActionsMenu";
import { SidebarMenuBadge } from "@/components/ui/sidebar";
import {
  COARSE_POINTER_DOT_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_GLYPH_BOX_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_ROW_HEIGHT_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
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
      hasManagedChildren: boolean;
      isCollapsed: boolean;
      managedChildCount: number;
      managedChildBusyCount: number;
    }
  | {
      kind: "managed-child";
    };

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  isPromoted?: boolean;
  onProjectSelect?: () => void;
  onToggleManagerCollapsed?: (threadId: string) => void;
  options: ThreadRowOptions;
}

interface ManagerChevronProps {
  isCollapsed: boolean;
  isBusy: boolean;
  onToggle: () => void;
  threadTitle: string;
}

function ManagerChevron({
  isCollapsed,
  isBusy,
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
      <span
        className={cn(
          "relative inline-flex items-center justify-center",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
      >
        {isBusy ? (
          <CircleDashed
            className={cn(
              "absolute animate-spin opacity-100 transition-opacity duration-150 group-hover/thread-row:opacity-0",
              COARSE_POINTER_ICON_SIZE_CLASS,
            )}
            aria-hidden
          />
        ) : null}
        <ChevronRight
          className={cn(
            "absolute transition-all duration-150",
            COARSE_POINTER_ICON_SIZE_CLASS,
            !isCollapsed && "rotate-90",
            isBusy
              ? "opacity-0 group-hover/thread-row:opacity-100"
              : "opacity-100",
          )}
        />
      </span>
    </button>
  );
}

interface ThreadLeadingGlyphProps {
  hasPendingInteraction: boolean;
  isManagedChild: boolean;
  isBusy: boolean;
  showUnreadBadge: boolean;
}

function ThreadLeadingGlyph({
  hasPendingInteraction,
  isManagedChild,
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
      {isManagedChild ? (
        <ChevronDown
          aria-hidden="true"
          className={cn("rotate-45", COARSE_POINTER_ICON_SIZE_SHRINK_CLASS)}
        />
      ) : hasPendingInteraction ? (
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

export function ThreadRow({
  projectId,
  thread,
  isActive,
  isPromoted = false,
  onProjectSelect,
  onToggleManagerCollapsed,
  options,
}: ThreadRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const hasPendingInteraction = thread.hasPendingInteraction;
  const threadIsBusy = isBusyThread(thread) && !hasPendingInteraction;
  const showUnreadBadge = !hasPendingInteraction && isUnreadDoneThread(thread);
  const threadTitle = getThreadDisplayTitle(thread);
  const isManager = options.kind === "manager";
  const isManagedChild = options.kind === "managed-child";
  const hasManagedChildren =
    options.kind === "manager" && options.hasManagedChildren;
  const isManagerCollapsed = options.kind === "manager" && options.isCollapsed;
  const managedChildCount =
    options.kind === "manager" ? options.managedChildCount : 0;
  const managedChildBusyCount =
    options.kind === "manager" ? options.managedChildBusyCount : 0;
  const isManagerBusy =
    isManager && (threadIsBusy || managedChildBusyCount > 0);
  const EnvironmentIcon = getEnvironmentWorkspaceDisplayIcon(
    thread.environmentWorkspaceDisplayKind,
  );
  const environmentIconLabel = getEnvironmentWorkspaceDisplayIconLabel(
    thread.environmentWorkspaceDisplayKind,
  );

  return (
    <div
      className={cn(
        "group/thread-row relative flex w-full items-center gap-2 rounded-md pr-0 text-sm transition-colors",
        isManagedChild
          ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
          : COARSE_POINTER_ROW_HEIGHT_CLASS,
        isManagedChild ? "pl-6 text-sidebar-foreground/60" : "pl-2",
        isActive
          ? "bg-sidebar-border/80 text-sidebar-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <NavLink
        to={`/projects/${projectId}/threads/${thread.id}`}
        onClick={onProjectSelect}
        aria-label={`Open ${threadTitle}`}
        title={`Open ${threadTitle}`}
        className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
      />
      {isManager && hasManagedChildren && onToggleManagerCollapsed ? (
        <ManagerChevron
          isCollapsed={isManagerCollapsed}
          isBusy={isManagerBusy}
          onToggle={() => {
            onToggleManagerCollapsed(thread.id);
          }}
          threadTitle={threadTitle}
        />
      ) : (
        <ThreadLeadingGlyph
          hasPendingInteraction={hasPendingInteraction}
          isManagedChild={isManagedChild}
          isBusy={threadIsBusy}
          showUnreadBadge={showUnreadBadge}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{threadTitle}</span>
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
              <UserRound
                className={cn(
                  "text-sidebar-foreground/70",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
                aria-label="Manager"
              />
            ) : isManagedChild && threadIsBusy ? (
              <CircleDashed
                className={cn(
                  "animate-spin text-sidebar-foreground/70",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
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
    </div>
  );
}
