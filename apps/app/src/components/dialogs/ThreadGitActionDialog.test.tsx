// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadGitActionDialog } from "./ThreadGitActionDialog";

afterEach(cleanup);

describe("ThreadGitActionDialogContent", () => {
  it("renders off-page remote merge-base selections in the remote section", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="upstream/main"
        mergeBaseBranchRef={{ name: "upstream/main", kind: "remote" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={["origin/main"]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));

    const remoteHeader = screen.getByText("Remote branches");
    const remoteOption = screen.getByRole("button", {
      name: "upstream/main",
    });

    expect(
      remoteHeader.compareDocumentPosition(remoteOption) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("blocks remote-only squash merge from exact selected-branch classification", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="origin/main"
        mergeBaseBranchRef={{ name: "origin/main", kind: "remote" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={[]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Squash merge" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Squash merge requires a local target branch. Create or check out a local branch from the remote first.",
      ),
    ).not.toBeNull();
  });

  it("allows local squash merge even when the selected branch is not in the current page", () => {
    render(
      <ThreadGitActionDialog
        target={{ kind: "squash_merge" }}
        showMergeBaseDetails
        mergeBaseBranch="release/1.2"
        mergeBaseBranchRef={{ name: "release/1.2", kind: "local" }}
        mergeBaseBranchOptions={["main"]}
        mergeBaseRemoteBranchOptions={[]}
        onMergeBaseBranchChange={vi.fn()}
        onOpenChange={vi.fn()}
        onCommit={async () => {}}
        onSquashMerge={async () => {}}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Squash merge" })
        .disabled,
    ).toBe(false);
  });
});
