// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useResponsiveGitDiffPanelDisplay } from "./useResponsiveGitDiffPanelDisplay";

describe("useResponsiveGitDiffPanelDisplay", () => {
  afterEach(() => {
    cleanup();
  });

  it("switches git diff display mode from the secondary panel width", () => {
    const { result } = renderHook(() =>
      useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: true }),
    );

    act(() => {
      result.current.handleSecondaryPanelWidthChange(800);
    });
    expect(result.current.gitDiffDisplayMode).toBe("split");

    act(() => {
      result.current.handleSecondaryPanelWidthChange(700);
    });
    expect(result.current.gitDiffDisplayMode).toBe("unified");
  });

  it("keeps an explicit mode until panel resize starts", () => {
    const { result } = renderHook(() =>
      useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: true }),
    );

    act(() => {
      result.current.handleSecondaryPanelWidthChange(800);
    });
    expect(result.current.gitDiffDisplayMode).toBe("split");

    act(() => {
      result.current.handleGitDiffDisplayModeChange("unified");
      result.current.handleSecondaryPanelWidthChange(800);
    });
    expect(result.current.gitDiffDisplayMode).toBe("unified");

    act(() => {
      result.current.handleSecondaryPanelResizeStart();
      result.current.handleSecondaryPanelWidthChange(800);
    });
    expect(result.current.gitDiffDisplayMode).toBe("split");
  });
});
