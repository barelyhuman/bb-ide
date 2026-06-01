// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import { useArchiveEnvironmentThreads } from "./environment-mutations";

vi.mock("@/lib/api", () => {
  class HttpError extends Error {}
  return {
    HttpError,
    archiveEnvironmentThreads: vi.fn(),
  };
});

type ThreadOverrides = Partial<ThreadWithRuntime>;
type ThreadListEntryOverrides = Partial<ThreadListEntry>;

function makeThread(overrides: ThreadOverrides = {}): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 1,
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
    updatedAt: 1,
    ...overrides,
  };
}

function makeThreadListEntry(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  const thread = makeThread(overrides);
  return {
    ...thread,
    environmentBranchName: null,
    environmentHostId: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
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

describe("environment mutations", () => {
  it("archives cached live worktree threads and invalidates thread lists", async () => {
    const firstThread = makeThread({ id: "thread-1" });
    const secondThread = makeThread({ id: "thread-2" });
    const otherEnvironmentThread = makeThread({
      environmentId: "environment-2",
      id: "thread-3",
    });
    const alreadyArchivedThread = makeThreadListEntry({
      archivedAt: 20,
      id: "thread-4",
    });
    vi.mocked(api.archiveEnvironmentThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: [firstThread.id, secondThread.id],
    });

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const activeListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const archivedListKey = archivedThreadsListQueryKey({
      kind: "all",
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(firstThread.id), firstThread);
    queryClient.setQueryData(threadQueryKey(secondThread.id), secondThread);
    const cachedThreads = [
      makeThreadListEntry({ id: firstThread.id }),
      makeThreadListEntry({ id: secondThread.id }),
      makeThreadListEntry({
        environmentId: otherEnvironmentThread.environmentId,
        id: otherEnvironmentThread.id,
      }),
    ];
    queryClient.setQueryData<ThreadListEntry[]>(activeListKey, cachedThreads);
    queryClient.setQueryData<ThreadListEntry[]>(archivedListKey, [
      alreadyArchivedThread,
    ]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse(cachedThreads),
    );

    const { result } = renderHook(() => useArchiveEnvironmentThreads(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "environment-1" });
    });

    expect(api.archiveEnvironmentThreads).toHaveBeenCalledWith("environment-1");
    expect(queryClient.getQueryData<ThreadListEntry[]>(activeListKey)).toEqual([
      expect.objectContaining({ id: otherEnvironmentThread.id }),
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.map((thread) => thread.id),
    ).toEqual([otherEnvironmentThread.id]);
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(archivedListKey),
    ).toEqual([alreadyArchivedThread]);
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(firstThread.id),
      )?.archivedAt,
    ).toBeTypeOf("number");
    expect(queryClient.getQueryState(activeListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(archivedListKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("restores cached worktree threads when archive fails", async () => {
    const thread = makeThread({ id: "thread-1" });
    const listEntry = makeThreadListEntry({ id: thread.id });
    vi.mocked(api.archiveEnvironmentThreads).mockRejectedValue(
      new Error("archive failed"),
    );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const activeListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
    queryClient.setQueryData<ThreadListEntry[]>(activeListKey, [listEntry]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([listEntry]),
    );

    const { result } = renderHook(() => useArchiveEnvironmentThreads(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: "environment-1" }),
      ).rejects.toThrow("archive failed");
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(thread.id)),
    ).toEqual(thread);
    expect(queryClient.getQueryData<ThreadListEntry[]>(activeListKey)).toEqual([
      listEntry,
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)?.threads,
    ).toEqual([listEntry]);
  });
});
