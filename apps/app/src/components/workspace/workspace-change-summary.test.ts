import type { WorkspaceFileStatus } from "@bb/domain";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import {
  formatChangeSummary,
  formatWorkspaceFileStatus,
  selectWorkspaceChangedFilesSection,
} from "./workspace-change-summary";

function makeWorkspaceFileStatus(
  status: WorkspaceFileStatus["status"],
): WorkspaceFileStatus {
  return {
    path: "src/file.ts",
    status,
    insertions: null,
    deletions: null,
  };
}

describe("workspace-change-summary", () => {
  it("formats change summaries and file status labels", () => {
    expect(
      formatChangeSummary({
        filesCount: 3,
        insertions: 9,
        deletions: 4,
      }),
    ).toBe("3 files, +9 -4");
    expect(
      formatChangeSummary({
        filesCount: 1,
        insertions: 0,
        deletions: 0,
      }),
    ).toBe("1 file");
    expect(formatWorkspaceFileStatus("??")).toBe("A?");
    expect(formatWorkspaceFileStatus("XY")).toBe("XY");
  });

  it("selects uncommitted working-tree files with no merge-base ref", () => {
    const file = makeWorkspaceFileStatus("M");
    const section = selectWorkspaceChangedFilesSection(
      makeWorkspaceStatus({
        workingTree: makeWorkspaceWorkingTree({
          files: [file],
          hasUncommittedChanges: true,
          state: "dirty_uncommitted",
          insertions: 2,
          deletions: 1,
        }),
      }),
    );

    expect(section).toMatchObject({
      kind: "uncommitted",
      label: "Uncommitted files",
      files: [file],
      mergeBaseRef: null,
      stats: {
        files: [file],
        insertions: 2,
        deletions: 1,
      },
    });
  });

  it("selects untracked working-tree files with no merge-base ref", () => {
    const file = makeWorkspaceFileStatus("??");
    const section = selectWorkspaceChangedFilesSection(
      makeWorkspaceStatus({
        workingTree: makeWorkspaceWorkingTree({
          files: [file],
          hasUncommittedChanges: true,
          state: "untracked",
        }),
      }),
    );

    expect(section).toMatchObject({
      kind: "untracked",
      label: "Untracked files",
      files: [file],
      mergeBaseRef: null,
      stats: {
        files: [file],
      },
    });
  });

  it("carries the merge-base ref on committed changed-file sections", () => {
    const section = selectWorkspaceChangedFilesSection(
      makeWorkspaceStatus({
        mergeBase: makeWorkspaceMergeBase({
          files: [makeWorkspaceFileStatus("D")],
          deletions: 1,
          baseRef: "abc1234",
          aheadCount: 1,
          hasCommittedUnmergedChanges: true,
        }),
      }),
    );

    expect(section).toMatchObject({
      kind: "committed",
      mergeBaseRef: "abc1234",
    });
  });
});
