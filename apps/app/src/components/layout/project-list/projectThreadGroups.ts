import type { ThreadListEntry } from "@bb/domain";
import { isBusyThread } from "@/lib/thread-activity";

export interface ManagerThreadStats {
  managedChildCount: number;
  managedChildBusyCount: number;
}

export interface ProjectThreadGroups {
  managerThreads: ThreadListEntry[];
  managerThreadIds: Set<string>;
  managerThreadStatsByManagerId: Map<string, ManagerThreadStats>;
  standardThreads: ThreadListEntry[];
}

interface KnownManagerParentArgs {
  managerThreadIds: ReadonlySet<string>;
  thread: ThreadListEntry;
}

function compareByCreatedAtDescending(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function getStandardThreadSortTimestamp(thread: ThreadListEntry): number {
  // Active threads receive frequent updates while work is streaming, so keep
  // their row position tied to the thread start time instead.
  return thread.status === "active" ? thread.createdAt : thread.updatedAt;
}

function compareStandardThreads(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  const timestampDelta =
    getStandardThreadSortTimestamp(right) -
    getStandardThreadSortTimestamp(left);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return compareByCreatedAtDescending(left, right);
}

function getKnownManagerParentId({
  managerThreadIds,
  thread,
}: KnownManagerParentArgs): string | null {
  if (thread.type !== "standard") return null;
  if (thread.parentThreadId === null) return null;
  if (!managerThreadIds.has(thread.parentThreadId)) return null;

  return thread.parentThreadId;
}

export function buildProjectThreadGroups(
  projectThreads: ThreadListEntry[],
): ProjectThreadGroups {
  const managerThreads = projectThreads
    .filter((thread) => thread.type === "manager")
    .sort(compareByCreatedAtDescending);
  const managerThreadIds = new Set(managerThreads.map((thread) => thread.id));
  const managerThreadStatsByManagerId = new Map<string, ManagerThreadStats>();

  for (const thread of projectThreads) {
    const managerId = getKnownManagerParentId({ managerThreadIds, thread });
    if (managerId === null) continue;

    const existing = managerThreadStatsByManagerId.get(managerId);
    if (existing) {
      existing.managedChildCount += 1;
      if (isBusyThread(thread)) {
        existing.managedChildBusyCount += 1;
      }
      continue;
    }

    managerThreadStatsByManagerId.set(managerId, {
      managedChildCount: 1,
      managedChildBusyCount: isBusyThread(thread) ? 1 : 0,
    });
  }

  const standardThreads = projectThreads
    .filter((thread) => thread.type === "standard")
    .sort(compareStandardThreads);

  return {
    managerThreads,
    managerThreadIds,
    managerThreadStatsByManagerId,
    standardThreads,
  };
}
