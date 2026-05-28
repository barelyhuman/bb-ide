import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildPinnedSidebarState } from "./pinnedSidebarThreads";

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
    pinnedAt: null,
    pinSortKey: null,
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

describe("buildPinnedSidebarState", () => {
  it("sorts visible pinned roots by global pin sort key", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "unpinned",
          createdAt: 4,
        }),
        createThread({
          id: "pinned-late",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
        createThread({
          id: "pinned-early",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect(
      state.rootItems.map((item) =>
        item.kind === "thread" ? item.thread.id : item.group.managerThread.id,
      ),
    ).toEqual(["pinned-early", "pinned-late"]);
    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "pinned-early",
      "pinned-late",
    ]);
  });

  it("moves manager children with a pinned manager", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
        }),
        createThread({
          id: "root",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "child",
      "manager",
    ]);
    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "manager") {
      throw new Error("Expected pinned manager root item");
    }
    expect(item.group.managerThread.id).toBe("manager");
    expect(item.group.stats.managedChildCount).toBe(1);
  });

  it("renders an explicitly pinned child as a root only when its manager is not pinned", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "thread") {
      throw new Error("Expected pinned child root item");
    }
    expect(item.thread.id).toBe("child");
  });

  it("hides an explicitly pinned child under its pinned manager root", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "manager",
          type: "manager",
          pinnedAt: 2_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "child",
          parentThreadId: "manager",
          pinnedAt: 1_000,
          pinSortKey: "b",
        }),
      ],
    });

    expect(state.rootItems).toHaveLength(1);
    const item = state.rootItems[0];
    if (!item || item.kind !== "manager") {
      throw new Error("Expected pinned manager root item");
    }
    expect(item.group.managerThread.id).toBe("manager");
    expect(item.group.stats.managedChildCount).toBe(1);
  });
});
