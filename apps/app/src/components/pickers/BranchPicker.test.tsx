// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "./BranchPicker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BranchPicker", () => {
  it("routes classified off-page remote merge-base refs into remote options", () => {
    expect(
      getMergeBaseBranchCandidateGroups({
        mergeBaseBranch: "upstream/main",
        mergeBaseBranchRef: { name: "upstream/main", kind: "remote" },
        mergeBaseBranchOptions: ["main"],
        remoteMergeBaseBranchOptions: ["origin/main"],
      }),
    ).toEqual({
      options: ["main"],
      remoteOptions: ["upstream/main", "origin/main"],
      selectedOptionKind: "remote",
    });
  });

  it("allows remote refs as a local new-branch base", () => {
    const handleCreateBaseChange = vi.fn();

    render(
      <BranchPicker
        value="main"
        isCreatingNew
        menuKind="checkout"
        options={["main", "develop"]}
        remoteOptions={["origin/main"]}
        onChange={vi.fn()}
        onCreateBaseChange={handleCreateBaseChange}
        onCreate={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));

    expect(screen.getByText("Remote branches")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "origin/main" }));

    expect(handleCreateBaseChange).toHaveBeenCalledWith("origin/main");
  });

  it("keeps selected remote refs in the remote branch section", () => {
    render(
      <BranchPicker
        value="upstream/main"
        menuKind="base"
        options={["main", "develop"]}
        remoteOptions={["upstream/main", "origin/main"]}
        onChange={vi.fn()}
        modal={false}
        defaultOpen
      />,
    );

    const remoteHeader = screen.getByText("Remote branches");
    const remoteOption = screen.getByRole("button", {
      name: "upstream/main",
    });

    expect(
      remoteHeader.compareDocumentPosition(remoteOption) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "upstream/main" }),
    ).toHaveLength(1);
  });

  it("does not duplicate compact trigger text in the DOM", () => {
    render(
      <BranchPicker
        value="main"
        triggerLabel="Current (main)"
        variant="option"
        options={["main", "develop"]}
        remoteOptions={[]}
        onChange={vi.fn()}
        modal={false}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Branch" }).textContent).toBe(
      "Current (main)",
    );
  });

  it("debounces outward search query changes", () => {
    vi.useFakeTimers();
    const handleSearchQueryChange = vi.fn();

    render(
      <BranchPicker
        value="main"
        options={["main", "develop"]}
        remoteOptions={["origin/main"]}
        onChange={vi.fn()}
        onSearchQueryChange={handleSearchQueryChange}
        modal={false}
        defaultOpen
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    handleSearchQueryChange.mockClear();

    const searchInput = screen.getByPlaceholderText("Search branches");
    fireEvent.change(searchInput, { target: { value: "o" } });
    fireEvent.change(searchInput, { target: { value: "or" } });

    expect(handleSearchQueryChange).not.toHaveBeenCalledWith("or");

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(handleSearchQueryChange).toHaveBeenLastCalledWith("or");
  });
});
