// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { WorkspacePathEntry } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NewTabPage } from "./NewTabPage";
import { CREATE_APP_PROMPT_TEMPLATE } from "./NewTabFileSearch";
import {
  getThreadRecentItemsStorageKey,
  type ThreadRecentItem,
} from "./threadRecentItems";
import type { FileSearchSelection } from "./useThreadFileTabs";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    searchProjectPaths: vi.fn(),
    listApps: vi.fn(),
    listThreadStoragePaths: vi.fn(),
  };
});

interface PathEntryFixture {
  kind: WorkspacePathEntry["kind"];
  path: string;
  score: number;
  positions?: number[];
}

interface PathListFixtureResponse {
  paths: WorkspacePathEntry[];
  truncated: boolean;
}

interface RenderNewTabPageArgs {
  projectId?: string;
  currentThreadId?: string;
  currentThreadType?: "manager" | "standard";
  onSelect?: (selection: FileSearchSelection) => void;
}

function getPathName(pathValue: string): string {
  return pathValue.split("/").at(-1) ?? pathValue;
}

function makePathEntry(fixture: PathEntryFixture): WorkspacePathEntry {
  return {
    kind: fixture.kind,
    path: fixture.path,
    name: getPathName(fixture.path),
    score: fixture.score,
    positions: fixture.positions ?? [],
  };
}

function makePathResponse(
  fixtures: PathEntryFixture[],
): PathListFixtureResponse {
  return {
    paths: fixtures.map(makePathEntry),
    truncated: false,
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function seedRecentItems(threadId: string, items: ThreadRecentItem[]): void {
  window.localStorage.setItem(
    getThreadRecentItemsStorageKey({ threadId }),
    JSON.stringify(items),
  );
}

function mockEmptySearchSources(): void {
  vi.mocked(api.listApps).mockResolvedValue([]);
  vi.mocked(api.searchProjectPaths).mockResolvedValue(makePathResponse([]));
  vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
    ...makePathResponse([]),
    storageRootPath: "/tmp/thread-storage",
  });
}

function renderNewTabPage(args: RenderNewTabPageArgs = {}) {
  const { wrapper } = createQueryClientTestHarness();
  const onSelect: (selection: FileSearchSelection) => void =
    args.onSelect ?? vi.fn();
  return {
    onSelect,
    ...render(
      <NewTabPage
        projectId={args.projectId}
        environmentId="env-1"
        currentThreadId={args.currentThreadId ?? "thr-standard"}
        currentThreadType={args.currentThreadType ?? "standard"}
        focusRequest={0}
        onSelect={onSelect}
      />,
      { wrapper },
    ),
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("NewTabPage", () => {
  it("renders file search and selects a workspace result", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/app.ts",
          score: 80,
        },
      ]),
    );
    const { onSelect } = renderNewTabPage({ projectId: "proj-1" });

    expect(
      screen.queryByRole("textbox", { name: "Search apps and files" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: /Open file/u })).toBeNull();
    expect(screen.queryByRole("option", { name: /Open browser/u })).toBeNull();
    const input = screen.getByRole("textbox", {
      name: "Search files",
    });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "app" } });
    expect(await screen.findByText("Files")).toBeTruthy();
    expect(await screen.findByText("app.ts")).toBeTruthy();
    expect(await screen.findByText(/src/u)).toBeTruthy();
    expect(screen.queryByText("Manager Storage")).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: /app\.ts/u }));

    expect(onSelect).toHaveBeenCalledWith({
      source: "workspace",
      path: "src/app.ts",
    });
  });

  it("structures the create-app prompt with no placeholders and ends ready for the user", () => {
    expect(CREATE_APP_PROMPT_TEMPLATE).not.toMatch(/\[NAME\]/u);
    expect(CREATE_APP_PROMPT_TEMPLATE).not.toMatch(
      /\[DESCRIBE WHAT IT SHOULD DO\]/u,
    );
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("bb guide app");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("window.bb.data");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("window.bb.message.send");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("Vite + React + TypeScript");
    expect(CREATE_APP_PROMPT_TEMPLATE).toContain("pnpm build");
    expect(CREATE_APP_PROMPT_TEMPLATE.endsWith("What I want:\n\n")).toBe(true);
  });

  it("selects a manager thread-storage result with the keyboard", async () => {
    vi.mocked(api.listApps).mockResolvedValue([]);
    vi.mocked(api.searchProjectPaths).mockResolvedValue(
      makePathResponse([
        {
          kind: "file",
          path: "src/workspace.ts",
          score: 90,
        },
      ]),
    );
    vi.mocked(api.listThreadStoragePaths).mockResolvedValue({
      ...makePathResponse([
        {
          kind: "file",
          path: "notes/status.md",
          score: 80,
        },
      ]),
      storageRootPath: "/tmp/thread-storage",
    });
    const { onSelect } = renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-manager",
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", {
      name: "Search files",
    });
    fireEvent.change(input, { target: { value: "status" } });
    await screen.findByText("Files");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "notes/status.md",
    });
  });

  it("renders an unavailable state without querying", () => {
    renderNewTabPage({ currentThreadId: "" });

    expect(
      screen.getByText("No searchable file source is available."),
    ).toBeTruthy();
    expect(api.searchProjectPaths).not.toHaveBeenCalled();
    expect(api.listApps).not.toHaveBeenCalled();
    expect(api.listThreadStoragePaths).not.toHaveBeenCalled();
  });
});

