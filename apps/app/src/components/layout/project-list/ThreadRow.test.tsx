// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

interface TitlePositionResult {
  row: HTMLElement;
  titleContainer: HTMLElement;
  titleIndex: number;
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

function requireHTMLElement(
  value: Element | null,
  message: string,
): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(message);
  }

  return value;
}

function getThreadRow(threadTitle: string): HTMLElement {
  return requireHTMLElement(
    screen.getByLabelText(`Open ${threadTitle}`).parentElement,
    `${threadTitle} row was not rendered`,
  );
}

function getThreadTitlePosition(threadTitle: string): TitlePositionResult {
  const row = getThreadRow(threadTitle);
  const titleContainer = requireHTMLElement(
    screen.getByText(threadTitle).parentElement,
    `${threadTitle} title container was not rendered`,
  );
  const titleIndex = Array.from(row.children).indexOf(titleContainer);

  return { row, titleContainer, titleIndex };
}

function expectManagedChildTitlePosition(
  threadTitle: string,
): TitlePositionResult {
  const position = getThreadTitlePosition(threadTitle);
  const leadingBlankSlot = position.row.children[1];
  const managedChildMarker = position.titleContainer.previousElementSibling;

  expect(position.titleIndex).toBe(3);
  expect(leadingBlankSlot?.getAttribute("aria-hidden")).toBe("true");
  expect(leadingBlankSlot?.childElementCount).toBe(0);
  expect(managedChildMarker?.getAttribute("aria-hidden")).toBe("true");
  expect(managedChildMarker?.hasAttribute("data-managed-child-marker")).toBe(
    true,
  );

  return position;
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

  it("renders idle managed child rows as blank slot, decorative chevron, and title", () => {
    renderThreadRow(
      createThread({
        id: "thr_child",
        title: "Managed child",
        titleFallback: "Managed child",
        parentThreadId: "thr_parent",
        status: "idle",
        runtime: {
          displayStatus: "idle",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      { rowOptions: { kind: "managed-child" } },
    );

    expectManagedChildTitlePosition("Managed child");
    expect(screen.queryByLabelText("Managed thread")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(
      screen.queryByLabelText("Pending interaction requires attention"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Unread thread requires attention"),
    ).toBeNull();
  });

  it("keeps managed child title position stable and shows busy status in the trailing slot", () => {
    const rowOptions: RenderThreadRowOptions = {
      rowOptions: { kind: "managed-child" },
    };
    const result = renderThreadRow(
      createThread({
        id: "thr_child",
        title: "Managed child",
        titleFallback: "Managed child",
        parentThreadId: "thr_parent",
        status: "idle",
        environmentWorkspaceDisplayKind: "managed-worktree",
        runtime: {
          displayStatus: "idle",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      rowOptions,
    );

    const idlePosition = expectManagedChildTitlePosition("Managed child");
    const environmentIcon = screen.getByLabelText(
      "Managed worktree environment",
    );
    expect(idlePosition.row.children[4]?.contains(environmentIcon)).toBe(true);

    result.rerender(
      createThreadRowElement({
        rowOptions,
        thread: createThread({
          id: "thr_child",
          title: "Managed child",
          titleFallback: "Managed child",
          parentThreadId: "thr_parent",
          status: "active",
          environmentWorkspaceDisplayKind: "managed-worktree",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      }),
    );

    const busyPosition = expectManagedChildTitlePosition("Managed child");
    const busyIcon = screen.getByLabelText("Thread working");
    expect(busyPosition.titleIndex).toBe(idlePosition.titleIndex);
    expect(busyPosition.row.children[4]?.contains(busyIcon)).toBe(true);
    expect(screen.queryByLabelText("Managed worktree environment")).toBeNull();
  });

  it("keeps pending managed child status in the trailing slot", () => {
    renderThreadRow(
      createThread({
        id: "thr_child",
        title: "Managed child",
        titleFallback: "Managed child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
      }),
      { rowOptions: { kind: "managed-child" } },
    );

    const position = expectManagedChildTitlePosition("Managed child");
    const pendingIcon = screen.getByLabelText(
      "Pending interaction requires attention",
    );
    expect(position.row.children[4]?.contains(pendingIcon)).toBe(true);
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

  it("shows unmanaged busy status in the leading slot and preserves the trailing environment icon", () => {
    renderThreadRow(
      createThread({
        id: "thr_busy",
        title: "Busy thread",
        titleFallback: "Busy thread",
        environmentWorkspaceDisplayKind: "managed-worktree",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    );

    const position = getThreadTitlePosition("Busy thread");
    const busyIcon = screen.getByLabelText("Thread working");
    const environmentIcon = screen.getByLabelText(
      "Managed worktree environment",
    );
    expect(position.titleIndex).toBe(2);
    expect(position.row.children[1]?.contains(busyIcon)).toBe(true);
    expect(position.row.children[3]?.contains(environmentIcon)).toBe(true);
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

  it("shows the idle manager chevron and trailing manager icon", () => {
    renderThreadRow(
      createThread({
        id: "thr_manager",
        type: "manager",
        title: "Manager thread",
        titleFallback: "Manager thread",
        status: "idle",
        runtime: {
          displayStatus: "idle",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      {
        rowOptions: createManagerRowOptions({
          isCollapsed: false,
          managedChildCount: 1,
          managedChildBusyCount: 0,
        }),
      },
    );

    const managerChevron = screen.getByRole("button", {
      name: "Collapse Manager thread threads",
    });

    expect(screen.getByText("manager")).not.toBeNull();
    expect(screen.getByLabelText("Manager")).not.toBeNull();
    expect(managerChevron.querySelector(".animate-spin")).toBeNull();
  });

  it("shows manager busy status in the leading chevron slot without covering the trailing manager icon", () => {
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
    const managerChevron = screen.getByRole("button", {
      name: "Expand Manager thread threads",
    });
    const managerSpinner = managerChevron.querySelector(".animate-spin");

    expect(screen.getByText("manager")).not.toBeNull();
    expect(managerSpinner).not.toBeNull();
    expect(managerIcon.parentElement).not.toBe(managerSpinner?.parentElement);
    expect(getThreadRow("Manager thread").contains(managerIcon)).toBe(true);
  });

  it("toggles manager child visibility from the manager chevron", () => {
    const onToggleCollapsed = vi.fn();

    renderThreadRow(
      createThread({
        id: "thr_manager",
        type: "manager",
        title: "Manager thread",
        titleFallback: "Manager thread",
      }),
      {
        rowOptions: createManagerRowOptions({
          isCollapsed: false,
          onToggleCollapsed,
        }),
      },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse Manager thread threads",
      }),
    );

    expect(onToggleCollapsed).toHaveBeenCalledWith("thr_manager");
  });
});
