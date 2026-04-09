// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadRow } from "./ThreadRow";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    listThreadPendingInteractions: vi.fn(),
  };
});

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsMenu: () => <div data-testid="thread-actions-menu" />,
}));

function createThread(overrides: Partial<Thread> = {}): Thread {
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
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function renderThreadRow(thread: Thread) {
  const { wrapper: queryWrapper } = createQueryClientTestHarness();
  const wrapper = ({ children }: { children: ReactNode }) => (
    queryWrapper({
      children: (
        <MemoryRouter>
          {children}
        </MemoryRouter>
      ),
    })
  );

  return render(
    <ThreadRow
      projectId="proj_1"
      thread={thread}
      isActive={false}
      isActionsDisabled={false}
      onToggleRead={() => {}}
      onRename={() => {}}
      onToggleArchive={() => {}}
      onDelete={() => {}}
      options={{ kind: "default" }}
    />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadRow", () => {
  it("shows a pending-interaction attention dot for root threads", async () => {
    vi.mocked(api.listThreadPendingInteractions).mockResolvedValue([
      {
        id: "pi_1",
        threadId: "thr_1",
        turnId: "turn_1",
        providerId: "codex",
        providerThreadId: "provider-thread-1",
        providerRequestId: "request-1",
        providerRequestMethod: "item/tool/requestUserInput",
        status: "pending",
        payload: {
          kind: "user_input_request",
          itemId: "item_1",
          questions: [],
        },
        resolution: null,
        statusReason: null,
        createdAt: 1,
        resolvedAt: null,
      },
    ]);

    renderThreadRow(createThread());

    await waitFor(() => {
      expect(
        screen.getByLabelText("Pending interaction requires attention"),
      ).not.toBeNull();
    });
  });

  it("does not query pending interactions for managed child threads", () => {
    renderThreadRow(createThread({
      id: "thr_child",
      parentThreadId: "thr_parent",
    }));

    expect(api.listThreadPendingInteractions).not.toHaveBeenCalled();
  });
});
