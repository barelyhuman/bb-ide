import { useEffect, useState } from "react";
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
  placement: ThreadTimelineUnreadDividerPlacement | null;
  threadId: string;
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

export interface UseThreadUnreadDividerPlacementArgs {
  routeThreadId: string | undefined;
  thread: ThreadUnreadDividerThreadState | undefined;
  useStandardManagerTimeline: boolean;
}

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

export function useThreadUnreadDividerPlacement({
  routeThreadId,
  thread,
  useStandardManagerTimeline,
}: UseThreadUnreadDividerPlacementArgs): ThreadTimelineUnreadDividerPlacement | null {
  const [snapshot, setSnapshot] = useState<ThreadUnreadDividerSnapshot | null>(
    null,
  );
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
      setSnapshot(null);
      return;
    }

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
          return {
            attentionAt: threadLatestAttentionAt,
            placement: { kind: "before-first" },
            threadId,
          };
        }
        return currentSnapshot;
      }

      return {
        attentionAt: threadLatestAttentionAt,
        placement: buildUnreadDividerPlacement(threadState),
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
    return null;
  }

  return snapshot.placement;
}
