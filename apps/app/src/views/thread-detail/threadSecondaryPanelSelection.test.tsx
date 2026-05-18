// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { useThreadSecondaryPanelState } from "@/lib/thread-secondary-panel";
import {
  getActiveFixedSecondaryTab,
  getActiveThreadSecondaryPanel,
  useSetThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";

const THREAD_ID = "thr_secondary_close";

interface TestWrapperProps {
  children: ReactNode;
}

interface SelectionHookProps {
  threadId: string;
}

function TestWrapper({ children }: TestWrapperProps) {
  return (
    <JotaiProvider>
      <MemoryRouter
        initialEntries={[`/projects/proj_test/threads/${THREAD_ID}`]}
      >
        {children}
      </MemoryRouter>
    </JotaiProvider>
  );
}

function useSelectionHarness({ threadId }: SelectionHookProps) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const secondaryPanelState = useThreadSecondaryPanelState(threadId);
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const activeSecondaryPanel = getActiveThreadSecondaryPanel({
    activeFixedSecondaryTab,
    legacyActivePanel: secondaryPanelState.activePanel,
  });
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);

  return {
    activeSecondaryPanel,
    fixedPanelTabsState,
    secondaryPanelState,
    setThreadSecondaryPanel,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("thread secondary panel selection", () => {
  it("clears fixed active tab and legacy state on close while preserving tabs", () => {
    const { result } = renderHook(
      (props: SelectionHookProps) => useSelectionHarness(props),
      {
        initialProps: { threadId: THREAD_ID },
        wrapper: TestWrapper,
      },
    );

    act(() => {
      result.current.setThreadSecondaryPanel("git-diff");
    });

    expect(result.current.activeSecondaryPanel).toBe("git-diff");
    expect(result.current.secondaryPanelState.activePanel).toBe("git-diff");
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
    expect(result.current.secondaryPanelState.activePanel).toBeNull();
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBeNull();
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      { id: "git-diff", kind: "git-diff" },
    ]);
  });
});
