import { describe, expect, it } from "vitest"
import type {
  WorkspaceStatus,
} from "@bb/domain"
import { HttpError } from "./api"
import {
  isArchiveForceRequiredError,
  requiresArchiveConfirmation,
} from "./thread-archive"

type StatusFactoryArgs = {
  state: WorkspaceStatus["workingTree"]["state"];
  hasCommittedUnmergedChanges?: boolean;
}

function makeStatus(args: StatusFactoryArgs): WorkspaceStatus {
  return {
    workingTree: {
      hasUncommittedChanges: false,
      state: args.state,
      changedFiles: 0,
      insertions: 0,
      deletions: 0,
      files: [],
    },
    branch: {
      currentBranch: "feature",
      defaultBranch: "main",
    },
    mergeBase: {
      mergeBaseBranch: "main",
      baseRef: "origin/main",
      aheadCount: 0,
      behindCount: 0,
      hasCommittedUnmergedChanges: args.hasCommittedUnmergedChanges ?? false,
      commits: [],
    },
  }
}

function makeEnvironment(
  managed: boolean,
) {
  return { managed }
}

describe("thread-archive", () => {
  it("does not warn for dirty direct workspaces", () => {
    expect(
      requiresArchiveConfirmation(
        makeStatus({ state: "dirty_uncommitted" }),
        makeEnvironment(false),
      ),
    ).toBe(false)
  })

  it("warns for dirty isolated workspaces", () => {
    expect(
      requiresArchiveConfirmation(
        makeStatus({ state: "dirty_and_committed_unmerged" }),
        makeEnvironment(true),
      ),
    ).toBe(true)
  })

  it("does not warn for clean or deleted isolated workspaces", () => {
    expect(
      requiresArchiveConfirmation(
        makeStatus({ state: "clean" }),
        makeEnvironment(true),
      ),
    ).toBe(false)
    expect(
      requiresArchiveConfirmation(
        makeStatus({ state: "deleted" }),
        makeEnvironment(true),
      ),
    ).toBe(false)
  })

  it("warns for clean or deleted isolated workspaces with unmerged commits", () => {
    expect(
      requiresArchiveConfirmation(
        makeStatus({
          state: "clean",
          hasCommittedUnmergedChanges: true,
        }),
        makeEnvironment(true),
      ),
    ).toBe(true)
    expect(
      requiresArchiveConfirmation(
        makeStatus({
          state: "deleted",
          hasCommittedUnmergedChanges: true,
        }),
        makeEnvironment(true),
      ),
    ).toBe(true)
  })

  it("recognizes force-required archive conflicts", () => {
    expect(
      isArchiveForceRequiredError(
        new HttpError({
          status: 409,
          message: "Thread workspace has uncommitted or unmerged work",
          code: "worktree_not_clean",
        }),
      ),
    ).toBe(true)
    expect(
      isArchiveForceRequiredError(
        new HttpError({
          status: 500,
          message: "Internal error",
          code: "internal_error",
        }),
      ),
    ).toBe(false)
  })
})
