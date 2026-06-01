// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import {
  useArchiveManagerThreads,
  useMarkThreadRead,
  useMarkThreadUnread,
} from "./thread-state-mutations";

vi.mock("@/lib/api", () => ({
  archiveManagerThreads: vi.fn(),
  markThreadRead: vi.fn(),
  markThreadUnread: vi.fn(),
}));

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread title",
    titleFallback: "Thread title",
    type: "standard",
    updatedAt: 10,
    ...overrides,
  };
}

function makeThreadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const thread = makeThread(overrides);
  return {
    ...thread,
    environmentBranchName: null,
    environmentHostId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    pinSortKey: null,
    ...overrides,
  };
}

function makeSidebarNavigationResponse(
  threads: ThreadListEntry[],
): SidebarBootstrapResponse {
  return {
    projects: [
      {
        createdAt: 1,
        id: "project-1",
        kind: "standard",
        name: "Project One",
        sources: [],
        threads,
        updatedAt: 1,
      },
    ],
    personalProject: {
      createdAt: 1,
      id: "personal-project",
      kind: "personal",
      name: "Personal",
      sources: [],
      threads: [],
      updatedAt: 1,
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("thread state mutations", () => {
  it("archives cached manager groups and invalidates thread lists", async () => {
    const managerThread = makeThread({
      id: "manager-1",
      type: "manager",
    });
    const childThread = makeThread({
      id: "child-1",
      parentThreadId: managerThread.id,
    });
    const otherThread = makeThread({
      id: "thread-2",
    });
    vi.mocked(api.archiveManagerThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: [childThread.id, managerThread.id],
    });

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(managerThread.id), managerThread);
    queryClient.setQueryData(threadQueryKey(childThread.id), childThread);
    const cachedThreads = [
      makeThreadListEntry({
        id: managerThread.id,
        type: managerThread.type,
      }),
      makeThreadListEntry({
        id: childThread.id,
        parentThreadId: managerThread.id,
      }),
      makeThreadListEntry({
        id: otherThread.id,
      }),
    ];
    queryClient.setQueryData<ThreadListEntry[]>(listKey, cachedThreads);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse(cachedThreads),
    );

    const { result } = renderHook(() => useArchiveManagerThreads(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ id: managerThread.id });
    });

    expect(api.archiveManagerThreads).toHaveBeenCalledWith(managerThread.id);
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)).toEqual([
      expect.objectContaining({ id: otherThread.id }),
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.map((thread) => thread.id),
    ).toEqual([otherThread.id]);
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(managerThread.id),
      )?.archivedAt,
    ).toBeTypeOf("number");
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(childThread.id),
      )?.archivedAt,
    ).toBeTypeOf("number");
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("restores cached manager groups when archive all fails", async () => {
    const managerThread = makeThread({
      id: "manager-1",
      type: "manager",
    });
    const childThread = makeThread({
      id: "child-1",
      parentThreadId: managerThread.id,
    });
    const managerListEntry = makeThreadListEntry({
      id: managerThread.id,
      type: managerThread.type,
    });
    const childListEntry = makeThreadListEntry({
      id: childThread.id,
      parentThreadId: managerThread.id,
    });
    vi.mocked(api.archiveManagerThreads).mockRejectedValue(
      new Error("archive failed"),
    );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(managerThread.id), managerThread);
    queryClient.setQueryData(threadQueryKey(childThread.id), childThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [
      managerListEntry,
      childListEntry,
    ]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([managerListEntry, childListEntry]),
    );

    const { result } = renderHook(() => useArchiveManagerThreads(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: managerThread.id }),
      ).rejects.toThrow("archive failed");
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(managerThread.id),
      ),
    ).toEqual(managerThread);
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(childThread.id),
      ),
    ).toEqual(childThread);
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)).toEqual([
      managerListEntry,
      childListEntry,
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)?.threads,
    ).toEqual([managerListEntry, childListEntry]);
  });

  it("marks a thread read without invalidating active thread lists", async () => {
    const unreadThread = makeThread({
      lastReadAt: null,
      latestAttentionAt: 10,
    });
    const readThread = makeThread({ lastReadAt: 10, latestAttentionAt: 10 });
    vi.mocked(api.markThreadRead).mockResolvedValue(readThread);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    const unreadListEntry = makeThreadListEntry({
      lastReadAt: null,
      latestAttentionAt: 10,
    });
    queryClient.setQueryData(threadQueryKey(unreadThread.id), unreadThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [unreadListEntry]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([unreadListEntry]),
    );

    const { result } = renderHook(() => useMarkThreadRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(unreadThread.id);
    });

    expect(queryClient.getQueryData(threadQueryKey(unreadThread.id))).toEqual(
      readThread,
    );
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
    ).toMatchObject({
      id: unreadThread.id,
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0),
    ).toMatchObject({
      id: unreadThread.id,
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      false,
    );
  });

  it("marks a thread unread without invalidating active thread lists", async () => {
    const readThread = makeThread({ lastReadAt: 10, latestAttentionAt: 10 });
    const unreadThread = makeThread({ lastReadAt: 0, latestAttentionAt: 10 });
    vi.mocked(api.markThreadUnread).mockResolvedValue(unreadThread);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    const readListEntry = makeThreadListEntry({
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    queryClient.setQueryData(threadQueryKey(readThread.id), readThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [readListEntry]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([readListEntry]),
    );

    const { result } = renderHook(() => useMarkThreadUnread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(readThread.id);
    });

    expect(queryClient.getQueryData(threadQueryKey(readThread.id))).toEqual(
      unreadThread,
    );
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
    ).toMatchObject({
      id: readThread.id,
      lastReadAt: 0,
      latestAttentionAt: 10,
    });
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0),
    ).toMatchObject({
      id: readThread.id,
      lastReadAt: 0,
      latestAttentionAt: 10,
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      false,
    );
  });
});
