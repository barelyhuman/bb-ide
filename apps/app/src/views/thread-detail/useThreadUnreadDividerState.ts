import { useEffect, useRef, useState } from "react";
import type { ThreadTimelineUnreadDividerPlacement } from "@/components/thread/timeline";
import type { ThreadType } from "@bb/domain";

interface ThreadUnreadDividerThreadState {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
  type: ThreadType;
}

interface ThreadUnreadDividerSnapshot {
  attentionAt: number;
  autoScroll: boolean;
  placement: ThreadTimelineUnreadDividerPlacement | null;
  threadId: string;
}

export interface ThreadUnreadDividerState {
  autoScroll: boolean;
  placement: ThreadTimelineUnreadDividerPlacement | null;
}

interface ShouldTrackThreadUnreadDividerArgs {
  routeThreadId: string | undefined;
  threadId: string | undefined;
  threadType: ThreadType | undefined;
  useStandardManagerTimeline: boolean;
}

interface IsThreadUnreadArgs {
  lastReadAt: number | null | undefined;
  latestAttentionAt: number | undefined;
}

export interface UseThreadUnreadDividerStateArgs {
  routeThreadId: string | undefined;
  thread: ThreadUnreadDividerThreadState | undefined;
  useStandardManagerTimeline: boolean;
}

const NO_UNREAD_DIVIDER_STATE: ThreadUnreadDividerState = {
  autoScroll: false,
  placement: null,
};

function shouldTrackThreadUnreadDivider({
  routeThreadId,
  threadId,
  threadType,
  useStandardManagerTimeline,
}: ShouldTrackThreadUnreadDividerArgs): boolean {
  if (
    threadId === undefined ||
    threadType === undefined ||
    routeThreadId !== threadId
  ) {
    return false;
  }

  return !(threadType === "manager" && useStandardManagerTimeline);
}

function isThreadUnread({
  lastReadAt,
  latestAttentionAt,
}: IsThreadUnreadArgs): boolean {
  if (lastReadAt === undefined || latestAttentionAt === undefined) {
    return false;
  }
  return lastReadAt === null || lastReadAt < latestAttentionAt;
}

function buildUnreadDividerPlacement(
  thread: ThreadUnreadDividerThreadState,
): ThreadTimelineUnreadDividerPlacement | null {
  if (thread.lastReadAt === null) {
    return { kind: "before-first" };
  }
  if (thread.lastReadAt < thread.latestAttentionAt) {
    return { kind: "after-cutoff", cutoffAt: thread.lastReadAt };
  }
  return null;
}

export function useThreadUnreadDividerState({
  routeThreadId,
  thread,
  useStandardManagerTimeline,
}: UseThreadUnreadDividerStateArgs): ThreadUnreadDividerState {
  const [snapshot, setSnapshot] = useState<ThreadUnreadDividerSnapshot | null>(
    null,
  );
  const trackedThreadIdRef = useRef<string | null>(null);
  const threadId = thread?.id;
  const threadLastReadAt = thread?.lastReadAt;
  const threadLatestAttentionAt = thread?.latestAttentionAt;
  const threadType = thread?.type;

  useEffect(() => {
    if (
      threadId === undefined ||
      threadLastReadAt === undefined ||
      threadLatestAttentionAt === undefined ||
      threadType === undefined ||
      !shouldTrackThreadUnreadDivider({
        routeThreadId,
        threadId,
        threadType,
        useStandardManagerTimeline,
      })
    ) {
      trackedThreadIdRef.current = null;
      setSnapshot(null);
      return;
    }

    const isFirstTrackedThreadState = trackedThreadIdRef.current !== threadId;
    trackedThreadIdRef.current = threadId;
    const threadState: ThreadUnreadDividerThreadState = {
      id: threadId,
      lastReadAt: threadLastReadAt,
      latestAttentionAt: threadLatestAttentionAt,
      type: threadType,
    };

    setSnapshot((currentSnapshot) => {
      if (
        currentSnapshot?.threadId === threadId &&
        currentSnapshot.attentionAt === threadLatestAttentionAt
      ) {
        if (threadLastReadAt === null) {
          // Preserve the existing scroll decision when a manual unread mark
          // moves the divider from the cutoff row to the top.
          const autoScroll =
            currentSnapshot.placement !== null && currentSnapshot.autoScroll;
          return {
            attentionAt: threadLatestAttentionAt,
            autoScroll,
            placement: { kind: "before-first" },
            threadId,
          };
        }
        return currentSnapshot;
      }

      const placement = buildUnreadDividerPlacement(threadState);
      return {
        attentionAt: threadLatestAttentionAt,
        autoScroll: isFirstTrackedThreadState && placement !== null,
        placement,
        threadId,
      };
    });
  }, [
    routeThreadId,
    threadId,
    threadLastReadAt,
    threadLatestAttentionAt,
    threadType,
    useStandardManagerTimeline,
  ]);

  if (
    !shouldTrackThreadUnreadDivider({
      routeThreadId,
      threadId,
      threadType,
      useStandardManagerTimeline,
    }) ||
    snapshot === null ||
    snapshot.threadId !== threadId ||
    (snapshot.attentionAt !== threadLatestAttentionAt &&
      !isThreadUnread({
        lastReadAt: threadLastReadAt,
        latestAttentionAt: threadLatestAttentionAt,
      }))
  ) {
    return NO_UNREAD_DIVIDER_STATE;
  }

  return {
    autoScroll: snapshot.autoScroll && snapshot.placement !== null,
    placement: snapshot.placement,
  };
}
