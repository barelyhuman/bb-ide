import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ActiveThinking, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { HeightTransition } from "@/components/ui/height-transition.js";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  useBottomAnchoredScroll,
  type CapturedScrollPosition,
} from "@/components/ui/bottom-anchored-scroll-body.js";
import {
  ThreadTimelineRows,
  type ThreadTimelineLocalFileLinkHandler,
  type ThreadTimelineUnreadDividerPlacement,
  type TimelineTitleActionResolver,
} from "@/components/thread/timeline";
import { TimelineStatusIndicator } from "@/components/thread/timeline";
import { TimelineWorkingIndicator } from "@/components/thread/timeline";
import { usePreferredTheme } from "@/hooks/useTheme";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";

interface ThreadTimelinePaneProps {
  activeThinking: ActiveThinking | null;
  footer: ReactNode;
  hasOlderTimelineRows: boolean;
  header: ReactNode;
  hostConnectionNotice?: HostConnectionNotice | null;
  isLoadingOlderTimelineRows: boolean;
  isThreadTimelinePending: boolean;
  timelineError: boolean;
  loadingTurnSummaryIds: ReadonlySet<string>;
  erroredTurnSummaryIds: ReadonlySet<string>;
  onLoadOlderRows: LoadOlderRowsHandler;
  onLoadTurnSummaryRows: (entry: TimelineTurnRow) => void;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  showOngoingIndicator: boolean;
  ongoingIndicatorLabel?: string;
  stopRequestedAt: number | null;
  timelineRows: TimelineRow[];
  threadId: string;
  threadRuntimeDisplayStatus: ThreadRuntimeDisplayStatus;
  turnSummaryRowsIdentity: string;
  turnSummaryRowsById: Record<string, TimelineRow[]>;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
  workspaceRootPath: string | undefined;
}

type LoadOlderRowsHandler = () => Promise<void> | void;

export interface HostConnectionNotice {
  label: string;
  tone: "pending" | "error";
}

interface LoadOlderMessagesButtonProps {
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: LoadOlderRowsHandler;
  timelineRowsVersion: string;
}

interface BuildStopRequestedTimelineRowArgs {
  stopRequestedAt: number;
  threadId: string;
}

interface UseTimelineRowsWithPendingStopArgs {
  rows: TimelineRow[];
  stopRequestedAt: number | null;
  threadId: string;
}

function buildStopRequestedTimelineRow({
  stopRequestedAt,
  threadId,
}: BuildStopRequestedTimelineRowArgs): TimelineRow {
  return {
    id: `${threadId}:pending-stop:${stopRequestedAt}`,
    threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: stopRequestedAt,
    createdAt: stopRequestedAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "thread-interrupted",
    title: "Stop requested",
    detail: null,
    status: "pending",
    completedAt: null,
  };
}

function hasConfirmedStopRow(
  rows: readonly TimelineRow[],
  stopRequestedAt: number,
): boolean {
  return rows.some(
    (row) =>
      row.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "thread-interrupted" &&
      row.createdAt >= stopRequestedAt,
  );
}

function useTimelineRowsWithPendingStop({
  rows,
  stopRequestedAt,
  threadId,
}: UseTimelineRowsWithPendingStopArgs): TimelineRow[] {
  return useMemo(() => {
    if (
      stopRequestedAt === null ||
      hasConfirmedStopRow(rows, stopRequestedAt)
    ) {
      return rows;
    }

    return [
      ...rows,
      buildStopRequestedTimelineRow({ stopRequestedAt, threadId }),
    ];
  }, [rows, stopRequestedAt, threadId]);
}

interface BuildTimelineRowsVersionArgs {
  rows: readonly TimelineRow[];
}

function buildTimelineRowsVersion({
  rows,
}: BuildTimelineRowsVersionArgs): string {
  const firstRowId = rows[0]?.id ?? "";
  const lastRowId = rows.at(-1)?.id ?? "";
  return `${rows.length}:${firstRowId}:${lastRowId}`;
}

