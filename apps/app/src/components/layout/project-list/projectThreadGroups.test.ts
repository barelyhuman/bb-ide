import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildProjectThreadGroups } from "./projectThreadGroups";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

function createThread(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Thread",
    titleFallback: "Thread",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function threadIds(threads: readonly ThreadListEntry[]): string[] {
  return threads.map((thread) => thread.id);
}

describe("buildProjectThreadGroups", () => {
  it("groups managers with managed child stats while sorting unmanaged standards separately", () => {
    const groups = buildProjectThreadGroups([
      createThread({
        id: "root-old",
        createdAt: 10,
        updatedAt: 10,
      }),
      createThread({
        id: "manager-old",
        type: "manager",
        createdAt: 20,
        updatedAt: 20,
      }),
      createThread({
        id: "manager-new",
        type: "manager",
        createdAt: 40,
        updatedAt: 40,
      }),
      createThread({
        id: "child-busy",
        parentThreadId: "manager-old",
        createdAt: 50,
        updatedAt: 80,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "child-idle",
        parentThreadId: "manager-old",
        createdAt: 30,
        updatedAt: 90,
      }),
      createThread({
        id: "orphan-child",
        parentThreadId: "missing-manager",
        createdAt: 60,
        updatedAt: 70,
      }),
    ]);

    expect(
      groups.managerThreadGroups.map((group) => group.managerThread.id),
    ).toEqual(["manager-new", "manager-old"]);
    expect(groups.managerThreadGroups[0]?.stats).toEqual({
      managedChildBusyCount: 0,
      managedChildCount: 0,
    });
    expect(
      threadIds(groups.managerThreadGroups[0]?.managedThreads ?? []),
    ).toEqual([]);
    expect(groups.managerThreadGroups[1]?.stats).toEqual({
      managedChildBusyCount: 1,
      managedChildCount: 2,
    });
    expect(
      threadIds(groups.managerThreadGroups[1]?.managedThreads ?? []),
    ).toEqual(["child-idle", "child-busy"]);
    expect(threadIds(groups.unmanagedStandardThreads)).toEqual([
      "orphan-child",
      "root-old",
    ]);
  });

  it("sorts active standard threads by creation time instead of update time", () => {
    const groups = buildProjectThreadGroups([
      createThread({
        id: "active-old",
        status: "active",
        createdAt: 10,
        updatedAt: 1_000,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "idle-recent",
        createdAt: 20,
        updatedAt: 900,
      }),
      createThread({
        id: "active-new",
        status: "active",
        createdAt: 950,
        updatedAt: 30,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ]);

    expect(threadIds(groups.unmanagedStandardThreads)).toEqual([
      "active-new",
      "idle-recent",
      "active-old",
    ]);
  });

  it("keeps managed children inside their manager group instead of globally interleaving them", () => {
    const groups = buildProjectThreadGroups([
      createThread({
        id: "manager-older",
        type: "manager",
        createdAt: 10,
      }),
      createThread({
        id: "manager-newer",
        type: "manager",
        createdAt: 20,
      }),
      createThread({
        id: "older-manager-recent-child",
        parentThreadId: "manager-older",
        createdAt: 30,
        updatedAt: 1_000,
      }),
      createThread({
        id: "newer-manager-older-child",
        parentThreadId: "manager-newer",
        createdAt: 40,
        updatedAt: 100,
      }),
      createThread({
        id: "unmanaged-standard",
        createdAt: 50,
        updatedAt: 900,
      }),
    ]);

    expect(
      groups.managerThreadGroups.map((group) => [
        group.managerThread.id,
        threadIds(group.managedThreads),
      ]),
    ).toEqual([
      ["manager-newer", ["newer-manager-older-child"]],
      ["manager-older", ["older-manager-recent-child"]],
    ]);
    expect(threadIds(groups.unmanagedStandardThreads)).toEqual([
      "unmanaged-standard",
    ]);
  });
});
