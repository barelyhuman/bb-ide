import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS = "max-w-[180px]";
const TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS =
  "inline-flex size-4 shrink-0 items-center justify-center rounded transition-opacity hover:bg-muted-foreground/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none";
export const TAB_PILL_AFFORDANCE_ICON_CLASS = "size-3";
export const TAB_PILL_CLOSE_BUTTON_CLASS =
  `mr-1 ml-0.5 ${TAB_PILL_AFFORDANCE_BUTTON_BASE_CLASS} opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover/tab-pill:opacity-100 group-focus-within/tab-pill:opacity-100 disabled:opacity-30`;

export interface TabPillCloseAction {
  onClose: () => void;
  closeLabel: string;
  closeTooltip: string;
  isClosing?: boolean;
}

export interface TabPillProps {
  label: string;
  leadingVisual?: ReactNode;
  secondaryLabel?: string | null;
  /** Extra classes for the label text (e.g. `line-through` for a done tab). */
  labelClassName?: string;
  title: string;
  isActive: boolean;
  onSelect: () => void;
  labelMaxWidthClass?: string;
  closeAction: TabPillCloseAction | null;
}

export function TabPill({
  label,
  leadingVisual,
  secondaryLabel = null,
  labelClassName,
  title,
  isActive,
  onSelect,
  labelMaxWidthClass = TAB_PILL_DEFAULT_LABEL_MAX_WIDTH_CLASS,
  closeAction,
}: TabPillProps) {
  const isClosable = closeAction !== null;
  return (
    <div
      className={cn(
        "group/tab-pill inline-flex h-7 shrink-0 items-center rounded-md text-xs transition-colors",
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isActive}
        title={title}
        className={cn(
          "flex h-full min-w-0 items-center rounded-l-md pl-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isClosable ? "pr-1" : "rounded-r-md pr-2",
        )}
      >
        {leadingVisual ? (
          <span className="mr-1.5 inline-flex shrink-0 items-center">
            {leadingVisual}
          </span>
        ) : null}
        <span className={cn("truncate", labelMaxWidthClass, labelClassName)}>
          {label}
        </span>
        {secondaryLabel ? (
          <span className="ml-1 shrink-0 text-muted-foreground">
            {secondaryLabel}
          </span>
        ) : null}
      </button>
      {closeAction ? (
        <button
          type="button"
          onClick={closeAction.onClose}
          disabled={closeAction.isClosing}
          aria-label={closeAction.closeLabel}
          title={closeAction.closeTooltip}
          className={TAB_PILL_CLOSE_BUTTON_CLASS}
        >
          {closeAction.isClosing ? (
            <Icon
              name="Spinner"
              className={`${TAB_PILL_AFFORDANCE_ICON_CLASS} animate-spin`}
            />
          ) : (
            <Icon name="X" className={TAB_PILL_AFFORDANCE_ICON_CLASS} />
          )}
        </button>
      ) : null}
    </div>
  );
}
