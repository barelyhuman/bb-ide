// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadListResponse } from "@bb/server-contract";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { threadListQueryKey } from "./queries/query-keys";
import { usePromptMentions } from "./usePromptMentions";

interface TestWrapperProps {
  children: ReactNode;
}

type ThreadListEntryFixture = ThreadListResponse[number];
type ThreadListEntryFixtureOverrides = Partial<ThreadListEntryFixture>;

function makeThreadListEntry(
  overrides: ThreadListEntryFixtureOverrides = {},
): ThreadListEntryFixture {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    environmentBranchName: "main",
    environmentHostId: "host-1",
    environmentWorkspaceDisplayKind: "managed-worktree",
    hasPendingInteraction: false,
    id: "thr_default",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "proj_code",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Default thread",
    titleFallback: "Default thread",
    type: "standard",
    updatedAt: 1,
    ...overrides,
  };
}

function createWrapper() {
  const harness = createQueryClientTestHarness();

  function Wrapper({ children }: TestWrapperProps) {
    return harness.wrapper({ children });
  }

  return {
    queryClient: harness.queryClient,
    wrapper: Wrapper,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePromptMentions", () => {
  it("returns project thread title matches in all mode", async () => {
    const projectId = "proj_code";
    const threads: ThreadListResponse = [
      makeThreadListEntry({
        id: "thr_frontend_manager",
        projectId,
        title: "Frontend Manager",
        titleFallback: "Frontend Manager",
        type: "manager",
      }),
      makeThreadListEntry({
        id: "thr_parser_refactor",
        projectId,
        title: "Parser refactor",
        titleFallback: "Parser refactor",
        type: "standard",
      }),
    ];
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse(threads),
      },
      {
        pathname: `/api/v1/projects/${projectId}/paths`,
        handler: () => jsonResponse({ paths: [], truncated: false }),
      },
    ]);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData<ThreadListResponse>(
      threadListQueryKey({ archived: false, projectId }),
      threads,
    );

    const { result } = renderHook(
      () =>
        usePromptMentions(projectId, {
          threadSuggestionMode: "all",
          environmentId: null,
        }),
      { wrapper },
    );

    act(() => {
      result.current.setQuery("frontend");
    });

    await waitFor(() => {
      expect(result.current.suggestions.length).toBeGreaterThan(0);
    });
    const firstSuggestion = result.current.suggestions[0];
    if (!firstSuggestion || firstSuggestion.kind !== "thread") {
      throw new Error(
        "Expected first prompt mention suggestion to be a thread",
      );
    }
    expect(result.current.threadSectionMode).toBe("all");
    expect(firstSuggestion.threadId).toBe("thr_frontend_manager");
    expect(firstSuggestion.title).toBe("Frontend Manager");
    expect(firstSuggestion.replacement).toBe("thread:thr_frontend_manager");
  });
});
