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
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ThreadAssignedChildSummaryResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

interface ThreadToastButton {
  label: ReactNode;
  onClick: () => void;
}

interface CapturedToastProps {
  action?: ThreadToastButton;
  cancel?: ThreadToastButton;
  description?: ReactNode;
  title: ReactNode;
  tone: string;
}

interface CapturedToastOptions {
  id: string;
}

interface ThreadToastInvocation {
  options: CapturedToastOptions;
  props: CapturedToastProps;
}

interface SonnerCustomOptions {
  id?: string | number;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

const threadToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  return {
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const id =
          typeof options?.id === "string" || typeof options?.id === "number"
            ? String(options.id)
            : fallbackId;
        const toast = {
          options: { id },
          renderToast,
        };
        invocations.push(toast);
        return id;
      },
    ),
    dismiss: vi.fn(),
    invocations,
  };
});

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
  toast: {
    custom: threadToastState.custom,
    dismiss: threadToastState.dismiss,
  },
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

function readThreadToast(toast: SonnerCustomToast): ThreadToastInvocation {
  const element = toast.renderToast(toast.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return {
    options: toast.options,
    props: element.props,
  };
}

function requireLatestThreadToastInvocation(): ThreadToastInvocation {
  const invocation = threadToastState.invocations.at(-1);
  if (!invocation) {
    throw new Error("Expected thread action toast invocation.");
  }
  return readThreadToast(invocation);
}

afterEach(() => {
  cleanup();
  threadToastState.invocations.splice(0);
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.getThreadAssignedChildSummary).mockResolvedValue(
    makeAssignedChildSummary(),
  );
});

describe("ThreadActionsProvider", () => {
  it("archives and supports undo from the toast action", async () => {
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
      expect(api.archiveThread).toHaveBeenCalledWith(thread.id);
    });
    expect(api.getThreadAssignedChildSummary).not.toHaveBeenCalled();
    const successInvocation = requireLatestThreadToastInvocation();
    expect(successInvocation.props.tone).toBe("success");
    expect(successInvocation.props.title).toBe("Thread archived");
    expect(successInvocation.props.cancel?.label).toBe("Undo");
    const undo = successInvocation.props.cancel;
    if (!undo) {
      throw new Error("Expected archive success toast to include Undo.");
    }

    act(() => {
      undo.onClick();
    });

    await waitFor(() => {
      expect(api.unarchiveThread).toHaveBeenCalledWith(thread.id);
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
      expect(threadToastState.custom).toHaveBeenCalled();
    });
    expect(requireLatestThreadToastInvocation().props.tone).toBe("error");
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
