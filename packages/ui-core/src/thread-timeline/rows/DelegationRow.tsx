import { useMemo, type ReactNode } from "react";
import { buildTimelineRows } from "@bb/core-ui";
import type {
  TimelineRow,
  TimelineToolGroupRow,
  ViewDelegationMessage,
  ViewMessage,
} from "@bb/domain";
import { ExpandablePanel } from "../../disclosure.js";
import { useLatestInitialExpanded } from "../latestInitialExpanded.js";
import {
  findLatestActivityRowId,
  shouldPreferOngoingLabelsForRow,
} from "../threadDetailActivity.js";
import {
  EventTitle,
  formatSummaryDuration,
  getEventHeaderToneClass,
} from "./shared.js";

interface NestedRenderOptions {
  initialExpanded?: boolean;
  preferOngoingLabels?: boolean;
}

interface NestedToolGroupProps {
  entry: TimelineToolGroupRow;
  preferOngoingLabels?: boolean;
  renderMessage: (message: ViewMessage, options?: NestedRenderOptions) => ReactNode;
}

interface NestedRowOngoingLabelInput {
  latestActivityRowId: string | null;
  preferOngoingLabels: boolean;
  row: TimelineRow;
}

export function shouldPreferNestedOngoingLabels({
  latestActivityRowId,
  preferOngoingLabels,
  row,
}: NestedRowOngoingLabelInput): boolean {
  return (
    preferOngoingLabels &&
    shouldPreferOngoingLabelsForRow(row, latestActivityRowId)
  );
}

function NestedToolGroup({
  entry,
  preferOngoingLabels = false,
  renderMessage,
}: NestedToolGroupProps) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(false);
  const count = entry.summaryCount;
  const duration = formatSummaryDuration(entry.durationMs);
  const isWorking = entry.status === "pending";
  const summaryContent = duration ? (
    <EventTitle
      prefix={isWorking ? "Working for" : "Worked for"}
      emphasis={duration}
      suffix={`${count} item${count === 1 ? "" : "s"}`}
      shimmerPrefix={isWorking}
    />
  ) : (
    <EventTitle
      prefix={isWorking ? "Working on" : "Worked on"}
      emphasis={`${count} item${count === 1 ? "" : "s"}`}
      shimmerPrefix={isWorking}
    />
  );

  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      summaryContent={summaryContent}
      headerToneClass={getEventHeaderToneClass(isExpanded)}
      onToggle={onToggle}
    >
      <div className="overflow-hidden rounded-md border border-border/60 bg-background/40">
        {entry.messages.map((message, index) => {
          const isLastMessage = index === entry.messages.length - 1;
          return (
            <div key={message.id}>
              {renderMessage(message, {
                initialExpanded: isLastMessage,
                preferOngoingLabels: preferOngoingLabels && isLastMessage,
              })}
            </div>
          );
        })}
      </div>
    </ExpandablePanel>
  );
}

export function DelegationRow({
  message,
  initialExpanded = false,
  preferOngoingLabels = false,
  renderMessage,
}: {
  message: ViewDelegationMessage;
  initialExpanded?: boolean;
  preferOngoingLabels?: boolean;
  renderMessage: (message: ViewMessage, options?: NestedRenderOptions) => ReactNode;
}) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(initialExpanded);
  const nestedRows = useMemo(() => buildTimelineRows(message.children), [message.children]);
  const nestedLatestActivityRowId = useMemo(
    () => findLatestActivityRowId(nestedRows),
    [nestedRows],
  );
  const label =
    message.status === "pending" || preferOngoingLabels ? "Delegating" : "Delegated";
  const summaryContent = (
    <EventTitle
      prefix={label}
      emphasis={message.command ?? message.toolName}
      suffix={formatSummaryDuration(message.durationMs)}
      tone={message.status === "error" ? "destructive" : "default"}
      shimmerPrefix={message.status === "pending" || preferOngoingLabels}
    />
  );

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={summaryContent}
          summaryContentClassName="min-w-0"
          headerToneClass={getEventHeaderToneClass(
            isExpanded,
            message.status === "error" ? "destructive" : "default",
          )}
          onToggle={onToggle}
        >
          <div className="mt-1 border-l border-border/70 pl-3">
            {message.output ? (
              <div className="mb-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                {message.output}
              </div>
            ) : null}
            <div className="space-y-2">
              {nestedRows.map((row, index) => {
                const isLastRow = index === nestedRows.length - 1;
                const rowPreferOngoingLabels = shouldPreferNestedOngoingLabels({
                  latestActivityRowId: nestedLatestActivityRowId,
                  preferOngoingLabels,
                  row,
                });
                if (row.kind === "tool-group") {
                  return (
                    <NestedToolGroup
                      key={row.id}
                      entry={row}
                      preferOngoingLabels={rowPreferOngoingLabels}
                      renderMessage={renderMessage}
                    />
                  );
                }
                return (
                  <div key={row.id}>
                    {renderMessage(row.message, {
                      initialExpanded: isLastRow,
                      preferOngoingLabels: rowPreferOngoingLabels,
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </ExpandablePanel>
      </div>
    </div>
  );
}
