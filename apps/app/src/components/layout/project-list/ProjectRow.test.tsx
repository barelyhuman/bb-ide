// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

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
  overrides: ThreadListEntryOverrides = {},
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
    status: "idle",
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
      displayStatus: "idle",
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
    showMutationErrorToasts: false,
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

function getThreadOpenLabels(): string[] {
  return screen.getAllByLabelText(/^Open /u).flatMap((link) => {
    const label = link.getAttribute("aria-label")?.replace(/^Open /u, "");
    return label === undefined ? [] : [label];
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectRow", () => {
  it("keeps project and manager rows sticky while standard rows stay flat", async () => {
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
      updatedAt: 20,
    });
    const regularThread = createThread({
      id: "thr_regular",
      title: "Regular Thread",
      titleFallback: "Regular Thread",
      createdAt: 10,
      updatedAt: 10,
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
    expect(managerRow.classList.contains("relative")).toBe(false);
    expect(managedRow.hasAttribute("data-sidebar-sticky-tier")).toBe(false);
    expect(regularRow.hasAttribute("data-sidebar-sticky-tier")).toBe(false);
    expect(managedRow.classList.contains("relative")).toBe(true);
    expect(regularRow.classList.contains("relative")).toBe(true);
    expect(managedRow.classList.contains("pl-2")).toBe(true);
    expect(managedRow.classList.contains("pl-6")).toBe(false);
    expect(
      managedRow.querySelector("[data-managed-child-marker]"),
    ).not.toBeNull();
    expect(regularRow.querySelector("[data-managed-child-marker]")).toBeNull();

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

  it("uses selected backgrounds for active project and manager rows", async () => {
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
    expect(projectRow.classList.contains("bg-sidebar")).toBe(false);
    expect(projectRow.classList.contains("bg-sidebar-border/80")).toBe(false);
    expect(managerRow.classList.contains("bg-sidebar-border")).toBe(true);
    expect(managerRow.classList.contains("bg-sidebar")).toBe(false);
    expect(managerRow.classList.contains("bg-sidebar-border/80")).toBe(false);
  });

  it("renders managers with grouped children before sorted unmanaged standard rows", async () => {
    const managerOlder = createThread({
      id: "thr_manager_older",
      type: "manager",
      title: "Manager older",
      titleFallback: "Manager older",
      createdAt: 10,
      updatedAt: 10,
    });
    const managerNewer = createThread({
      id: "thr_manager_newer",
      type: "manager",
      title: "Manager newer",
      titleFallback: "Manager newer",
      createdAt: 20,
      updatedAt: 20,
    });
    const activeNewer = createThread({
      id: "thr_active_newer",
      title: "Active newer",
      titleFallback: "Active newer",
      status: "active",
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
      createdAt: 700,
      updatedAt: 5,
    });
    const managedRecent = createThread({
      id: "thr_managed_recent",
      title: "Managed recent",
      titleFallback: "Managed recent",
      parentThreadId: managerOlder.id,
      createdAt: 30,
      updatedAt: 650,
    });
    const idleRecent = createThread({
      id: "thr_idle_recent",
      title: "Idle recent",
      titleFallback: "Idle recent",
      createdAt: 40,
      updatedAt: 600,
    });
    const activeOlder = createThread({
      id: "thr_active_older",
      title: "Active older",
      titleFallback: "Active older",
      status: "active",
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
      createdAt: 500,
      updatedAt: 5_000,
    });
    const idleOlder = createThread({
      id: "thr_idle_older",
      title: "Idle older",
      titleFallback: "Idle older",
      createdAt: 50,
      updatedAt: 400,
    });

    await renderProjectRow({
      threadListState: {
        status: "ready",
        threads: [
          idleOlder,
          activeOlder,
          managerOlder,
          managedRecent,
          managerNewer,
          idleRecent,
          activeNewer,
        ],
      },
    });

    await waitFor(() => {
      expect(getThreadOpenLabels()).toEqual([
        "Manager newer",
        "Manager older",
        "Managed recent",
        "Active newer",
        "Idle recent",
        "Active older",
        "Idle older",
      ]);
    });
  });

  it("hides collapsed managed children while leaving unrelated standard rows visible", async () => {
    const manager = createThread({
      id: "thr_manager",
      type: "manager",
      title: "Manager",
      titleFallback: "Manager",
      createdAt: 10,
      updatedAt: 10,
    });
    const managedChild = createThread({
      id: "thr_managed_child",
      title: "Managed child",
      titleFallback: "Managed child",
      parentThreadId: manager.id,
      createdAt: 20,
      updatedAt: 500,
    });
    const orphanChild = createThread({
      id: "thr_orphan_child",
      title: "Orphan child",
      titleFallback: "Orphan child",
      parentThreadId: "thr_missing_manager",
      createdAt: 30,
      updatedAt: 400,
    });
    const unrelatedThread = createThread({
      id: "thr_unrelated",
      title: "Unrelated standard",
      titleFallback: "Unrelated standard",
      createdAt: 40,
      updatedAt: 300,
    });

    await renderProjectRow({
      collapsedManagerIds: new Set([manager.id]),
      threadListState: {
        status: "ready",
        threads: [manager, managedChild, orphanChild, unrelatedThread],
      },
    });

    await waitFor(() => {
      expect(getThreadOpenLabels()).toEqual([
        "Manager",
        "Orphan child",
        "Unrelated standard",
      ]);
    });

    const orphanRow = requireHTMLElement(
      screen.getByLabelText("Open Orphan child").parentElement,
      "Orphan child row was not rendered",
    );
    expect(orphanRow.querySelector("[data-managed-child-marker]")).toBeNull();
  });
});
