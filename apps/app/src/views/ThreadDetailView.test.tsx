// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import {
  threadListQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { wsManager } from "@/lib/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailView } from "./ThreadDetailView";

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

interface ThreadDetailWrapperProps {
  children: ReactNode;
}

interface ThreadDetailRenderResult {
  queryClient: QueryClient;
}

interface RenderThreadDetailViewOptions {
  cachedProjectThreads?: ThreadListEntry[];
}

function createThreadListEntry(): ThreadListEntry {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id: "thr-1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    projectId: "project-1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Cached thread",
    titleFallback: "Cached thread",
    type: "standard",
    updatedAt: 1,
  };
}

function createThreadDetailWrapper() {
  const harness = createQueryClientTestHarness();

  function ThreadDetailWrapper({ children }: ThreadDetailWrapperProps) {
    return harness.wrapper({
      children: (
        <Suspense fallback={null}>
          <MemoryRouter initialEntries={["/projects/project-1/threads/thr-1"]}>
            <Routes>
              <Route
                path="/projects/:projectId/threads/:threadId"
                element={children}
              />
            </Routes>
          </MemoryRouter>
        </Suspense>
      ),
    });
  }

  return {
    queryClient: harness.queryClient,
    wrapper: ThreadDetailWrapper,
  };
}

async function renderThreadDetailView(
  options: RenderThreadDetailViewOptions = {},
): Promise<ThreadDetailRenderResult> {
  const { queryClient, wrapper } = createThreadDetailWrapper();

  if (options.cachedProjectThreads) {
    queryClient.setQueryData(
      threadListQueryKey({ projectId: "project-1", archived: false }),
      options.cachedProjectThreads,
    );
  }

  await act(async () => {
    render(<ThreadDetailView />, { wrapper });
  });

  return { queryClient };
}

afterEach(() => {
  wsManager.disconnect();
  cleanup();
  resetFakeReconnectingWebSockets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadDetailView", () => {
  it("keeps showing loading when the thread request fails before the websocket connects", async () => {
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thr-1",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/threads/thr-1/timeline",
        handler: () =>
          jsonResponse({
            activeThinking: null,
            contextWindowUsage: null,
            rows: [],
          }),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            githubConnected: false,
            hostDaemonPort: null,
            sandboxHostSupported: false,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    wsManager.connect();

    const { queryClient } = await renderThreadDetailView();

    await waitFor(() => {
      expect(queryClient.getQueryState(threadQueryKey("thr-1"))?.status).toBe(
        "error",
      );
    });
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Failed to load thread.")).toBeNull();
  });

  it("treats cached thread-list placeholder data as unresolved before the websocket connects", async () => {
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thr-1",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/threads/thr-1/timeline",
        handler: () =>
          jsonResponse({
            activeThinking: null,
            contextWindowUsage: null,
            rows: [],
          }),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            githubConnected: false,
            hostDaemonPort: null,
            sandboxHostSupported: false,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    wsManager.connect();

    const { queryClient } = await renderThreadDetailView({
      cachedProjectThreads: [createThreadListEntry()],
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(threadQueryKey("thr-1"))?.status).toBe(
        "error",
      );
    });
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Cached thread")).toBeNull();
    expect(screen.queryByText("Failed to load thread.")).toBeNull();
  });
});
