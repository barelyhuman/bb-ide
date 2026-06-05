import { memo, useCallback, useState, type ReactNode } from "react";
import type { TimelineTitle } from "@bb/thread-view";
import {
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "../../ui/disclosure.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import {
  TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME,
  timelineRowHeaderClassName,
  timelineRowHorizontalPaddingClassName,
  type TimelineRowHorizontalPadding,
} from "./TimelineRowHeader.js";
import {
  TimelineTitleView,
  type TimelineTitleActionResolver,
  type TimelineTitleLinkResolver,
} from "./TimelineTitleView.js";

export interface ExpandableTimelineRowProps {
  autoExpanded?: boolean;
  onBeforeExpand?: () => void;
  renderBody: () => ReactNode;
  title: TimelineTitle;
  className?: string;
  horizontalPadding?: TimelineRowHorizontalPadding;
  leadingIcon?: IconName;
  onTitleAction?: TimelineTitleActionResolver;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
}

type ManualExpansionOverride = boolean | null;

function headerToneClass(title: TimelineTitle, isExpanded: boolean): string {
  if (title.tone === "summary") {
    return "text-subtle-foreground transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground";
  }
  return getCollapsibleHeaderToneClass(isExpanded);
}

function ExpandableTimelineRowComponent({
  autoExpanded = false,
  className,
  horizontalPadding = "default",
  leadingIcon,
  onBeforeExpand,
  onTitleAction,
  renderBody,
  resolveSegmentLinkHref,
  title,
}: ExpandableTimelineRowProps) {
  const [manualExpansionOverride, setManualExpansionOverride] =
    useState<ManualExpansionOverride>(null);
  const isExpanded = manualExpansionOverride ?? autoExpanded;
  const horizontalPaddingClass =
    timelineRowHorizontalPaddingClassName(horizontalPadding);
  const handleToggle = useCallback((): void => {
    if (!isExpanded) {
      onBeforeExpand?.();
    }
    setManualExpansionOverride(!isExpanded);
  }, [isExpanded, onBeforeExpand]);

  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      onToggle={handleToggle}
      headerToneClass={headerToneClass(title, isExpanded)}
      summaryContent={
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          {leadingIcon ? (
            <Icon
              name={leadingIcon}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <TimelineTitleView
            title={title}
            onTitleAction={onTitleAction}
            resolveSegmentLinkHref={resolveSegmentLinkHref}
          />
        </span>
      }
      summaryContentClassName={TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME}
      className={cn("w-full", className)}
      headerClassName={timelineRowHeaderClassName(horizontalPadding)}
      contentClassName={cn(horizontalPaddingClass, "pb-1 pt-0.5")}
      renderBody={renderBody}
    />
  );
}

export const ExpandableTimelineRow = memo(ExpandableTimelineRowComponent);
