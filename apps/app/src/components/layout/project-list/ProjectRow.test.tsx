// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { SidebarStickyStack } from "@bb/ui-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createAppQueryClient } from "@/lib/query-client";
import { ProjectRow, type ProjectThreadListState } from "./ProjectRow";

interface RenderProjectRowArgs {
  collapsedManagerIds?: Set<string>;
  isActive?: boolean;
  isCollapsed?: boolean;
  selectedThreadId?: string;
  threadListState?: ProjectThreadListState;
}

interface ProjectRowTestWrapperProps {
  children: ReactNode;
}

function makeProjectResponse(): ProjectResponse {
  return {
    createdAt: 1,
    id: "proj_1",
    name: "Project Alpha",
    sources: [],
    updatedAt: 2,
  };
}

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Thread One",
    titleFallback: "Thread One",
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

async function renderProjectRow(args: RenderProjectRowArgs = {}) {
  installFetchRoutes([
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

  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const wrapper = ({ children }: ProjectRowTestWrapperProps) => (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <MemoryRouter>
            <ProjectActionsProvider>
              <ThreadActionsProvider>{children}</ThreadActionsProvider>
            </ProjectActionsProvider>
          </MemoryRouter>
        </Suspense>
      </QueryClientProvider>
    </JotaiProvider>
  );

  await act(async () => {
    render(
      <SidebarStickyStack>
        <ProjectRow
          project={makeProjectResponse()}
          threadListState={
            args.threadListState ?? { status: "ready", threads: [] }
          }
          selectedThreadId={args.selectedThreadId}
          isActive={args.isActive ?? false}
          isCollapsed={args.isCollapsed ?? false}
          collapsedManagerIds={args.collapsedManagerIds ?? new Set()}
          isLocalPathInvalid={false}
          localHostId={null}
          onToggleProjectCollapsed={vi.fn()}
          onToggleManagerCollapsed={vi.fn()}
          promotedBranchName={null}
        />
      </SidebarStickyStack>,
      { wrapper },
    );
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

function isBefore(left: HTMLElement, right: HTMLElement): boolean {
  return Boolean(
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectRow", () => {
  it("keeps project and manager rows sticky without changing thread order", async () => {
    const managerThread = createThread({
      id: "thr_manager",
      type: "manager",
      title: "Manager One",
      titleFallback: "Manager One",
      createdAt: 30,
    });
    const managedThread = createThread({
      id: "thr_child",
      parentThreadId: managerThread.id,
      title: "Managed Child",
      titleFallback: "Managed Child",
      createdAt: 20,
    });
    const regularThread = createThread({
      id: "thr_regular",
      title: "Regular Thread",
      titleFallback: "Regular Thread",
      createdAt: 10,
    });

    await renderProjectRow({
      threadListState: {
        status: "ready",
        threads: [regularThread, managedThread, managerThread],
      },
    });

    await screen.findByText("Project Alpha");

    const projectRow = requireHTMLElement(
      screen.getByText("Project Alpha").parentElement,
      "Project row was not rendered",
    );
    const managerRow = requireHTMLElement(
      screen.getByLabelText("Open Manager One").parentElement,
      "Manager row was not rendered",
    );
    const managedRow = requireHTMLElement(
      screen.getByLabelText("Open Managed Child").parentElement,
      "Managed child row was not rendered",
    );
    const regularRow = requireHTMLElement(
      screen.getByLabelText("Open Regular Thread").parentElement,
      "Regular thread row was not rendered",
    );

    expect(projectRow.getAttribute("data-sidebar-sticky-tier")).toBe("project");
    expect(managerRow.getAttribute("data-sidebar-sticky-tier")).toBe("manager");
    expect(managedRow.hasAttribute("data-sidebar-sticky-tier")).toBe(false);
    expect(regularRow.hasAttribute("data-sidebar-sticky-tier")).toBe(false);

    expect(projectRow.querySelector("[data-overflow-fade]")).toBeNull();
    expect(managerRow.querySelector("[data-overflow-fade]")).toBeNull();
    expect(managedRow.querySelector('[data-overflow-fade="below"]')).toBeNull();

    expect(isBefore(projectRow, managerRow)).toBe(true);
    expect(isBefore(managerRow, managedRow)).toBe(true);
    expect(isBefore(managedRow, regularRow)).toBe(true);

  });

  it("preserves collapsed project behavior while keeping the project row sticky", async () => {
    await renderProjectRow({
      isCollapsed: true,
      threadListState: {
        status: "ready",
        threads: [
          createThread({
            id: "thr_manager",
            type: "manager",
            title: "Manager One",
            titleFallback: "Manager One",
          }),
        ],
      },
    });

    await screen.findByText("Project Alpha");

    const projectRow = requireHTMLElement(
      screen.getByText("Project Alpha").parentElement,
      "Project row was not rendered",
    );

    expect(projectRow.getAttribute("data-sidebar-sticky-tier")).toBe("project");
    expect(projectRow.querySelector("[data-overflow-fade]")).toBeNull();
    expect(screen.queryByLabelText("Open Manager One")).toBeNull();
  });

  it("keeps sidebar rows free of overflow fades when managed children are collapsed", async () => {
    const managerThread = createThread({
      id: "thr_manager",
      type: "manager",
      title: "Manager One",
      titleFallback: "Manager One",
      createdAt: 20,
    });
    const managedThread = createThread({
      id: "thr_child",
      parentThreadId: managerThread.id,
      title: "Managed Child",
      titleFallback: "Managed Child",
      createdAt: 10,
    });

    await renderProjectRow({
      collapsedManagerIds: new Set([managerThread.id]),
      threadListState: {
        status: "ready",
        threads: [managedThread, managerThread],
      },
    });

    await screen.findByText("Project Alpha");

    const projectRow = requireHTMLElement(
      screen.getByText("Project Alpha").parentElement,
      "Project row was not rendered",
    );
    const managerRow = requireHTMLElement(
      screen.getByLabelText("Open Manager One").parentElement,
      "Manager row was not rendered",
    );

    expect(projectRow.querySelector("[data-overflow-fade]")).toBeNull();
    expect(managerRow.querySelector("[data-overflow-fade]")).toBeNull();
    expect(screen.queryByLabelText("Open Managed Child")).toBeNull();
  });

  it("uses opaque active backgrounds for sticky project and manager rows", async () => {
    const managerThread = createThread({
      id: "thr_manager",
      type: "manager",
      title: "Manager One",
      titleFallback: "Manager One",
    });

    await renderProjectRow({
      isActive: true,
      selectedThreadId: managerThread.id,
      threadListState: {
        status: "ready",
        threads: [managerThread],
      },
    });

    await screen.findByText("Project Alpha");

    const projectRow = requireHTMLElement(
      screen.getByText("Project Alpha").parentElement,
      "Project row was not rendered",
    );
    const managerRow = requireHTMLElement(
      screen.getByLabelText("Open Manager One").parentElement,
      "Manager row was not rendered",
    );

    expect(projectRow.classList.contains("bg-sidebar-border")).toBe(true);
    expect(projectRow.classList.contains("bg-sidebar-border/80")).toBe(false);
    expect(managerRow.classList.contains("bg-sidebar-border")).toBe(true);
    expect(managerRow.classList.contains("bg-sidebar-border/80")).toBe(false);
  });
});
