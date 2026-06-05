import { useState, type ReactNode } from "react";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  CHROME_ROW_CLASS,
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";

/**
 * Shared sizing for icon-only header action buttons (sidebar trigger, kebab
 * menu, secondary-panel toggle, etc.). Keeps button dimensions and SVG sizing
 * consistent across coarse touch and desktop contexts.
 */
export const HEADER_ICON_BUTTON_CLASS = COARSE_POINTER_HEADER_ICON_BUTTON_CLASS;

interface AppPageHeaderProps {
  center?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
  className?: string;
}

export function AppPageHeader({
  center,
  actions,
  bordered = true,
  className,
}: AppPageHeaderProps) {
  const isSidebarShowing = useIsSidebarShowing();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  return (
    <header
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        "relative shrink-0 bg-surface-scrim px-4 backdrop-blur-sm",
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        bordered && "border-b border-border",
        className,
      )}
    >
      <div
        data-testid="app-page-header-content-row"
        className={cn(
          // Center the title/actions on the shared chrome axis using the chrome
          // row's full height rather than `h-full`: a bordered header's `border-b`
          // shrinks the content box by 1px, which would otherwise drift the
          // visual center half a pixel above the traffic-light / sidebar-arrow
          // axis.
          CHROME_ROW_CLASS,
          "gap-1 md:gap-2",
          // The sidebar toggle is pinned at the app's top-left (see AppLayout's
          // SidebarTriggerOverlay), so when the sidebar is collapsed the header
          // content shares the row with that fixed button and reserves its
          // footprint as left padding. Transition the padding on the same 200ms
          // linear curve as the sidebar panel/inset slide so the two compose into
          // one smooth motion; without it the reserve snaps on/off instantly
          // while the inset animates and the content jumps left/right.
          "transition-[padding] duration-200 ease-linear",
          !isSidebarShowing &&
            (usesDesktopChrome
              ? MACOS_COLLAPSED_HEADER_RESERVE_CLASS
              : BROWSER_COLLAPSED_HEADER_RESERVE_CLASS),
        )}
      >
        {center ? (
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 max-w-full items-center gap-2">
              {center}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
