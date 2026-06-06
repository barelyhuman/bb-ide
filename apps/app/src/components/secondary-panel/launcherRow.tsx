import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon.js";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
import { cn } from "@/lib/utils";

// Shared shell for the secondary-panel launcher rows — the app/file/recent
// results in the New tab page and the browser tab's recently-visited list — so
// density, hover, and the trailing open-affordance stay identical across both
// surfaces rather than drifting in two parallel class bundles.
const LAUNCHER_ROW_SHELL_CLASS =
  "group flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none";
export const LAUNCHER_ROW_BASE_CLASS = `${LAUNCHER_ROW_SHELL_CLASS} focus-visible:ring-1 focus-visible:ring-ring`;
export const LAUNCHER_MENU_ROW_BASE_CLASS = `${LAUNCHER_ROW_SHELL_CLASS} focus-visible:bg-state-hover focus-visible:text-foreground`;
export const LAUNCHER_ROW_ICON_CLASS =
  "flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground";

// Section labels above launcher row groups (the + menu, file search, recents,
// and the browser tab's recently-visited list). Mirrors the detail-card key
// style rather than a loud uppercase, tracked header.
const LAUNCHER_SECTION_LABEL_CLASS = CHROME_SECTION_LABEL_CLASS;

interface LauncherRowTrailingProps {
  /** Resting content (e.g. a relative timestamp) shown until the row is highlighted. */
  idle: ReactNode;
  /**
   * Highlighted via keyboard navigation. When false the row still reveals the
   * "open" affordance on hover; when true it shows it outright.
   */
  isActive: boolean;
}

/**
 * The trailing cell of a launcher row: shows {@link LauncherRowTrailingProps.idle}
 * at rest and an "open" affordance when the row is hovered or keyboard-active.
 */
export function LauncherRowTrailing({
  idle,
  isActive,
}: LauncherRowTrailingProps) {
  return (
    <span className="ml-auto flex shrink-0 items-center justify-end">
      <span
        className={cn(
          "whitespace-nowrap text-xs text-muted-foreground",
          isActive ? "hidden" : "group-hover:hidden",
        )}
      >
        {idle}
      </span>
      <span
        className={cn(
          "items-center gap-1 text-xs text-subtle-foreground",
          isActive ? "flex" : "hidden group-hover:flex",
        )}
        aria-hidden
      >
        <Icon name="ArrowUpRight" className="size-3" aria-hidden />
        open
      </span>
    </span>
  );
}

interface LauncherSectionHeaderProps {
  label: ReactNode;
  /** Optional count rendered as a muted monospace badge after the label. */
  count?: number;
  /** Optional trailing control (e.g. a Clear button), pushed to the right edge. */
  action?: ReactNode;
  /**
   * Stick the header to the top of a scrolling result list with a solid
   * background, so it stays visible while rows scroll beneath it.
   */
  sticky?: boolean;
  className?: string;
}

/**
 * Section label above a group of launcher rows. Shares the rows' horizontal
 * padding (`px-2`) so the label aligns with the row content rather than sitting
 * inboard of the rows' invisible resting padding, and carries the detail-card
 * key typography. Used by both the New tab page sections and the browser tab's
 * recently-visited list so the two surfaces stay identical.
 */
export function LauncherSectionHeader({
  label,
  count,
  action,
  sticky = false,
  className,
}: LauncherSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-2 pb-2",
        LAUNCHER_SECTION_LABEL_CLASS,
        sticky && "sticky top-0 z-10 bg-background",
        className,
      )}
    >
      <span>{label}</span>
      {count !== undefined ? (
        <span className="font-mono text-xs text-muted-foreground opacity-80">
          {count}
        </span>
      ) : null}
      {action ? (
        <div className="ml-auto flex items-center">{action}</div>
      ) : null}
    </div>
  );
}
