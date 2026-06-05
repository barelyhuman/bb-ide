// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

const COLLAPSED_MANAGERS_STORAGE_KEY = "bb.sidebar.collapsedManagers";
const COLLAPSED_THREADS_STORAGE_KEY = "bb.sidebar.collapsedThreads";

async function readCollapsedThreadIds(): Promise<string[]> {
  const { collapsedThreadIdsAtom } = await import("./sidebarCollapsedAtoms");
  return createStore().get(collapsedThreadIdsAtom);
}

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("collapsedThreadIdsAtom", () => {
  it("migrates old manager collapse state to collapsed threads", async () => {
    window.localStorage.setItem(
      COLLAPSED_MANAGERS_STORAGE_KEY,
      JSON.stringify(["manager-1", "manager-2"]),
    );

    await expect(readCollapsedThreadIds()).resolves.toEqual([
      "manager-1",
      "manager-2",
    ]);
    expect(window.localStorage.getItem(COLLAPSED_MANAGERS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(COLLAPSED_THREADS_STORAGE_KEY)).toBe(
      JSON.stringify(["manager-1", "manager-2"]),
    );
  });

  it("preserves existing collapsed thread state when the old key also exists", async () => {
    window.localStorage.setItem(
      COLLAPSED_MANAGERS_STORAGE_KEY,
      JSON.stringify(["old-manager"]),
    );
    window.localStorage.setItem(
      COLLAPSED_THREADS_STORAGE_KEY,
      JSON.stringify(["thread-parent"]),
    );

    await expect(readCollapsedThreadIds()).resolves.toEqual(["thread-parent"]);
    expect(window.localStorage.getItem(COLLAPSED_MANAGERS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(COLLAPSED_THREADS_STORAGE_KEY)).toBe(
      JSON.stringify(["thread-parent"]),
    );
  });

  it("drops malformed old collapse state without creating new state", async () => {
    window.localStorage.setItem(COLLAPSED_MANAGERS_STORAGE_KEY, "{");

    await expect(readCollapsedThreadIds()).resolves.toEqual([]);
    expect(window.localStorage.getItem(COLLAPSED_MANAGERS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(COLLAPSED_THREADS_STORAGE_KEY)).toBeNull();
  });
});
