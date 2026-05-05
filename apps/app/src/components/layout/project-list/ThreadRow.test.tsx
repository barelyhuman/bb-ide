// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

interface TestWrapperProps {
  children: ReactNode;
}

interface RenderThreadRowOptions {
  isActive?: boolean;
  isPromoted?: boolean;
  rowOptions?: ThreadRowOptions;
}

interface ThreadRowElementArgs {
  rowOptions?: RenderThreadRowOptions;
  thread: ThreadListEntry;
}

interface ThreadRenderProbeArgs {
  onRenderRead: () => void;
  thread: ThreadListEntry;
}

type ManagerThreadRowOptions = Extract<ThreadRowOptions, { kind: "manager" }>;

type ManagerThreadRowOptionOverrides = Partial<ManagerThreadRowOptions>;

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
    title: "Pending interaction thread",
    titleFallback: "Pending interaction thread",
    status: "active",
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
      displayStatus: "active",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function installThreadRenderProbe({
  onRenderRead,
  thread,
}: ThreadRenderProbeArgs): ThreadListEntry {
  Object.defineProperty(thread, "hasPendingInteraction", {
    configurable: true,
    get() {
      onRenderRead();
      return false;
    },
  });

  return thread;
}

function createManagerRowOptions(
  overrides: ManagerThreadRowOptionOverrides = {},
): ManagerThreadRowOptions {
  return {
    kind: "manager",
    isCollapsed: false,
    managedChildCount: 1,
    managedChildBusyCount: 0,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
}

function createThreadRowElement({
  rowOptions = {},
  thread,
}: ThreadRowElementArgs) {
  return (
    <ThreadRow
      projectId="proj_1"
      thread={thread}
      isActive={rowOptions.isActive ?? false}
      isPromoted={rowOptions.isPromoted}
      options={rowOptions.rowOptions ?? { kind: "default" }}
    />
  );
}

function renderThreadRow(
  thread: ThreadListEntry,
  options: RenderThreadRowOptions = {},
) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const wrapper = ({ children }: TestWrapperProps) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThreadActionsProvider>{children}</ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>
  );

  return render(createThreadRowElement({ rowOptions: options, thread }), {
    wrapper,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadRow", () => {
  it("shows a pending-interaction attention dot for root threads", async () => {
    renderThreadRow(createThread({ hasPendingInteraction: true }));

    await waitFor(() => {
      expect(
        screen.getByLabelText("Pending interaction requires attention"),
      ).not.toBeNull();
    });
  });

  it("shows the pending interaction dot for threads with a manager parent", () => {
    renderThreadRow(
      createThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
      }),
    );

    expect(
      screen.getByLabelText("Pending interaction requires attention"),
    ).not.toBeNull();
  });

  it("shows a managed worktree environment icon", () => {
    renderThreadRow(
      createThread({ environmentWorkspaceDisplayKind: "managed-worktree" }),
    );

    expect(
      screen.getByLabelText("Managed worktree environment"),
    ).not.toBeNull();
  });

  it("shows an unmanaged worktree environment icon", () => {
    renderThreadRow(
      createThread({ environmentWorkspaceDisplayKind: "unmanaged-worktree" }),
    );

    expect(screen.getByLabelText("Git worktree environment")).not.toBeNull();
  });

  it("shows a sandbox environment icon", () => {
    renderThreadRow(
      createThread({ environmentWorkspaceDisplayKind: "sandbox" }),
    );

    expect(screen.getByLabelText("Sandbox environment")).not.toBeNull();
  });

  it("shows a promoted pill", () => {
    renderThreadRow(createThread(), { isPromoted: true });

    expect(screen.getByText("promoted")).not.toBeNull();
  });

  it("shows a working spinner for busy rows with a manager parent", () => {
    renderThreadRow(
      createThread({
        id: "thr_managed_child",
        title: "Managed child",
        titleFallback: "Managed child",
        parentThreadId: "thr_manager",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    );

    expect(screen.getByLabelText("Open Managed child")).not.toBeNull();
    expect(screen.getByLabelText("Thread working")).not.toBeNull();
  });

  it("rerenders when promoted state changes", () => {
    let renderCount = 0;
    const thread = installThreadRenderProbe({
      onRenderRead: () => {
        renderCount += 1;
      },
      thread: createThread(),
    });
    const result = renderThreadRow(thread, {
      isPromoted: false,
    });

    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBeGreaterThan(0);
    expect(screen.queryByText("promoted")).toBeNull();

    result.rerender(
      createThreadRowElement({
        rowOptions: { isPromoted: true },
        thread,
      }),
    );

    expect(renderCount).toBeGreaterThan(initialRenderCount);
    expect(screen.getByText("promoted")).not.toBeNull();
  });

  it("rerenders when manager child counts change", () => {
    let renderCount = 0;
    const thread = installThreadRenderProbe({
      onRenderRead: () => {
        renderCount += 1;
      },
      thread: createThread({
        type: "manager",
        title: "Manager thread",
        titleFallback: "Manager thread",
      }),
    });
    const result = renderThreadRow(thread, {
      rowOptions: createManagerRowOptions(),
    });

    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBeGreaterThan(0);
    expect(screen.getByLabelText("1 managed thread")).not.toBeNull();

    result.rerender(
      createThreadRowElement({
        rowOptions: {
          rowOptions: createManagerRowOptions({
            managedChildCount: 2,
          }),
        },
        thread,
      }),
    );

    expect(renderCount).toBeGreaterThan(initialRenderCount);
    expect(screen.getByLabelText("2 managed threads")).not.toBeNull();
  });

  it("skips rerender when manager row props are unchanged", () => {
    let renderCount = 0;
    const thread = installThreadRenderProbe({
      onRenderRead: () => {
        renderCount += 1;
      },
      thread: createThread({
        type: "manager",
        title: "Manager thread",
        titleFallback: "Manager thread",
      }),
    });
    const rowOptions = createManagerRowOptions();
    const result = renderThreadRow(thread, { rowOptions });

    const initialRenderCount = renderCount;
    expect(initialRenderCount).toBeGreaterThan(0);

    result.rerender(
      createThreadRowElement({
        rowOptions: { rowOptions },
        thread,
      }),
    );

    expect(renderCount).toBe(initialRenderCount);
  });

  it("shows the manager pill and places the working spinner over the manager icon", () => {
    renderThreadRow(
      createThread({
        id: "thr_manager",
        type: "manager",
        title: "Manager thread",
        titleFallback: "Manager thread",
      }),
      {
        rowOptions: createManagerRowOptions({
          isCollapsed: true,
          managedChildCount: 2,
          managedChildBusyCount: 1,
        }),
      },
    );

    const managerIcon = screen.getByLabelText("Manager");
    const managerSpinner = screen.getByLabelText("Manager working");
    const managerChevron = screen.getByRole("button", {
      name: "Expand Manager thread threads",
    });

    expect(screen.getByText("manager")).not.toBeNull();
    expect(managerSpinner.parentElement).toBe(managerIcon.parentElement);
    expect(managerChevron.querySelector(".animate-spin")).toBeNull();
  });
});
