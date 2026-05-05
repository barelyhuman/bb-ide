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
  it("classifies managers and managed child stats while sorting standard threads globally", () => {
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

    expect(threadIds(groups.managerThreads)).toEqual([
      "manager-new",
      "manager-old",
    ]);
    expect(groups.managerThreadStatsByManagerId.get("manager-old")).toEqual({
      managedChildBusyCount: 1,
      managedChildCount: 2,
    });
    expect(
      groups.managerThreadStatsByManagerId.get("manager-new"),
    ).toBeUndefined();
    expect(threadIds(groups.standardThreads)).toEqual([
      "child-idle",
      "child-busy",
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

    expect(threadIds(groups.standardThreads)).toEqual([
      "active-new",
      "idle-recent",
      "active-old",
    ]);
  });
});
