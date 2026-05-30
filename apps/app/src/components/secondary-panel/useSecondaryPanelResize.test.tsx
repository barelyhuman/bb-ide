// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { threadSecondaryPanelResizingAtom } from "./threadSecondaryPanelAtoms";
import { useSecondaryPanelResize } from "./useSecondaryPanelResize";

const noop = () => undefined;

describe("useSecondaryPanelResize", () => {
  afterEach(() => {
    cleanup();
    getDefaultStore().set(threadSecondaryPanelResizingAtom, false);
  });

  it("clears the iframe drag guard when unmounted during resize", () => {
    const store = getDefaultStore();
    const { result, unmount } = renderHook(() =>
      useSecondaryPanelResize({
        isSecondaryPanelOpen: true,
        onPanelWidthChange: noop,
      }),
    );

    act(() => {
      result.current.handleSecondaryPanelDragging(true);
    });
    expect(store.get(threadSecondaryPanelResizingAtom)).toBe(true);

    unmount();

    expect(store.get(threadSecondaryPanelResizingAtom)).toBe(false);
  });

  it("clears the iframe drag guard on mouseup fallback", () => {
    const store = getDefaultStore();
    const { result } = renderHook(() =>
      useSecondaryPanelResize({
        isSecondaryPanelOpen: true,
        onPanelWidthChange: noop,
      }),
    );

    act(() => {
      result.current.handleSecondaryPanelDragging(true);
    });
    expect(store.get(threadSecondaryPanelResizingAtom)).toBe(true);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(store.get(threadSecondaryPanelResizingAtom)).toBe(false);
  });
});
