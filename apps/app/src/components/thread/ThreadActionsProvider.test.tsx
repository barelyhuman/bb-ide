// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadWithRuntime } from "@bb/domain";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ThreadAssignedChildSummaryResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
    getThreadAssignedChildSummary: vi.fn(),
    markThreadRead: vi.fn(),
    markThreadUnread: vi.fn(),
    unarchiveThread: vi.fn(),
    updateThread: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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
    projectId: "project-1",
    providerId: "provider-1",
    stopRequestedAt: null,
    status: "idle",
    title: "Thread title",
    titleFallback: "Thread title",
    type: "standard",
    updatedAt: 10,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function makeAssignedChildSummary(
  overrides: Partial<ThreadAssignedChildSummaryResponse> = {},
): ThreadAssignedChildSummaryResponse {
  return {
    nonDeletedAssignedChildCount: 0,
    ...overrides,
  };
}

function renderWithProvider(children: ReactNode) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThreadActionsProvider>{children}</ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

function HookProbe({
  onReady,
}: {
  onReady: (actions: ReturnType<typeof useThreadActions>) => void;
}) {
  const actions = useThreadActions();
  onReady(actions);
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.getThreadAssignedChildSummary).mockResolvedValue(
    makeAssignedChildSummary(),
  );
});

describe("ThreadActionsProvider", () => {
  it("archives immediately and shows an undo toast", async () => {
    const thread = makeThread();
    vi.mocked(api.archiveThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleArchive(thread);
    });

    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledWith(thread.id);
    });
    expect(api.getThreadAssignedChildSummary).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Archived thread",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("unarchives from the archive undo toast", async () => {
    const thread = makeThread();
    vi.mocked(api.archiveThread).mockResolvedValue(undefined);
    vi.mocked(api.unarchiveThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleArchive(thread);
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const successCall = vi.mocked(toast.success).mock.calls[0];
    const options = successCall?.[1];
    if (!options || !("action" in options) || !options.action) {
      throw new Error("Expected archive success toast to include an action");
    }
    const action =
      typeof options.action === "object" && "onClick" in options.action
        ? options.action
        : null;
    if (!action) {
      throw new Error("Expected archive success toast action object");
    }

    act(() => {
      action.onClick();
    });

    await waitFor(() => {
      expect(api.unarchiveThread).toHaveBeenCalledWith(thread.id);
    });
  });

  it("archives managers without assigned-child confirmation", async () => {
    const thread = makeThread({ type: "manager" });
    vi.mocked(api.archiveThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleArchive(thread);
    });

    await waitFor(() => {
      expect(api.archiveThread).toHaveBeenCalledWith(thread.id);
    });
    expect(api.getThreadAssignedChildSummary).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/assigned threads will be unassigned/i),
    ).toBeNull();
  });

  it("shows an error toast when archive fails", async () => {
    const thread = makeThread();
    vi.mocked(api.archiveThread).mockRejectedValue(new Error("Archive failed"));

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleArchive(thread);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Archive failed");
    });
  });

  it("unarchives archived threads immediately", async () => {
    const thread = makeThread({ archivedAt: 123 });
    vi.mocked(api.unarchiveThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleArchive(thread);
    });

    await waitFor(() => {
      expect(api.unarchiveThread).toHaveBeenCalledWith(thread.id);
    });
    expect(api.archiveThread).not.toHaveBeenCalled();
  });

  it("toggleRead picks mark-read vs mark-unread based on last-read state", async () => {
    const unreadThread = makeThread({
      id: "thread-unread",
      lastReadAt: 2,
      latestAttentionAt: 10,
    });
    const readThread = makeThread({
      id: "thread-read",
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    vi.mocked(api.markThreadRead).mockResolvedValue(
      makeThread({ id: unreadThread.id, lastReadAt: 10 }),
    );
    vi.mocked(api.markThreadUnread).mockResolvedValue(
      makeThread({ id: readThread.id, lastReadAt: 0 }),
    );

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.toggleRead(unreadThread);
      actions!.toggleRead(readThread);
    });

    await waitFor(() => {
      expect(api.markThreadRead).toHaveBeenCalledWith(unreadThread.id);
      expect(api.markThreadUnread).toHaveBeenCalledWith(readThread.id);
    });
  });

  it("opens a delete confirmation and calls deleteThread when confirmed", async () => {
    const thread = makeThread();
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    const confirmButton = await screen.findByRole("button", {
      name: /delete thread/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteThread).toHaveBeenCalledWith(thread.id, {
        managerChildThreadsConfirmed: false,
      });
    });
  });

  it("confirms before deleting a manager with assigned child threads", async () => {
    const thread = makeThread({ type: "manager" });
    vi.mocked(api.getThreadAssignedChildSummary).mockResolvedValue(
      makeAssignedChildSummary({
        nonDeletedAssignedChildCount: 1,
      }),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    expect(
      await screen.findByText(
        /assigned threads will be unassigned/i,
      ),
    ).not.toBeNull();
    expect(api.deleteThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete manager/i }));

    await waitFor(() => {
      expect(api.deleteThread).toHaveBeenCalledWith(thread.id, {
        managerChildThreadsConfirmed: true,
      });
    });
  });

  it("does not delete when the manager assigned-child confirmation is cancelled", async () => {
    const thread = makeThread({ type: "manager" });
    vi.mocked(api.getThreadAssignedChildSummary).mockResolvedValue(
      makeAssignedChildSummary({
        nonDeletedAssignedChildCount: 1,
      }),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    await screen.findByText(
      /assigned threads will be unassigned/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(
          /assigned threads will be unassigned/i,
        ),
      ).toBeNull();
    });
    expect(api.deleteThread).not.toHaveBeenCalled();
  });

  it("does not delete and shows a toast when the manager assigned-child summary fails", async () => {
    const thread = makeThread({ type: "manager" });
    vi.mocked(api.getThreadAssignedChildSummary).mockRejectedValue(
      new Error("Summary failed"),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(api.deleteThread).not.toHaveBeenCalled();
  });

  it("uses the regular delete confirmation for a manager without assigned child threads", async () => {
    const thread = makeThread({ type: "manager" });
    vi.mocked(api.getThreadAssignedChildSummary).mockResolvedValue(
      makeAssignedChildSummary(),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    const confirmButton = await screen.findByRole("button", {
      name: /delete manager/i,
    });

    expect(
      screen.queryByText(
        /assigned threads will be unassigned/i,
      ),
    ).toBeNull();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteThread).toHaveBeenCalledWith(thread.id, {
        managerChildThreadsConfirmed: false,
      });
    });
  });
});
