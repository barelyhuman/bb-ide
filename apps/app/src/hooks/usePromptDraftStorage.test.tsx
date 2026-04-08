// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePromptDraftStorage } from "./usePromptDraftStorage";

const PROJECT_DRAFT_SCOPE = {
  projectId: "proj-1",
  threadId: null,
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("usePromptDraftStorage", () => {
  it("clears the draft when it still matches the submitted snapshot", () => {
    const { result } = renderHook(() => usePromptDraftStorage(PROJECT_DRAFT_SCOPE));

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
    const { result } = renderHook(() => usePromptDraftStorage(PROJECT_DRAFT_SCOPE));

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
});
