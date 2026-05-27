// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import { collapsedProjectIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import {
  ProjectActionsProvider,
  useProjectActions,
} from "./ProjectActionsProvider";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  };
});

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localHostId: null,
    platform: null,
    pickFolder: null,
    isLocalHost: () => false,
  }),
}));

function makeProjectResponse(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return {
    createdAt: 1,
    id: "project-1",
    kind: "standard",
    name: "Project One",
    updatedAt: 1,
    sources: [],
    ...overrides,
  };
}

function renderWithProvider(
  children: ReactNode,
  { jotaiStore }: { jotaiStore?: ReturnType<typeof createStore> } = {},
) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  return render(
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProjectActionsProvider>{children}</ProjectActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

/** Captures the context value so tests can invoke provider APIs directly. */
function HookProbe({
  onReady,
}: {
  onReady: (actions: ReturnType<typeof useProjectActions>) => void;
}) {
  const actions = useProjectActions();
  onReady(actions);
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectActionsProvider", () => {
  it("clears the deleted project from the collapsed-projects atom on success", async () => {
    const project = makeProjectResponse();
    const other = makeProjectResponse({ id: "project-2", name: "Project Two" });
    const jotaiStore = createStore();
    jotaiStore.set(collapsedProjectIdsAtom, [project.id, other.id]);
    vi.mocked(api.deleteProject).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useProjectActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
      { jotaiStore },
    );

    act(() => {
      actions!.requestDelete(project);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /remove project/i }),
    );

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith(project.id);
    });

    // The deleted id is removed; unrelated ids stay.
    await waitFor(() => {
      expect(jotaiStore.get(collapsedProjectIdsAtom)).toEqual([other.id]);
    });
  });
});
