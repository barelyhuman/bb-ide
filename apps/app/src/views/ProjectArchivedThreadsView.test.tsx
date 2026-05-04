// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FetchRoute,
  installFetchRoutes,
  jsonResponse,
} from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ProjectArchivedThreadsView } from "./ProjectArchivedThreadsView";

interface ArchivedThreadsWrapperProps {
  children: ReactNode;
}

interface RenderProjectArchivedThreadsViewArgs {
  onThreadListRequest?: () => void;
  routes?: FetchRoute[];
  threads: ThreadListEntry[];
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    archivedAt: 10,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id: "thr_root",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    projectId: "proj_1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Archived thread",
    titleFallback: "Archived thread",
    type: "standard",
    updatedAt: 1,
    ...overrides,
  };
}

function assertArchivedThreadListRequest(request: Request): void {
  const url = new URL(request.url);
  expect(url.searchParams.get("projectId")).toBe("proj_1");
  expect(url.searchParams.get("archived")).toBe("true");
}

function createArchivedThreadsWrapper() {
  const harness = createQueryClientTestHarness();

  function ArchivedThreadsWrapper({ children }: ArchivedThreadsWrapperProps) {
    return harness.wrapper({
      children: (
        <MemoryRouter initialEntries={["/projects/proj_1/archived"]}>
          <Routes>
            <Route path="/projects/:projectId/archived" element={children} />
          </Routes>
        </MemoryRouter>
      ),
    });
  }

  return { wrapper: ArchivedThreadsWrapper };
}

function createDeferredResponse(): DeferredResponse {
  let resolvePromise: (response: Response) => void = (_response) => {
    throw new Error("Deferred response resolved before initialization");
  };
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (response) => {
      resolvePromise(response);
    },
  };
}

async function renderProjectArchivedThreadsView(
  args: RenderProjectArchivedThreadsViewArgs,
): Promise<void> {
  installFetchRoutes([
    {
      pathname: "/api/v1/threads",
      handler: (request) => {
        assertArchivedThreadListRequest(request);
        args.onThreadListRequest?.();
        return jsonResponse(args.threads);
      },
    },
    ...(args.routes ?? []),
  ]);

  const { wrapper } = createArchivedThreadsWrapper();

  await act(async () => {
    render(<ProjectArchivedThreadsView />, { wrapper });
  });
}

async function renderLoadedArchivedThreads(
  args: RenderProjectArchivedThreadsViewArgs,
): Promise<void> {
  await renderProjectArchivedThreadsView(args);
  await screen.findByText("Root archived thread");
}

function getThreadLinkText(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectArchivedThreadsView", () => {
  it("shows archived managed child threads with a managed pill", async () => {
    await renderProjectArchivedThreadsView({
      threads: [
        createThread({
          archivedAt: 30,
          id: "thr_managed",
          parentThreadId: "thr_manager",
          title: "Managed archived thread",
          titleFallback: "Managed archived thread",
        }),
        createThread({
          archivedAt: 20,
          id: "thr_root",
          title: "Root archived thread",
          titleFallback: "Root archived thread",
        }),
      ],
    });

    expect(await screen.findByText("Managed archived thread")).toBeTruthy();
    expect(screen.getByText("Root archived thread")).toBeTruthy();
    expect(screen.getByText("managed")).toBeTruthy();
  });

  it("shows an empty state when the archived API returns no threads", async () => {
    await renderProjectArchivedThreadsView({ threads: [] });

    expect(await screen.findByText("No archived threads yet.")).toBeTruthy();
  });

  it("sorts archived threads by newest archived timestamp first", async () => {
    await renderProjectArchivedThreadsView({
      threads: [
        createThread({
          archivedAt: 10,
          id: "thr_oldest",
          title: "Oldest archived thread",
          titleFallback: "Oldest archived thread",
        }),
        createThread({
          archivedAt: 30,
          id: "thr_newest",
          title: "Newest archived thread",
          titleFallback: "Newest archived thread",
        }),
        createThread({
          archivedAt: 20,
          id: "thr_middle",
          title: "Middle archived thread",
          titleFallback: "Middle archived thread",
        }),
      ],
    });

    await screen.findByText("Newest archived thread");

    expect(getThreadLinkText()).toEqual([
      "Newest archived thread",
      "Middle archived thread",
      "Oldest archived thread",
    ]);
  });

  it("filters threads with null archivedAt from the response", async () => {
    await renderProjectArchivedThreadsView({
      threads: [
        createThread({
          archivedAt: 20,
          id: "thr_root",
          title: "Root archived thread",
          titleFallback: "Root archived thread",
        }),
        createThread({
          archivedAt: null,
          id: "thr_live_managed",
          parentThreadId: "thr_manager",
          title: "Live managed thread",
          titleFallback: "Live managed thread",
        }),
      ],
    });

    expect(await screen.findByText("Root archived thread")).toBeTruthy();
    expect(screen.queryByText("Live managed thread")).toBeNull();
  });

  it("unarchives a thread and removes it optimistically", async () => {
    let threadListRequestCount = 0;
    let unarchiveRequestCount = 0;
    const unarchiveResponse = createDeferredResponse();
    const archivedThreads = [
      createThread({
        archivedAt: 20,
        id: "thr_root",
        title: "Root archived thread",
        titleFallback: "Root archived thread",
      }),
    ];

    await renderLoadedArchivedThreads({
      onThreadListRequest: () => {
        threadListRequestCount += 1;
      },
      threads: archivedThreads,
      routes: [
        {
          method: "POST",
          pathname: "/api/v1/threads/thr_root/unarchive",
          handler: () => {
            unarchiveRequestCount += 1;
            archivedThreads.splice(0, archivedThreads.length);
            return unarchiveResponse.promise;
          },
        },
      ],
    });
    const initialThreadListRequestCount = threadListRequestCount;

    fireEvent.click(screen.getByRole("button", { name: "Unarchive thread" }));

    await waitFor(() => {
      expect(unarchiveRequestCount).toBe(1);
      expect(screen.queryByText("Root archived thread")).toBeNull();
    });

    await act(async () => {
      unarchiveResponse.resolve(new Response(null, { status: 204 }));
    });

    await waitFor(() => {
      expect(threadListRequestCount).toBeGreaterThan(
        initialThreadListRequestCount,
      );
    });
    expect(screen.queryByText("Root archived thread")).toBeNull();
  });
});
