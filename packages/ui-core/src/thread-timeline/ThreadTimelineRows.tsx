import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import {
  buildTimelineRowTitle,
  buildTimelineViewRows,
  type BuildTimelineRowTitleOptions,
  type ThreadTimelineViewRow,
  type TimelineViewTurnRow,
  type TimelineViewWorkRow,
} from "@bb/thread-view";
import { cn } from "../primitives/cn.js";
import { EventCodeBlock } from "../primitives/event-content.js";
import type {
  ThreadTimelineLocalFileLinkHandler,
  ThreadTimelineTheme,
  UserAttachmentImageSrcResolver,
} from "./types.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { TimelineTitleView } from "./TimelineTitleView.js";
import {
  useTimelineExpansionState,
  type TimelineExpansionState,
} from "./useTimelineExpansionState.js";

export interface ThreadTimelineRowsProps {
  erroredTurnSummaryIds: ReadonlySet<string>;
  loadingTurnSummaryIds: ReadonlySet<string>;
  onLoadTurnSummaryRows: (entry: TimelineTurnRow) => void;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  themeType?: ThreadTimelineTheme;
  timelineRows: TimelineRow[];
  threadRuntimeDisplayStatus: ThreadRuntimeDisplayStatus;
  turnSummaryRowsById: Record<string, TimelineRow[]>;
}

interface TimelineRendererContext {
  expansion: TimelineExpansionState;
  loadingTurnSummaryIds: ReadonlySet<string>;
  erroredTurnSummaryIds: ReadonlySet<string>;
  onLoadTurnSummaryRows: (entry: TimelineTurnRow) => void;
  turnSummaryRowsById: Record<string, TimelineRow[]>;
}

interface TimelineRowsListProps extends TimelineRendererContext {
  rows: readonly ThreadTimelineViewRow[];
  scopeActive: boolean;
}

interface TimelineRowViewProps extends TimelineRendererContext {
  isTail: boolean;
  row: ThreadTimelineViewRow;
  scopeActive: boolean;
}

interface TimelineStaticRowProps {
  children: ReactNode;
  className?: string;
}

interface TimelineExpandableBodyProps extends TimelineRendererContext {
  row: ThreadTimelineViewRow;
  scopeActive: boolean;
}

interface TimelineExpansionIds {
  autoExpandedRowIds: ReadonlySet<string>;
  rowIds: ReadonlySet<string>;
}

interface CollectTimelineExpansionIdsArgs {
  rows: readonly ThreadTimelineViewRow[];
  scopeActive: boolean;
}

interface RowActivityContext {
  isTail: boolean;
  row: ThreadTimelineViewRow;
  scopeActive: boolean;
}

type TimelineConversationViewRow = Extract<
  ThreadTimelineViewRow,
  { kind: "conversation" }
>;

interface ConversationRowProps {
  row: TimelineConversationViewRow;
}

interface WorkRowBodyProps {
  row: TimelineViewWorkRow;
}

