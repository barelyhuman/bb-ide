// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  Environment,
  PromptInput,
  Thread,
  WorkspaceStatus,
} from "@bb/domain";
import type { EnvironmentActionResponse } from "@bb/server-contract";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus as baseMakeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { HttpError } from "@/lib/api";
import {
  buildCommitFailureFollowUpInstruction,
  buildSquashMergeConflictFollowUpInstruction,
} from "@/lib/thread-operation-prompts";
import type {
  RequestEnvironmentActionMutationLike,
  SendMessageMutationLike,
} from "./threadDetailMutationTypes";
import { useThreadGitActions } from "./useThreadGitActions";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    success: vi.fn(),
  },
}));

interface ThreadOverrides extends Partial<Thread> {}

interface EnvironmentOverrides extends Partial<Environment> {}

interface WorkspaceStatusOptions {
  hasCommittedUnmergedChanges?: boolean;
  hasUncommittedChanges?: boolean;
}

interface RequestEnvironmentActionMutationOptions {
  isPending?: boolean;
  mutateAsync?: RequestEnvironmentActionMutationLike["mutateAsync"];
}

interface SendMessageMutationOptions {
  isPending?: boolean;
  mutateAsync?: SendMessageMutationLike["mutateAsync"];
}

function makeThread(overrides: ThreadOverrides = {}): Thread {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    projectId: "project-1",
    providerId: "provider-1",
    stopRequestedAt: null,
    status: "idle",
    title: "Thread title",
    titleFallback: "Thread title",
    type: "standard",
    updatedAt: 10,
    ...overrides,
  };
}

function makeEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return {
    branchName: "feature/test",
    cleanupMode: null,
    cleanupRequestedAt: null,
    createdAt: 1,
    defaultBranch: "main",
    hostId: "host-1",
    id: "environment-1",
    isGitRepo: true,
    isWorktree: true,
    managed: false,
    mergeBaseBranch: "main",
    path: "/tmp/worktree",
    projectId: "project-1",
    status: "ready",
    updatedAt: 1,
    workspaceProvisionType: "managed-worktree",
    ...overrides,
  };
}

function makeWorkspaceStatus(
  options: WorkspaceStatusOptions = {},
): WorkspaceStatus {
  return baseMakeWorkspaceStatus({
    branch: { currentBranch: "feature/test", defaultBranch: "main" },
    mergeBase: makeWorkspaceMergeBase({
      aheadCount: 1,
      baseRef: "origin/main",
      hasCommittedUnmergedChanges: options.hasCommittedUnmergedChanges ?? false,
    }),
    workingTree: makeWorkspaceWorkingTree({
      files: options.hasUncommittedChanges
        ? [{ path: "file.ts", status: "M" }]
        : [],
      hasUncommittedChanges: options.hasUncommittedChanges ?? false,
      insertions: 1,
      state: options.hasUncommittedChanges ? "dirty_uncommitted" : "clean",
    }),
  });
}

function makeCommitActionResponse(): EnvironmentActionResponse {
  return {
    action: "commit",
    commitSha: "abc123",
    commitSubject: "Commit subject",
    message: "Committed changes",
    ok: true,
  };
}

function makeSquashMergeActionResponse(): EnvironmentActionResponse {
  return {
    action: "squash_merge",
    commitSha: "def456",
    merged: true,
    message: "Squash merge completed",
    ok: true,
  };
}

function createRequestEnvironmentActionMutation(
  options: RequestEnvironmentActionMutationOptions = {},
): RequestEnvironmentActionMutationLike {
  return {
    isPending: options.isPending ?? false,
    mutateAsync:
      options.mutateAsync ?? vi.fn(async () => makeCommitActionResponse()),
  };
}

function createSendMessageMutation(
  options: SendMessageMutationOptions = {},
): SendMessageMutationLike {
  return {
    isPending: options.isPending ?? false,
    mutateAsync: options.mutateAsync ?? vi.fn(async () => undefined),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(toast.loading).mockReturnValue("toast-id");
});

function clickLatestErrorToastAction(): void {
  const errorToastOptions = vi.mocked(toast.error).mock.calls.at(-1)?.[1];
  if (
    !errorToastOptions?.action ||
    typeof errorToastOptions.action !== "object" ||
    !("onClick" in errorToastOptions.action) ||
    typeof errorToastOptions.action.onClick !== "function"
  ) {
    throw new Error("Expected an ask-agent toast action");
  }

  errorToastOptions.action.onClick(undefined as never);
}

