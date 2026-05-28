// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePromptDraftStorage } from "./usePromptDraftStorage";

const PROJECT_DRAFT_SCOPE = {
  projectId: "proj-1",
  threadId: null,
};

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

function requireStorageKey(storageKey: string | null): string {
  if (!storageKey) {
    throw new Error("Expected prompt draft storage key");
  }
  return storageKey;
}

describe("usePromptDraftStorage", () => {
  it("clears the draft when it still matches the submitted snapshot", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );

    act(() => {
      result.current.setText("Investigate the outage");
    });

    const submittedDraft = result.current.getCurrent();
    let didClear = false;

    act(() => {
      didClear = result.current.clearIfCurrentMatches(submittedDraft);
    });

    expect(didClear).toBe(true);
    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      text: "",
    });
  });

  it("preserves newer edits when clearing against a stale submitted snapshot", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );

    act(() => {
      result.current.setText("Investigate the outage");
    });

    const submittedDraft = result.current.getCurrent();

    act(() => {
      result.current.setText("Investigate the outage and summarize root cause");
    });

    let didClear = false;

    act(() => {
      didClear = result.current.clearIfCurrentMatches(submittedDraft);
    });

    expect(didClear).toBe(false);
    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      text: "Investigate the outage and summarize root cause",
    });
  });

  it("keeps text current immediately while deferring localStorage persistence", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setText("Investigate the outage");
    });

    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      text: "Investigate the outage",
    });
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("flushes pending text persistence on pagehide", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setText("Investigate the outage");
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("flushes pending text persistence when the document is hidden", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setText("Investigate the outage");
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("does not persist stale deferred text after an immediate clear", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setText("Investigate the outage");
      result.current.clear();
    });

    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      text: "",
    });
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });
});