interface TurnRowBodyProps extends TimelineRendererContext {
  row: TimelineViewTurnRow;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled timeline row: ${String(value)}`);
}

function isRuntimeScopeActive(status: ThreadRuntimeDisplayStatus): boolean {
  return status === "active" || status === "host-reconnecting";
}

function isWorkRowExpandable(row: TimelineViewWorkRow): boolean {
  switch (row.workKind) {
    case "web-search":
    case "web-fetch":
    case "approval":
      return false;
    case "command":
    case "tool":
    case "file-change":
      return true;
    case "delegation":
      return row.childRows.length > 0 || row.output.trim().length > 0;
    default:
      return assertNever(row);
  }
}

function isRowExpandable(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case "conversation":
      return false;
    case "system":
      return row.detail !== null && row.detail.trim().length > 0;
    case "activity-summary":
      return row.children.length > 0;
    case "turn":
      return true;
    case "work":
      return isWorkRowExpandable(row);
    default:
      return assertNever(row);
  }
}

function isErrorRow(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case "conversation":
      return false;
    case "system":
      return row.systemKind === "error" || row.status === "error";
    case "activity-summary":
    case "turn":
      return row.status === "error";
    case "work":
      if (row.status === "error") {
        return true;
      }
      if (
        row.workKind === "approval" ||
        row.workKind === "delegation" ||
        row.workKind === "web-fetch" ||
        row.workKind === "web-search"
      ) {
        return false;
      }
      return row.approvalStatus === "denied";
    default:
      return assertNever(row);
  }
}

function rowHasPendingStatus(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case "conversation":
      return false;
    case "system":
      return row.status === "pending";
    case "activity-summary":
    case "turn":
    case "work":
      return row.status === "pending";
    default:
      return assertNever(row);
  }
}

function shouldAutoExpandRow({
  isTail,
  row,
  scopeActive,
}: RowActivityContext): boolean {
  if (!isRowExpandable(row)) {
    return false;
  }
  if (row.kind === "activity-summary" && scopeActive && isTail) {
    return true;
  }
  return rowHasPendingStatus(row) || isErrorRow(row);
}

function collectTimelineExpansionIds({
  rows,
  scopeActive,
}: CollectTimelineExpansionIdsArgs): TimelineExpansionIds {
  const rowIds = new Set<string>();
  const autoExpandedRowIds = new Set<string>();

  const visitRows = (
    currentRows: readonly ThreadTimelineViewRow[],
    currentScopeActive: boolean,
  ): void => {
    currentRows.forEach((row, index) => {
      const isTail = index === currentRows.length - 1;
      rowIds.add(row.id);
      if (shouldAutoExpandRow({ isTail, row, scopeActive: currentScopeActive })) {
        autoExpandedRowIds.add(row.id);
      }

      if (row.kind === "activity-summary") {
        visitRows(row.children, false);
      } else if (row.kind === "work" && row.workKind === "delegation") {
        visitRows(row.childRows, row.status === "pending");
      } else if (row.kind === "turn" && row.children) {
        visitRows(row.children, row.status === "pending");
      }
    });
  };

  visitRows(rows, scopeActive);
  return {
    autoExpandedRowIds,
    rowIds,
  };
}

function timelineRowTitleOptions({
  isTail,
  row,
  scopeActive,
}: RowActivityContext): BuildTimelineRowTitleOptions {
  const useActiveBundleLabel =
    row.kind === "activity-summary" && scopeActive && isTail;
  return {
    preferOngoingLabel: useActiveBundleLabel,
    summaryStyle: useActiveBundleLabel ? "bundle" : "background",
  };
}

function TimelineStaticRow({ children, className }: TimelineStaticRowProps) {
  return (
    <div className={cn("group w-full", className)}>
      <div className="px-2 py-1">{children}</div>
    </div>
  );
}

function ConversationRow({ row }: ConversationRowProps) {
  const title = buildTimelineRowTitle(row, {
    preferOngoingLabel: false,
    summaryStyle: "background",
  });
  return (
    <TimelineStaticRow>
      <TimelineTitleView title={title} />
      {row.text.trim().length > 0 ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {row.text}
        </div>
      ) : null}
    </TimelineStaticRow>
  );
}

function WorkRowBody({ row }: WorkRowBodyProps) {
  switch (row.workKind) {
    case "command":
      return (
        <EventCodeBlock maxHeightClassName="max-h-96">
          {[
            `$ ${row.command}`,
            row.cwd ? `cwd: ${row.cwd}` : null,
            row.source ? `source: ${row.source}` : null,
            row.output.trim().length > 0 ? row.output : null,
            row.exitCode !== null && row.exitCode !== 0
              ? `exit code ${row.exitCode}`
              : null,
            row.exitCode === 0 && row.output.trim().length === 0
              ? "exit code 0"
              : null,
          ]
            .filter((line): line is string => line !== null)
            .join("\n")}
        </EventCodeBlock>
      );
    case "tool":
      return (
        <EventCodeBlock maxHeightClassName="max-h-96">
          {[
            row.toolArgs ? JSON.stringify(row.toolArgs, null, 2) : null,
            row.output.trim().length > 0 ? row.output : null,
          ]
            .filter((line): line is string => line !== null)
            .join("\n\n")}
        </EventCodeBlock>
      );
    case "file-change":
      return (
        <div className="space-y-2">
          {row.change.diff ? (
            <EventCodeBlock maxHeightClassName="max-h-96">
              {row.change.diff}
            </EventCodeBlock>
          ) : null}
          {row.stdout ? (
            <EventCodeBlock maxHeightClassName="max-h-48">
              {row.stdout}
            </EventCodeBlock>
          ) : null}
          {row.stderr ? (
            <EventCodeBlock tone="danger" maxHeightClassName="max-h-48">
              {row.stderr}
            </EventCodeBlock>
          ) : null}
        </div>
      );
    case "delegation":
      return row.output.trim().length > 0 ? (
        <EventCodeBlock maxHeightClassName="max-h-96">{row.output}</EventCodeBlock>
      ) : null;
    case "approval":
    case "web-search":
    case "web-fetch":
      return null;
    default:
      return assertNever(row);
  }
}

function TimelineExpandableBody({
  erroredTurnSummaryIds,
  expansion,
  loadingTurnSummaryIds,
  onLoadTurnSummaryRows,
  row,
  scopeActive,
  turnSummaryRowsById,
}: TimelineExpandableBodyProps) {
  switch (row.kind) {
    case "activity-summary":
      return (
        <TimelineRowsList
          rows={row.children}
          scopeActive={false}
          expansion={expansion}
          loadingTurnSummaryIds={loadingTurnSummaryIds}
          erroredTurnSummaryIds={erroredTurnSummaryIds}
          onLoadTurnSummaryRows={onLoadTurnSummaryRows}
          turnSummaryRowsById={turnSummaryRowsById}
        />
      );
    case "turn":
      return (
        <TurnRowBody
          row={row}
          expansion={expansion}
          loadingTurnSummaryIds={loadingTurnSummaryIds}
          erroredTurnSummaryIds={erroredTurnSummaryIds}
          onLoadTurnSummaryRows={onLoadTurnSummaryRows}
          turnSummaryRowsById={turnSummaryRowsById}
        />
      );
    case "work":
      if (row.workKind === "delegation" && row.childRows.length > 0) {
        return (
          <TimelineRowsList
            rows={row.childRows}
            scopeActive={row.status === "pending"}
            expansion={expansion}
            loadingTurnSummaryIds={loadingTurnSummaryIds}
            erroredTurnSummaryIds={erroredTurnSummaryIds}
            onLoadTurnSummaryRows={onLoadTurnSummaryRows}
            turnSummaryRowsById={turnSummaryRowsById}
          />
        );
      }
      return <WorkRowBody row={row} />;
    case "system":
      return row.detail ? (
        <EventCodeBlock tone={row.systemKind === "error" ? "danger" : "default"}>
          {row.detail}
        </EventCodeBlock>
      ) : null;
    case "conversation":
      return null;
    default:
      return assertNever(row);
  }
}

function TurnRowBody({
  erroredTurnSummaryIds,
  expansion,
  loadingTurnSummaryIds,
  onLoadTurnSummaryRows,
  row,
  turnSummaryRowsById,
}: TurnRowBodyProps) {
  const requestedTurnIdRef = useRef<string | null>(null);
  const loadedRows = turnSummaryRowsById[row.id];
  const hasInlineChildren = row.children !== null;
  const rows = hasInlineChildren
    ? row.children
    : loadedRows
      ? buildTimelineViewRows(loadedRows)
      : null;
  const isLoading = loadingTurnSummaryIds.has(row.id);
  const isError = erroredTurnSummaryIds.has(row.id);

  useEffect(() => {
    if (
      hasInlineChildren ||
      rows !== null ||
      isLoading ||
      isError ||
      requestedTurnIdRef.current === row.id
    ) {
      return;
    }
    requestedTurnIdRef.current = row.id;
    onLoadTurnSummaryRows({
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      sourceSeqStart: row.sourceSeqStart,
      sourceSeqEnd: row.sourceSeqEnd,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
      kind: "turn",
      status: row.status,
      summaryCount: row.summaryCount,
      durationMs: row.durationMs,
      children: null,
    });
  }, [hasInlineChildren, isError, isLoading, onLoadTurnSummaryRows, row, rows]);

  if (isError) {
    return (
      <div className="text-sm text-destructive">
        Failed to load turn details.
      </div>
    );
  }
  if (rows) {
    return (
      <TimelineRowsList
        rows={rows}
        scopeActive={row.status === "pending"}
        expansion={expansion}
        loadingTurnSummaryIds={loadingTurnSummaryIds}
        erroredTurnSummaryIds={erroredTurnSummaryIds}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        turnSummaryRowsById={turnSummaryRowsById}
      />
    );
  }
  return (
    <div className="text-sm text-muted-foreground">Loading turn details...</div>
  );
}

function TimelineRowView({
  erroredTurnSummaryIds,
  expansion,
  isTail,
  loadingTurnSummaryIds,
  onLoadTurnSummaryRows,
  row,
  scopeActive,
  turnSummaryRowsById,
}: TimelineRowViewProps) {
  if (row.kind === "conversation") {
    return <ConversationRow row={row} />;
  }

  const title = buildTimelineRowTitle(
    row,
    timelineRowTitleOptions({ isTail, row, scopeActive }),
  );

  if (!isRowExpandable(row)) {
    return (
      <TimelineStaticRow>
        <TimelineTitleView title={title} />
      </TimelineStaticRow>
    );
  }

  return (
    <ExpandableTimelineRow
      title={title}
      isExpanded={expansion.isExpanded(row.id)}
      onToggle={() => expansion.toggle(row.id)}
      body={
        <TimelineExpandableBody
          row={row}
          scopeActive={scopeActive}
          expansion={expansion}
          loadingTurnSummaryIds={loadingTurnSummaryIds}
          erroredTurnSummaryIds={erroredTurnSummaryIds}
          onLoadTurnSummaryRows={onLoadTurnSummaryRows}
          turnSummaryRowsById={turnSummaryRowsById}
        />
      }
    />
  );
}

function TimelineRowsList({
  erroredTurnSummaryIds,
  expansion,
  loadingTurnSummaryIds,
  onLoadTurnSummaryRows,
  rows,
  scopeActive,
  turnSummaryRowsById,
}: TimelineRowsListProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {rows.map((row, index) => (
        <TimelineRowView
          key={row.id}
          row={row}
          isTail={index === rows.length - 1}
          scopeActive={scopeActive}
          expansion={expansion}
          loadingTurnSummaryIds={loadingTurnSummaryIds}
          erroredTurnSummaryIds={erroredTurnSummaryIds}
          onLoadTurnSummaryRows={onLoadTurnSummaryRows}
          turnSummaryRowsById={turnSummaryRowsById}
        />
      ))}
    </div>
  );
}

export function ThreadTimelineRows(props: ThreadTimelineRowsProps) {
  const rows = useMemo(
    () => buildTimelineViewRows(props.timelineRows),
    [props.timelineRows],
  );
  const scopeActive = isRuntimeScopeActive(props.threadRuntimeDisplayStatus);
  const expansionIds = useMemo(
    () => collectTimelineExpansionIds({ rows, scopeActive }),
    [rows, scopeActive],
  );
  const expansion = useTimelineExpansionState(expansionIds);

  return (
    <TimelineRowsList
      rows={rows}
      scopeActive={scopeActive}
      expansion={expansion}
      loadingTurnSummaryIds={props.loadingTurnSummaryIds}
      erroredTurnSummaryIds={props.erroredTurnSummaryIds}
      onLoadTurnSummaryRows={props.onLoadTurnSummaryRows}
      turnSummaryRowsById={props.turnSummaryRowsById}
    />
  );
}
