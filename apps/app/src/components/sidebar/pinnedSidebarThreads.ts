import type { ThreadListEntry } from "@bb/domain";
import { getCollapsedChildActivity } from "@/lib/thread-activity";
import {
  buildProjectThreadGroups,
  type ManagerThreadGroup,
} from "./projectThreadGroups";

export type PinnedSidebarRootItem =
  | { kind: "thread"; thread: ThreadListEntry }
  | { kind: "manager"; group: ManagerThreadGroup };

export interface PinnedSidebarState {
  effectivePinnedThreadIds: Set<string>;
  rootItems: PinnedSidebarRootItem[];
}

interface BuildPinnedSidebarStateArgs {
  threads: readonly ThreadListEntry[];
}

interface BuildPinnedManagerGroupArgs {
  children: readonly ThreadListEntry[];
  managerThread: ThreadListEntry;
}

function compareByPinnedFallback(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const pinnedAtDelta = (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
  if (pinnedAtDelta !== 0) {
    return pinnedAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function comparePinnedRoots(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  if (left.pinSortKey !== null && right.pinSortKey !== null) {
    const pinSortKeyDelta = left.pinSortKey.localeCompare(right.pinSortKey);
    if (pinSortKeyDelta !== 0) {
      return pinSortKeyDelta;
    }
  }

  return compareByPinnedFallback(left, right);
}

function buildPinnedManagerGroup({
  children,
  managerThread,
}: BuildPinnedManagerGroupArgs): ManagerThreadGroup {
  const groups = buildProjectThreadGroups([managerThread, ...children]);
  const group = groups.managerThreadGroups[0];
  if (group) {
    return group;
  }

  return {
    managerThread,
    managedItems: [],
    stats: {
      managedChildActivity: getCollapsedChildActivity([]),
      managedChildCount: 0,
    },
  };
}

export function buildPinnedSidebarState({
  threads,
}: BuildPinnedSidebarStateArgs): PinnedSidebarState {
  const explicitlyPinnedThreads = threads.filter(
    (thread) => thread.pinnedAt !== null,
  );
  const pinnedManagerThreadIds = new Set(
    explicitlyPinnedThreads
      .filter((thread) => thread.type === "manager")
      .map((thread) => thread.id),
  );
  const childrenByManagerId = new Map<string, ThreadListEntry[]>();

  for (const thread of threads) {
    if (thread.type !== "standard" || thread.parentThreadId === null) {
      continue;
    }
    const managerChildren = childrenByManagerId.get(thread.parentThreadId);
    if (managerChildren) {
      managerChildren.push(thread);
      continue;
    }
    childrenByManagerId.set(thread.parentThreadId, [thread]);
  }

  const effectivePinnedThreadIds = new Set(
    explicitlyPinnedThreads.map((thread) => thread.id),
  );
  for (const managerThreadId of pinnedManagerThreadIds) {
    for (const child of childrenByManagerId.get(managerThreadId) ?? []) {
      effectivePinnedThreadIds.add(child.id);
    }
  }

  const visiblePinnedRoots = explicitlyPinnedThreads
    .filter(
      (thread) =>
        thread.parentThreadId === null ||
        !pinnedManagerThreadIds.has(thread.parentThreadId),
    )
    .sort(comparePinnedRoots);

  return {
    effectivePinnedThreadIds,
    rootItems: visiblePinnedRoots.map((thread) =>
      thread.type === "manager"
        ? {
            kind: "manager",
            group: buildPinnedManagerGroup({
              children: childrenByManagerId.get(thread.id) ?? [],
              managerThread: thread,
            }),
          }
        : { kind: "thread", thread },
    ),
  };
}
