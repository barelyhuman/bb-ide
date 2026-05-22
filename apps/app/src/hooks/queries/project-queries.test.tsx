// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installAbortableJsonRoute } from "@/test/abort-signal-test-utils";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import {
  useProjectPromptHistory,
  useProjectSourceBranches,
} from "./project-queries";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("project queries", () => {
  it("passes AbortSignal through project prompt history requests", async () => {
    const route = installAbortableJsonRoute({
      pathname: "/api/v1/projects/project-1/prompt-history",
      body: [],
    });
    const { wrapper } = createQueryClientTestHarness();
    const { unmount } = renderHook(
      () => useProjectPromptHistory("project-1"),
      { wrapper },
    );

    await waitFor(() => {
      expect(route.getSignal()).toBeInstanceOf(AbortSignal);
    });

    unmount();

    await waitFor(() => {
      expect(route.getSignal()?.aborted).toBe(true);
    });
  });

  it("does not poll project source branches in the background", async () => {
    vi.useFakeTimers();
    let branchRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/projects/project-1/branches",
        handler: () => {
          branchRequestCount += 1;
          return jsonResponse({
            branches: ["main"],
            checkout: {
              kind: "branch",
              branchName: "main",
              headSha: "abc123",
            },
            defaultBranch: "main",
            hasUncommittedChanges: false,
            operation: { kind: "none" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useProjectSourceBranches("project-1", "host-1"), {
      wrapper,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(branchRequestCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(branchRequestCount).toBe(1);
  });
});
