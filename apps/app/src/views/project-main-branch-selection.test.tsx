// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useScopedBranchSelection } from "./project-main-branch-selection";

interface HookProps {
  defaultBranch: string | null;
  environmentValue: string;
  projectId: string | undefined;
}

function renderBranchSelection(initialProps: HookProps) {
  return renderHook((props: HookProps) => useScopedBranchSelection(props), {
    initialProps,
  });
}

afterEach(cleanup);

describe("useScopedBranchSelection", () => {
  it("does not create a branch before a base branch is resolved", () => {
    const { result } = renderBranchSelection({
      defaultBranch: null,
      environmentValue: "host:hst_test:local",
      projectId: "proj_test",
    });

    act(() => {
      result.current.onCreateBranch();
    });

    expect(result.current.selectedBranch).toBeNull();
  });

  it("creates a branch from the resolved default branch", () => {
    const { result } = renderBranchSelection({
      defaultBranch: "main",
      environmentValue: "host:hst_test:local",
      projectId: "proj_test",
    });

    act(() => {
      result.current.onCreateBranch();
    });

    expect(result.current.selectedBranch).toEqual({
      isNew: true,
      name: "main",
    });
  });

  it("creates a branch from the current selected branch when present", () => {
    const { result } = renderBranchSelection({
      defaultBranch: "main",
      environmentValue: "host:hst_test:local",
      projectId: "proj_test",
    });

    act(() => {
      result.current.onBranchChange("release/1.2");
    });
    act(() => {
      result.current.onCreateBranch();
    });

    expect(result.current.selectedBranch).toEqual({
      isNew: true,
      name: "release/1.2",
    });
  });

  it("scopes branch selection to the current project and environment", () => {
    const firstScopeProps = {
      defaultBranch: "main",
      environmentValue: "host:hst_test:local",
      projectId: "proj_test",
    };
    const { result, rerender } = renderBranchSelection(firstScopeProps);

    act(() => {
      result.current.onBranchChange("release/1.2");
    });

    expect(result.current.selectedBranch).toEqual({
      isNew: false,
      name: "release/1.2",
    });

    rerender({
      defaultBranch: "develop",
      environmentValue: "host:hst_test:worktree",
      projectId: "proj_test",
    });

    expect(result.current.selectedBranch).toBeNull();

    act(() => {
      result.current.onCreateBranch();
    });

    expect(result.current.selectedBranch).toEqual({
      isNew: true,
      name: "develop",
    });

    rerender(firstScopeProps);

    expect(result.current.selectedBranch).toBeNull();
  });
});
