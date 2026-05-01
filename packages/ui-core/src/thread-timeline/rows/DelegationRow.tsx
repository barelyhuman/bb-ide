import { useMemo, type ReactNode } from "react";
import {
  buildCollapsedGroupedTimelineRows,
  buildGroupedTimelineRows,
  findLatestActivityRowId,
  getThreadTimelineRowTitle,
  type ThreadTimelineRowTitle,
} from "@bb/thread-view";
import type {
  TimelineRow,
  TimelineTurnSummaryRow,
  ViewDelegationMessage,
  ViewMessage,
} from "@bb/domain";
import { getDetailScrollMaxHeightClass } from "../../detail-scroll-size.js";
import { cn } from "../../cn.js";
import { ExpandablePanel } from "../../disclosure.js";
import { ConversationMarkdown } from "../ConversationMarkdown.js";
import { NestedTimelineRows } from "../NestedTimelineRows.js";
import type {
  NestedTimelineMessageRenderOptions,
  NestedTimelineRowPresentationOptions,
  NestedTimelineTurnSummaryRowsController,
} from "../NestedTimelineRows.js";
import { useLatestInitialExpanded } from "../latestInitialExpanded.js";
import type { ThreadTimelineLocalFileLinkHandler } from "../types.js";
import {
  EventTitle,
  formatSummaryDuration,
  getEventHeaderToneClass,
} from "./shared.js";

export { shouldPreferNestedOngoingLabels } from "../NestedTimelineRows.js";

interface DelegationRowProps {
  initialExpanded?: boolean;
  message: ViewDelegationMessage;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  preferOngoingLabels?: boolean;
  renderMessage: (
    message: ViewMessage,
    options?: NestedTimelineMessageRenderOptions,
  ) => ReactNode;
}

type DelegationRowTone = "default" | "destructive";

interface RenderDelegationRowTitleArgs {
  isWorking: boolean;
  suffix: ReactNode;
  title: ThreadTimelineRowTitle;
  tone: DelegationRowTone;
}

function getNestedPresentationOptions(
  preferOngoingLabels: boolean,
): NestedTimelineRowPresentationOptions {
  return {
    expandErrors: true,
    groupedRowsUseOngoingLabels: true,
    preferOngoingLabels,
  };
}

function createTurnSummaryRowsController(): NestedTimelineTurnSummaryRowsController {
  return {
    getRows(row: TimelineTurnSummaryRow): TimelineRow[] | null {
      return row.rows;
    },
    isLoading(): boolean {
      return false;
    },
    isError(): boolean {
      return false;
    },
    loadRows(): void {},
  };
}

function formatDelegationRowSuffix(
  metadata: string | undefined,
  duration: string | undefined,
): ReactNode {
  if (!metadata && !duration) {
    return undefined;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {metadata ? <span className="truncate">{metadata}</span> : null}
      {duration ? <span className="shrink-0">{duration}</span> : null}
    </span>
  );
}

function getDelegationRowMetadata(
  title: ThreadTimelineRowTitle,
): string | undefined {
  if (title.rich.kind === "plain") {
    return undefined;
  }
  return title.rich.metadata ?? undefined;
}

function renderDelegationRowTitle({
  isWorking,
  suffix,
  title,
  tone,
}: RenderDelegationRowTitleArgs) {
  switch (title.rich.kind) {
    case "plain":
      return (
        <EventTitle
          prefix={title.rich.text}
          suffix={suffix}
          suffixClassName="min-w-0 shrink"
          tone={tone}
          shimmerPrefix={isWorking}
        />
      );
    case "prefixed":
      return (
        <EventTitle
          prefix={title.rich.prefix}
          emphasis={title.rich.content}
          suffix={suffix}
          suffixClassName="min-w-0 shrink"
          tone={tone}
          shimmerPrefix={isWorking}
        />
      );
  }
}

export function DelegationRow({
  message,
  initialExpanded = false,
  onOpenLocalFileLink,
  preferOngoingLabels = false,
  renderMessage,
}: DelegationRowProps) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(initialExpanded);
  const isSubagentPending = message.status === "pending";
  const nestedRows = useMemo(
    () =>
      isSubagentPending
        ? buildGroupedTimelineRows(message.childProjection)
        : buildCollapsedGroupedTimelineRows(message.childProjection),
    [message.childProjection, isSubagentPending],
  );
  const nestedLatestActivityRowId = useMemo(
    () => findLatestActivityRowId(nestedRows),
    [nestedRows],
  );
  const turnSummaryRowsController = useMemo(
    () => createTurnSummaryRowsController(),
    [],
  );
  const isWorking = message.status === "pending";
  const title = getThreadTimelineRowTitle(
    {
      kind: "message",
      id: message.id,
      message,
    },
    {
      preferOngoingLabels: false,
    },
  );
  const suffix = formatDelegationRowSuffix(
    getDelegationRowMetadata(title),
    formatSummaryDuration(message.durationMs ?? undefined),
  );
  const tone = message.status === "error" ? "destructive" : "default";

  return (
    <div className="group w-full">
      <div className="mr-auto w-full">
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={
            renderDelegationRowTitle({
              isWorking,
              suffix,
              title,
              tone,
            })
          }
          summaryContentClassName="min-w-0"
          headerToneClass={getEventHeaderToneClass(isExpanded, tone)}
          onToggle={onToggle}
        >
          <div
            className={cn(
              "overflow-auto rounded-md border border-border/60 bg-background/40",
              getDetailScrollMaxHeightClass("large"),
            )}
          >
            <NestedTimelineRows
              latestActivityRowId={nestedLatestActivityRowId}
              presentationOptions={getNestedPresentationOptions(
                preferOngoingLabels,
              )}
              renderMessage={renderMessage}
              rows={nestedRows}
              turnSummaryRowsController={turnSummaryRowsController}
            />
            {message.output ? (
              <div className="px-2 py-2 text-sm leading-relaxed">
                <ConversationMarkdown
                  content={message.output}
                  onOpenLocalFileLink={onOpenLocalFileLink}
                />
              </div>
            ) : null}
          </div>
        </ExpandablePanel>
      </div>
    </div>
  );
}