describe("useThreadGitActions", () => {
  it("shows a commit action for direct thread environments with uncommitted changes", () => {
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: false,
        }),
        requestEnvironmentAction: createRequestEnvironmentActionMutation(),
        sendMessage: createSendMessageMutation(),
        thread: makeThread(),
        workspaceStatus: makeWorkspaceStatus({
          hasUncommittedChanges: true,
        }),
      }),
    );

    expect(result.current.threadHeaderGitActions).toEqual([
      {
        label: "Commit",
        target: { kind: "commit" },
      },
    ]);
  });

  it("shows squash merge for managed environments with committed changes", () => {
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: true,
        }),
        requestEnvironmentAction: createRequestEnvironmentActionMutation(),
        sendMessage: createSendMessageMutation(),
        thread: makeThread(),
        workspaceStatus: makeWorkspaceStatus({
          hasCommittedUnmergedChanges: true,
          hasUncommittedChanges: false,
        }),
      }),
    );

    expect(result.current.threadHeaderGitActions).toEqual([
      {
        label: "Squash merge",
        target: { kind: "squash_merge" },
      },
    ]);
  });

  it("shows commit and squash merge for managed environments with uncommitted changes", () => {
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: true,
        }),
        requestEnvironmentAction: createRequestEnvironmentActionMutation(),
        sendMessage: createSendMessageMutation(),
        thread: makeThread(),
        workspaceStatus: makeWorkspaceStatus({
          hasCommittedUnmergedChanges: true,
          hasUncommittedChanges: true,
        }),
      }),
    );

    expect(result.current.threadHeaderGitActions).toEqual([
      {
        label: "Commit",
        target: { kind: "commit" },
      },
      {
        label: "Squash merge",
        target: { kind: "commit_and_squash_merge" },
      },
    ]);
  });

  it("forwards commit requests to the environment mutation", async () => {
    const requestEnvironmentAction = createRequestEnvironmentActionMutation();
    const thread = makeThread({
      environmentId: "environment-commit",
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment(),
        requestEnvironmentAction,
        sendMessage: createSendMessageMutation(),
        thread,
        workspaceStatus: makeWorkspaceStatus(),
      }),
    );

    await act(async () => {
      await result.current.handleCommitThread();
    });

    expect(requestEnvironmentAction.mutateAsync).toHaveBeenCalledWith({
      action: "commit",
      id: "environment-commit",
    });
    expect(toast.loading).toHaveBeenCalledWith("Committing changes...");
    expect(toast.success).toHaveBeenCalledWith("Committed changes", {
      description: "Commit subject",
      id: "toast-id",
    });
  });

  it("forwards squash merge requests to the environment mutation", async () => {
    const requestEnvironmentAction = createRequestEnvironmentActionMutation({
      mutateAsync: vi.fn(async () => makeSquashMergeActionResponse()),
    });
    const thread = makeThread({
      environmentId: "environment-merge",
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: true,
        }),
        requestEnvironmentAction,
        sendMessage: createSendMessageMutation(),
        thread,
        workspaceStatus: makeWorkspaceStatus({
          hasCommittedUnmergedChanges: true,
        }),
      }),
    );

    await act(async () => {
      await result.current.handleSquashMergeThread({
        mergeBaseBranch: "main",
      });
    });

    expect(requestEnvironmentAction.mutateAsync).toHaveBeenCalledWith({
      action: "squash_merge",
      id: "environment-merge",
      options: {
        mergeBaseBranch: "main",
      },
    });
    expect(toast.loading).toHaveBeenCalledWith("Squash merge in progress...");
    expect(toast.success).toHaveBeenCalledWith("Squash merge completed", {
      id: "toast-id",
    });
  });

  it("maps squash-merge conflicts into an error toast with ask-agent guidance", async () => {
    const thread = makeThread({
      environmentId: "environment-merge",
    });
    const mergeBaseBranch = "main";
    const conflictError = new HttpError({
      body: {
        details: {
          conflictFiles: ["src/thread.ts"],
          kind: "squash_merge_conflict",
        },
      },
      message: "Squash merge failed",
      status: 409,
    });
    const requestEnvironmentAction = createRequestEnvironmentActionMutation({
      mutateAsync: vi.fn(async () => {
        throw conflictError;
      }),
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: true,
        }),
        requestEnvironmentAction,
        sendMessage: createSendMessageMutation(),
        thread,
        workspaceStatus: makeWorkspaceStatus({
          hasCommittedUnmergedChanges: true,
        }),
      }),
    );

    await act(async () => {
      await result.current.handleSquashMergeThread({
        mergeBaseBranch,
      });
    });

    expect(toast.loading).toHaveBeenCalledWith("Squash merge in progress...");
    expect(toast.error).toHaveBeenCalledWith(
      "Squash merge failed",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Ask agent to fix",
          onClick: expect.any(Function),
        }),
        id: "toast-id",
      }),
    );
  });

  it("maps commit failures into an error toast with ask-agent guidance", async () => {
    const thread = makeThread({
      environmentId: "environment-commit-failure",
    });
    const commitError = new HttpError({
      body: {
        details: {
          errorMessage: "Git commit exited with status 1",
          kind: "commit_failed",
        },
      },
      message: "Commit failed",
      status: 409,
    });
    const requestEnvironmentAction = createRequestEnvironmentActionMutation({
      mutateAsync: vi.fn(async () => {
        throw commitError;
      }),
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment(),
        requestEnvironmentAction,
        sendMessage: createSendMessageMutation(),
        thread,
        workspaceStatus: makeWorkspaceStatus({
          hasUncommittedChanges: true,
        }),
      }),
    );

    await act(async () => {
      await result.current.handleCommitThread();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Commit failed",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Ask agent to fix",
          onClick: expect.any(Function),
        }),
        id: "toast-id",
      }),
    );
  });

  it("asks the agent with generated squash-merge conflict guidance from the error toast action", async () => {
    const thread = makeThread({
      environmentId: "environment-merge",
    });
    const mergeBaseBranch = "main";
    const conflictError = new HttpError({
      body: {
        details: {
          conflictFiles: ["src/thread.ts"],
          kind: "squash_merge_conflict",
        },
      },
      message: "Squash merge failed",
      status: 409,
    });
    const requestEnvironmentAction = createRequestEnvironmentActionMutation({
      mutateAsync: vi.fn(async () => {
        throw conflictError;
      }),
    });
    const sendMessage = createSendMessageMutation();
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment({
          managed: true,
        }),
        requestEnvironmentAction,
        sendMessage,
        thread,
        workspaceStatus: makeWorkspaceStatus({
          hasCommittedUnmergedChanges: true,
        }),
      }),
    );

    await act(async () => {
      await result.current.handleSquashMergeThread({
        mergeBaseBranch,
      });
    });

    act(() => {
      clickLatestErrorToastAction();
    });

    await waitFor(() => {
      expect(sendMessage.mutateAsync).toHaveBeenCalledWith({
        id: thread.id,
        input: [
          {
            text: buildSquashMergeConflictFollowUpInstruction(
              {
                action: "squash_merge",
                options: {
                  mergeBaseBranch,
                },
              },
              {
                conflictFiles: ["src/thread.ts"],
              },
            ),
            type: "text",
          },
        ],
        mode: "auto",
      });
    });
  });

  it("asks the agent with generated commit failure guidance from the error toast action", async () => {
    const thread = makeThread({
      environmentId: "environment-commit-failure",
    });
    const commitError = new HttpError({
      body: {
        details: {
          errorMessage: "Git commit exited with status 1",
          kind: "commit_failed",
        },
      },
      message: "Commit failed",
      status: 409,
    });
    const requestEnvironmentAction = createRequestEnvironmentActionMutation({
      mutateAsync: vi.fn(async () => {
        throw commitError;
      }),
    });
    const sendMessage = createSendMessageMutation();
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment(),
        requestEnvironmentAction,
        sendMessage,
        thread,
        workspaceStatus: makeWorkspaceStatus({
          hasUncommittedChanges: true,
        }),
      }),
    );

    await act(async () => {
      await result.current.handleCommitThread();
    });

    act(() => {
      clickLatestErrorToastAction();
    });

    await waitFor(() => {
      expect(sendMessage.mutateAsync).toHaveBeenCalledWith({
        id: thread.id,
        input: [
          {
            text: buildCommitFailureFollowUpInstruction({
              errorMessage: "Git commit exited with status 1",
            }),
            type: "text",
          },
        ],
        mode: "auto",
      });
    });
  });

  it("sends ask-agent follow-up messages through the thread mutation", async () => {
    const input: PromptInput[] = [
      {
        text: "Resolve the merge conflict and continue.",
        type: "text",
      },
    ];
    const sendMessage = createSendMessageMutation();
    const thread = makeThread({
      id: "thread-follow-up",
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment(),
        requestEnvironmentAction: createRequestEnvironmentActionMutation(),
        sendMessage,
        thread,
        workspaceStatus: makeWorkspaceStatus(),
      }),
    );

    await act(async () => {
      await result.current.handleAskAgentToFixGitAction({
        input,
        threadId: thread.id,
      });
    });

    expect(sendMessage.mutateAsync).toHaveBeenCalledWith({
      id: thread.id,
      input,
      mode: "auto",
    });
    expect(toast.loading).toHaveBeenCalledWith(
      "Asking the agent to fix this...",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Asked the agent to fix this.",
      {
        id: "toast-id",
      },
    );
  });

  it("updates the ask-agent toast when the follow-up message fails", async () => {
    const input: PromptInput[] = [
      {
        text: "Resolve the merge conflict and continue.",
        type: "text",
      },
    ];
    const sendMessage = createSendMessageMutation({
      mutateAsync: vi.fn(async () => {
        throw new Error("Queue unavailable");
      }),
    });
    const thread = makeThread({
      id: "thread-follow-up-failure",
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        environment: makeEnvironment(),
        requestEnvironmentAction: createRequestEnvironmentActionMutation(),
        sendMessage,
        thread,
        workspaceStatus: makeWorkspaceStatus(),
      }),
    );

    await act(async () => {
      await result.current.handleAskAgentToFixGitAction({
        input,
        threadId: thread.id,
      });
    });

    expect(sendMessage.mutateAsync).toHaveBeenCalledWith({
      id: thread.id,
      input,
      mode: "auto",
    });
    expect(toast.loading).toHaveBeenCalledWith(
      "Asking the agent to fix this...",
    );
    expect(toast.error).toHaveBeenCalledWith("Queue unavailable", {
      id: "toast-id",
    });
  });
});
