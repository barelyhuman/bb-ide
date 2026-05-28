// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Environment, Thread } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspacePathRow } from "./ThreadMetadataContent";

type ThreadOverrides = Partial<Thread>;
type EnvironmentOverrides = Partial<Environment>;

function makeThread(overrides: ThreadOverrides = {}): Thread {
  const base: Thread = {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    automationId: null,
    providerId: "openai",
    type: "standard",
    title: "Test thread",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  return { ...base, ...overrides };
}

function makeEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  const base: Environment = {
    id: "env_test",
    projectId: "proj_test",
    hostId: "hst_test",
    path: "/Users/michael/Projects/bb",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature/projectless-threads",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
  };

  return { ...base, ...overrides };
}

afterEach(() => {
  cleanup();
});

describe("WorkspacePathRow", () => {
  it("keeps the worktree label for worktree environments", () => {
    render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          path: "/Users/michael/.bb-dev/worktrees/env_demo/bb",
        })}
      />,
    );

    expect(screen.getByText("Worktree path")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy worktree path" }).textContent,
    ).toBe("/Users/michael/.bb-dev/worktrees/env_demo/bb");
  });

  it("shows a workspace path for personal projectless environments", () => {
    render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          path: "/Users/michael/Projects/bb",
          workspaceProvisionType: "personal",
        })}
      />,
    );

    expect(screen.getByText("Workspace path")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy workspace path" }).textContent,
    ).toBe("/Users/michael/Projects/bb");
  });

  it("does not show a path for non-projectless direct workspaces", () => {
    const { container } = render(
      <WorkspacePathRow
        thread={makeThread()}
        environment={makeEnvironment({
          isWorktree: false,
          workspaceProvisionType: "unmanaged",
        })}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
