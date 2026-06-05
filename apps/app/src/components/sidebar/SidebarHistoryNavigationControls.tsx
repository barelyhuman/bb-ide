import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { useAppRouteHistoryNavigation } from "@/lib/app-route-history";

interface SidebarHistoryNavigationControlsProps {
  /**
   * Invoked after an enabled Back/Forward button requests navigation, so the
   * sidebar can close the mobile drawer. Not called for disabled buttons.
   */
  onNavigate?: () => void;
}

interface SidebarHistoryNavButtonProps {
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

const SIDEBAR_HISTORY_NAV_BUTTON_CLASS = cn(
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  "text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
);

function SidebarHistoryNavButton({
  icon,
  label,
  disabled,
  onClick,
}: SidebarHistoryNavButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={SIDEBAR_HISTORY_NAV_BUTTON_CLASS}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} aria-hidden />
    </Button>
  );
}

/**
 * Back/Forward controls for the left sidebar, moving through the app-shell
 * route history like browser navigation. Owns its own row spacing so the
 * sidebar only decides placement.
 */
export function SidebarHistoryNavigationControls({
  onNavigate,
}: SidebarHistoryNavigationControlsProps) {
  const { canGoBack, canGoForward, goBack, goForward } =
    useAppRouteHistoryNavigation();

  const handleBack = useCallback(() => {
    if (!canGoBack) {
      return;
    }
    goBack();
    onNavigate?.();
  }, [canGoBack, goBack, onNavigate]);

  const handleForward = useCallback(() => {
    if (!canGoForward) {
      return;
    }
    goForward();
    onNavigate?.();
  }, [canGoForward, goForward, onNavigate]);

  return (
    <div className="mb-1 flex items-center gap-1">
      <SidebarHistoryNavButton
        icon="ChevronLeft"
        label="Go back"
        disabled={!canGoBack}
        onClick={handleBack}
      />
      <SidebarHistoryNavButton
        icon="ChevronRight"
        label="Go forward"
        disabled={!canGoForward}
        onClick={handleForward}
      />
    </div>
  );
}