export function ThreadTimelinePane({
  activeThinking,
  footer,
  hasOlderTimelineRows,
  header,
  hostConnectionNotice,
  isLoadingOlderTimelineRows,
  isThreadTimelinePending,
  timelineError,
  loadingTurnSummaryIds,
  erroredTurnSummaryIds,
  onLoadOlderRows,
  onLoadTurnSummaryRows,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  showOngoingIndicator,
  ongoingIndicatorLabel,
  stopRequestedAt,
  timelineRows,
  threadId,
  threadRuntimeDisplayStatus,
  turnSummaryRowsIdentity,
  turnSummaryRowsById,
  unreadDividerPlacement,
  workspaceRootPath,
}: ThreadTimelinePaneProps) {
  const preferredTheme = usePreferredTheme();
  const showActiveThinking =
    activeThinking !== null && ongoingIndicatorLabel === undefined;
  const activeThinkingText = activeThinking?.text.trim() ?? "";
  const activeThinkingDetails =
    showActiveThinking && activeThinkingText.length > 0
      ? activeThinking?.text
      : undefined;
  const ongoingIndicatorKey =
    showActiveThinking && activeThinking
      ? activeThinking.id
      : (ongoingIndicatorLabel ?? "working");
  const timelineRowsWithPendingStop = useTimelineRowsWithPendingStop({
    rows: timelineRows,
    stopRequestedAt,
    threadId,
  });
  const timelineRowsVersion = useMemo(
    () => buildTimelineRowsVersion({ rows: timelineRows }),
    [timelineRows],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {header}
      <PageShell
        key={threadId}
        scrollBehavior="bottom-anchor"
        shellClassName="!mx-0 !mt-0 md:!mx-0 md:!mt-0"
        contentClassName="min-h-full gap-2 pt-4"
        footerClassName="chat-prompt-box"
        footer={footer}
      >
        <ConversationTimeline className="flex-1">
          {hasOlderTimelineRows &&
          !isThreadTimelinePending &&
          !timelineError ? (
            <LoadOlderMessagesButton
              isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
              onLoadOlderRows={onLoadOlderRows}
              timelineRowsVersion={timelineRowsVersion}
            />
          ) : null}
          {isThreadTimelinePending ? (
            <DelayedThreadLoadingIndicator />
          ) : timelineError ? (
            <TimelineStatusIndicator
              label="Failed to load timeline"
              className="mt-6 text-destructive"
            />
          ) : timelineRowsWithPendingStop.length > 0 ? (
            <ThreadTimelineRows
              loadingTurnSummaryIds={loadingTurnSummaryIds}
              erroredTurnSummaryIds={erroredTurnSummaryIds}
              onLoadTurnSummaryRows={onLoadTurnSummaryRows}
              onOpenLocalFileLink={onOpenLocalFileLink}
              onTitleAction={onTitleAction}
              projectId={projectId}
              resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
              themeType={preferredTheme}
              timelineRows={timelineRowsWithPendingStop}
              threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
              turnSummaryRowsIdentity={turnSummaryRowsIdentity}
              turnSummaryRowsById={turnSummaryRowsById}
              unreadDividerPlacement={unreadDividerPlacement}
              workspaceRootPath={workspaceRootPath}
            />
          ) : null}
          {hostConnectionNotice ? (
            <TimelineStatusIndicator
              label={hostConnectionNotice.label}
              className={
                hostConnectionNotice.tone === "error"
                  ? "mt-4 text-destructive"
                  : "mt-4"
              }
            />
          ) : null}
          <HeightTransition visible={showOngoingIndicator}>
            <TimelineWorkingIndicator
              key={ongoingIndicatorKey}
              details={activeThinkingDetails}
              isThinking={showActiveThinking}
              label={ongoingIndicatorLabel}
            />
          </HeightTransition>
        </ConversationTimeline>
      </PageShell>
    </div>
  );
}

function LoadOlderMessagesButton({
  isLoadingOlderTimelineRows,
  onLoadOlderRows,
  timelineRowsVersion,
}: LoadOlderMessagesButtonProps) {
  const bottomAnchor = useBottomAnchoredScroll();
  const capturedScrollPositionRef = useRef<CapturedScrollPosition | null>(
    null,
  );
  const observedLoadingRef = useRef(false);
  const previousTimelineRowsVersionRef = useRef(timelineRowsVersion);
  const releaseCapturedScrollPosition = useCallback(() => {
    capturedScrollPositionRef.current?.release();
    capturedScrollPositionRef.current = null;
    observedLoadingRef.current = false;
  }, []);

  useEffect(() => {
    if (previousTimelineRowsVersionRef.current === timelineRowsVersion) {
      return;
    }

    previousTimelineRowsVersionRef.current = timelineRowsVersion;
    if (!observedLoadingRef.current) {
      releaseCapturedScrollPosition();
    }
  }, [releaseCapturedScrollPosition, timelineRowsVersion]);

  useEffect(() => {
    if (isLoadingOlderTimelineRows) {
      observedLoadingRef.current = true;
      return;
    }

    if (observedLoadingRef.current) {
      releaseCapturedScrollPosition();
    }
  }, [isLoadingOlderTimelineRows, releaseCapturedScrollPosition]);

  useEffect(
    () => () => {
      releaseCapturedScrollPosition();
    },
    [releaseCapturedScrollPosition],
  );

  const handleClick = useCallback(() => {
    releaseCapturedScrollPosition();
    capturedScrollPositionRef.current =
      bottomAnchor?.captureScrollPosition() ?? null;
    void Promise.resolve().then(onLoadOlderRows);
  }, [bottomAnchor, onLoadOlderRows, releaseCapturedScrollPosition]);

  return (
    <div className="flex justify-center pt-2 mb-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isLoadingOlderTimelineRows}
      >
        <Icon name="ChevronUp" aria-hidden="true" />
        {isLoadingOlderTimelineRows
          ? "Loading older messages..."
          : "Load older messages"}
      </Button>
    </div>
  );
}

// Delay before revealing the loading indicator so fast loads don't flash.
export const LOADING_INDICATOR_REVEAL_DELAY_MS = 200;

function DelayedThreadLoadingIndicator() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(
      () => setVisible(true),
      LOADING_INDICATOR_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, []);

  if (!visible) {
    return null;
  }

  return <TimelineStatusIndicator label="Loading thread..." className="mt-6" />;
}
