import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/icon.js";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { ProjectList, ProjectListActionButtons } from "./ProjectList";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { getRootComposeRoutePath } from "@/lib/app-route-paths";
import { useSetRootComposeMode } from "@/lib/root-compose-selection";

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const navigate = useNavigate();
  const setRootComposeMode = useSetRootComposeMode();
  const { isCompactViewport, setOpenMobile } = useSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const isCompactViewportRef = useRef(isCompactViewport);
  // Keep the ProjectList callback stable while reading the latest breakpoint.
  isCompactViewportRef.current = isCompactViewport;

  const closeOnMobile = useCallback(() => {
    if (isCompactViewportRef.current) {
      setOpenMobile(false);
    }
  }, [setOpenMobile]);

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    setRootComposeMode("thread");
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate, setRootComposeMode]);

  const handleNewManager = useCallback(() => {
    closeOnMobile();
    setRootComposeMode("manager");
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate, setRootComposeMode]);

  return (
    <>
      <Sidebar>
        {showTopReserve ? (
          /* Top reserve that keeps the sidebar's content (New Thread / New
             Manager / Projects) anchored below the title-bar chrome, mirroring
             the page-header height on the content side. The sidebar toggle is
             pinned at the app's top-left for every chrome (see AppLayout's
             SidebarTriggerOverlay), so this row hosts no trigger of its own — it
             stays mounted in every sidebar state, including while the panel
             collapses off-canvas, so the content holds its vertical position
             instead of riding up under the pinned toggle during the animation.
             On desktop it doubles as the window-drag strip. */
          <div
            data-testid="app-sidebar-top-reserve-row"
            className={cn(
              "flex h-12 shrink-0 items-center",
              usesDesktopChrome ? MACOS_WINDOW_DRAG_CLASS : "px-2",
            )}
          />
        ) : null}
        <div
          data-testid="app-sidebar-primary-actions"
          className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden"
        >
          <ProjectListActionButtons
            onNewChat={handleNewChat}
            onNewManager={handleNewManager}
          />
        </div>
        <SidebarContent>
          <ProjectList
            onNewProject={
              quickCreateProject.isAvailable
                ? quickCreateProject.openCreateDialog
                : undefined
            }
            onProjectSelect={closeOnMobile}
            isCreatingProject={quickCreateProject.isCreating}
          />
        </SidebarContent>
        <SidebarFooter className="relative">
          <OverflowFade placement="above" tone="sidebar" size="sm" />
          <SidebarMenu className="flex-row items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={COARSE_POINTER_CHILD_ICON_BUTTON_CLASS}
                tooltip="App settings"
                aria-label="App settings"
              >
                <Link to="/settings">
                  <Icon name="Settings" />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <div
          data-testid="app-sidebar-resize-handle"
          className={cn(
            "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
            "group-data-[collapsible=icon]:hidden",
            isResizing && "before:bg-sidebar-border",
          )}
          onMouseDown={onResizeMouseDown}
        />
      </Sidebar>
    </>
  );
}
