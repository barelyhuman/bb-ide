// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider } from "jotai";
import { useCallback, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  useFixedPanelTabsSecondaryPanelUrlSync,
  useFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  createEmptyFixedPanelTabsState,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";
import {
  getActiveFixedSecondaryTab,
  getActiveThreadSecondaryPanel,
  getSelectedThreadSecondaryPanel,
  useSetThreadSecondaryPanelSelection,
  useToggleThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";

const THREAD_ID = "thr_secondary_close";

interface TestWrapperProps {
  children: ReactNode;
}

interface SelectionHookProps {
  threadId: string;
}

interface CreateTestWrapperArgs {
  initialEntries?: string[];
}

function createTestWrapper(args: CreateTestWrapperArgs = {}) {
  const initialEntries = args.initialEntries ?? [
    `/projects/proj_test/threads/${THREAD_ID}`,
  ];
  function TestWrapper({ children }: TestWrapperProps) {
    return (
      <JotaiProvider>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </JotaiProvider>
    );
  }
  return TestWrapper;
}

function useSelectionHarness({ threadId }: SelectionHookProps) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const selectedSecondaryPanel = getSelectedThreadSecondaryPanel({
    activeFixedSecondaryTab,
  });
  const activeSecondaryPanel = getActiveThreadSecondaryPanel({
    fixedPanelTabsState,
    selectedSecondaryPanel,
  });
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const toggleThreadSecondaryPanel =
    useToggleThreadSecondaryPanelSelection(threadId);

  return {
    activeSecondaryPanel,
    fixedPanelTabsState,
    selectedSecondaryPanel,
    setThreadSecondaryPanel,
    toggleThreadSecondaryPanel,
  };
}

function useUrlSyncHarness({ threadId }: SelectionHookProps) {
  const location = useLocation();
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const setSecondaryPanelFromUrl = useCallback(
    (panel: ThreadSecondaryPanel) => {
      setThreadSecondaryPanel(panel);
    },
    [setThreadSecondaryPanel],
  );

  useFixedPanelTabsSecondaryPanelUrlSync(threadId, setSecondaryPanelFromUrl);

  return {
    fixedPanelTabsState,
    location,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("thread secondary panel selection", () => {
  it("closes without clearing the selected tab and reopens the previous tab", () => {
    const { result } = renderHook(
      (props: SelectionHookProps) => useSelectionHarness(props),
      {
        initialProps: { threadId: THREAD_ID },
        wrapper: createTestWrapper(),
      },
    );

    act(() => {
      result.current.setThreadSecondaryPanel("git-diff");
    });

    expect(result.current.activeSecondaryPanel).toBe("git-diff");
    expect(result.current.selectedSecondaryPanel).toBe("git-diff");
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
      "git-diff",
    );
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      { id: "git-diff", kind: "git-diff" },
    ]);

    act(() => {
      result.current.setThreadSecondaryPanel(null);
    });

    expect(result.current.activeSecondaryPanel).toBeNull();
    expect(result.current.selectedSecondaryPanel).toBe("git-diff");
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(false);
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
      "git-diff",
    );
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      { id: "git-diff", kind: "git-diff" },
    ]);

    act(() => {
      result.current.toggleThreadSecondaryPanel();
    });

    expect(result.current.activeSecondaryPanel).toBe("git-diff");
    expect(result.current.selectedSecondaryPanel).toBe("git-diff");
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
  });

  it("consumes a URL override without rewriting another thread preference", async () => {
    const urlThreadId = "thr-url-source";
    const otherThreadId = "thr-url-other";
    const otherThreadStorageKey = getFixedPanelTabsStateStorageKey({
      threadId: otherThreadId,
    });
    const otherThreadState = createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [{ id: "thread-info", kind: "thread-info" }],
        activeTabId: "thread-info",
        isOpen: true,
      },
      lastUsedAt: Date.now(),
    });
    const otherThreadStoredValue = serializeFixedPanelTabsState({
      state: otherThreadState,
    });
    window.localStorage.setItem(otherThreadStorageKey, otherThreadStoredValue);

    const { rerender, result } = renderHook(
      (props: SelectionHookProps) => useUrlSyncHarness(props),
      {
        initialProps: { threadId: urlThreadId },
        wrapper: createTestWrapper({
          initialEntries: [
            `/projects/proj_test/threads/${urlThreadId}?secondaryPanel=git-diff`,
          ],
        }),
      },
    );

    await waitFor(() => {
      expect(result.current.location.search).toBe("");
      expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
        "git-diff",
      );
      expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
    });

    rerender({ threadId: otherThreadId });

    expect(result.current.location.search).toBe("");
    expect(result.current.fixedPanelTabsState).toEqual(otherThreadState);
    expect(window.localStorage.getItem(otherThreadStorageKey)).toBe(
      otherThreadStoredValue,
    );
  });
});
