import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "@bb/test-helpers";
import { vi } from "vitest";

export const provisionHostMock = vi.fn();
export const resumeHostMock = vi.fn();

export function cleanWorkspaceStatus() {
  return makeWorkspaceStatus({
    branch: { currentBranch: "bb/thread", defaultBranch: "main" },
    mergeBase: makeWorkspaceMergeBase({ baseRef: "origin/main" }),
  });
}