describe("NewTabPage recent section", () => {
  it("lists recent items newest-first with type chips and relative timestamps", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-render";
    const now = Date.now();
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: now - 2 * MINUTE_MS,
      },
      {
        source: "thread-storage",
        path: "plans/sidebar-mockup.html",
        openedAt: now - HOUR_MS,
      },
      {
        source: "workspace",
        path: "apps/app/src/components/secondary-panel/NewTabFileSearch.tsx",
        openedAt: now - 25 * HOUR_MS,
      },
    ]);

    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
      currentThreadType: "manager",
    });

    const recentList = await screen.findByRole("listbox", { name: "Recent" });
    const recentOptions = within(recentList).getAllByRole("option");
    expect(recentOptions.map((option) => option.textContent ?? "")).toEqual([
      expect.stringContaining("swap-model.md"),
      expect.stringContaining("sidebar-mockup.html"),
      expect.stringContaining("NewTabFileSearch.tsx"),
    ]);

    // Chip labels follow the artifact kind, not just the extension.
    expect(within(recentList).getByText("Plan")).toBeTruthy();
    expect(within(recentList).getByText("Mockup")).toBeTruthy();
    expect(within(recentList).getByText("Source")).toBeTruthy();

    // Right-aligned relative timestamps.
    expect(within(recentList).getByText("2m ago")).toBeTruthy();
    expect(within(recentList).getByText("1h ago")).toBeTruthy();
    expect(within(recentList).getByText("Yesterday")).toBeTruthy();
  });

  it("opens a recent item in the panel when its row is clicked", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-click";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
    ]);
    const { onSelect } = renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
      currentThreadType: "manager",
    });

    fireEvent.click(
      await screen.findByRole("option", { name: /swap-model\.md/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      source: "thread-storage",
      path: "plans/swap-model.md",
    });
  });

  it("shows recent file and artifact rows in the file search screen", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-file-search";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
      {
        source: "thread-storage",
        path: "plans/sidebar-mockup.html",
        openedAt: Date.now() - 3 * MINUTE_MS,
      },
    ]);
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
      currentThreadType: "manager",
    });

    await screen.findByText("swap-model.md");
    expect(screen.getByText("sidebar-mockup.html")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Back to new tab menu" }),
    ).toBeNull();
  });

  it("reaches a recent row via keyboard navigation", async () => {
    mockEmptySearchSources();
    const threadId = "thr-recent-keys";
    seedRecentItems(threadId, [
      {
        source: "thread-storage",
        path: "plans/swap-model.md",
        openedAt: Date.now() - 2 * MINUTE_MS,
      },
    ]);
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: threadId,
      currentThreadType: "manager",
    });

    const input = screen.getByRole("textbox", { name: "Search files" });
    const recentOption = await screen.findByRole("option", {
      name: /swap-model\.md/u,
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(recentOption.id);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(recentOption.id);
    expect(recentOption.getAttribute("aria-selected")).toBe("true");
  });

  it("degrades to a quiet hint when the thread has no recent items", async () => {
    mockEmptySearchSources();
    renderNewTabPage({
      projectId: "proj-1",
      currentThreadId: "thr-recent-empty",
      currentThreadType: "manager",
    });

    const hint = await screen.findByText(/Nothing referenced yet/u);
    expect(hint).toBeTruthy();
    expect(hint.className).not.toContain("border-dashed");
  });
});
