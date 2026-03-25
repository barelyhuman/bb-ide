import type { AgentRuntime } from "@bb/agent-runtime";
import type { IWorkspace } from "@bb/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandRouter } from "./command-router.js";
import { RuntimeManager } from "./runtime-manager.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createFakeWorkspace(path: string) {
  return {
    path,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    currentBranch: vi.fn(async () => "main"),
    getStatus: vi.fn(async () => ({
      state: "clean" as const,
      changedFiles: 0,
      insertions: 0,
      deletions: 0,
      workspaceChangedFiles: 0,
      workspaceInsertions: 0,
      workspaceDeletions: 0,
      hasUncommittedChanges: false,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
      behindCount: 0,
      currentBranch: "main",
      defaultBranch: "main",
      mergeBaseBranch: "main",
      mergeBaseBranches: [],
      baseRef: "main",
      files: [],
    })),
    getDiff: vi.fn(async () => ({
      mode: "combined",
      currentBranch: "main",
      mergeBaseBranch: "main",
      mergeBaseRef: "main",
      commits: [],
      selection: { type: "combined" as const },
      diff: "",
      truncated: false,
    })),
    getBranches: vi.fn(async () => ["main"]),
    commit: vi.fn(async () => ({
      commitSha: "commit-1",
      commitSubject: "subject",
    })),
    reset: vi.fn(async () => undefined),
    fetch: vi.fn(async () => undefined),
    checkpoint: vi.fn(async () => ({
      commitSha: "commit-2",
      branchName: "main",
      remoteName: "origin",
    })),
    squashMergeInto: vi.fn(async () => ({
      merged: true,
      commitSha: "commit-3",
      targetBranch: "main",
    })),
    promote: vi.fn(async () => undefined),
    demote: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  } as unknown as IWorkspace & {
    commit: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getDiff: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    checkpoint: ReturnType<typeof vi.fn>;
    squashMergeInto: ReturnType<typeof vi.fn>;
    promote: ReturnType<typeof vi.fn>;
    demote: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
}

function createFakeRuntime() {
  return {
    ensureProvider: vi.fn(async () => undefined),
    startThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
      providerThreadId: `provider-${threadId}`,
    })),
    resumeThread: vi.fn(async ({ providerThreadId }: { providerThreadId?: string }) => ({
      providerThreadId,
    })),
    runTurn: vi.fn(async (_args: { threadId: string }) => undefined),
    steerTurn: vi.fn(async (_args: unknown) => undefined),
    stopThread: vi.fn(async (_args: unknown) => undefined),
    renameThread: vi.fn(async (_args: unknown) => undefined),
    listModels: vi.fn(async () => []),
    shutdown: vi.fn(async () => undefined),
  };
}

describe("CommandRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches thread commands to the runtime", async () => {
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => createFakeWorkspace("/tmp/env-1")),
      createRuntime: vi.fn(() => runtime as unknown as AgentRuntime),
    });
    const router = new CommandRouter({ runtimeManager: manager });

    await router.handleCommands([
      {
        id: "cmd-start",
        cursor: 1,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          workspacePath: "/tmp/env-1",
          projectId: "project-1",
          providerId: "fake",
        },
      },
      {
        id: "cmd-stop",
        cursor: 2,
        command: {
          type: "thread.stop",
          environmentId: "env-1",
          threadId: "thread-1",
        },
      },
      {
        id: "cmd-rename",
        cursor: 3,
        command: {
          type: "thread.rename",
          environmentId: "env-1",
          threadId: "thread-1",
          title: "Renamed thread",
        },
      },
    ]);

    expect(runtime.startThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      projectId: "project-1",
      providerId: "fake",
      input: undefined,
      options: undefined,
      dynamicTools: undefined,
    });
    expect(runtime.stopThread).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(runtime.renameThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      title: "Renamed thread",
    });
    expect(manager.listActiveThreads()).toEqual([]);
  });

  it("dispatches workspace commands to the workspace instance", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => workspace),
      createRuntime: vi.fn(
        () => createFakeRuntime() as unknown as AgentRuntime,
      ),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const listModels = vi.fn(async () => []);
    const router = new CommandRouter({
      runtimeManager: manager,
      listModels,
    });

    await router.handleCommands([
      {
        id: "status",
        cursor: 1,
        command: {
          type: "workspace.status",
          environmentId: "env-1",
          threadId: "thread-1",
        },
      },
      {
        id: "diff",
        cursor: 2,
        command: {
          type: "workspace.diff",
          environmentId: "env-1",
          threadId: "thread-1",
        },
      },
      {
        id: "commit",
        cursor: 3,
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          threadId: "thread-1",
          message: "Commit message",
        },
      },
      {
        id: "reset",
        cursor: 4,
        command: {
          type: "workspace.reset",
          environmentId: "env-1",
          threadId: "thread-1",
        },
      },
      {
        id: "checkpoint",
        cursor: 5,
        command: {
          type: "workspace.checkpoint",
          environmentId: "env-1",
          threadId: "thread-1",
          commitMessage: "Checkpoint",
        },
      },
      {
        id: "squash",
        cursor: 6,
        command: {
          type: "workspace.squash_merge",
          environmentId: "env-1",
          threadId: "thread-1",
          targetBranch: "main",
          commitMessage: "Squash",
        },
      },
      {
        id: "promote",
        cursor: 7,
        command: {
          type: "workspace.promote",
          environmentId: "env-1",
          threadId: "thread-1",
          primaryPath: "/tmp/primary",
        },
      },
      {
        id: "demote",
        cursor: 8,
        command: {
          type: "workspace.demote",
          environmentId: "env-1",
          threadId: "thread-1",
          primaryPath: "/tmp/primary",
          defaultBranch: "main",
          envBranch: "feature",
        },
      },
      {
        id: "models",
        cursor: 9,
        command: {
          type: "provider.list_models",
          providerId: "fake",
        },
      },
    ]);

    expect(workspace.getStatus).toHaveBeenCalledTimes(1);
    expect(workspace.getDiff).toHaveBeenCalledTimes(1);
    expect(workspace.commit).toHaveBeenCalledWith({
      message: "Commit message",
      includeUnstaged: undefined,
    });
    expect(workspace.reset).toHaveBeenCalledTimes(1);
    expect(workspace.checkpoint).toHaveBeenCalledTimes(1);
    expect(workspace.squashMergeInto).toHaveBeenCalledTimes(1);
    expect(workspace.promote).toHaveBeenCalledTimes(1);
    expect(workspace.demote).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledWith("fake");
  });

  it("errors when a command needs an unknown environment with no workspace path", async () => {
    const results: Array<Record<string, unknown>> = [];
    const router = new CommandRouter({
      runtimeManager: new RuntimeManager({
        provisionWorkspace: vi.fn(async () => createFakeWorkspace("/tmp/env-1")),
        createRuntime: vi.fn(
          () => createFakeRuntime() as unknown as AgentRuntime,
        ),
      }),
      reportResult: async (result) => {
        results.push(result as unknown as Record<string, unknown>);
      },
    });

    await router.handleCommands([
      {
        id: "missing",
        cursor: 1,
        command: {
          type: "workspace.status",
          environmentId: "env-missing",
          threadId: "thread-1",
        },
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        ok: false,
        errorCode: "unknown_environment",
      }),
    ]);
  });

  it("serializes workspace commands per environment", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const commitDeferred = createDeferred<{ commitSha: string; commitSubject: string }>();
    workspace.commit.mockReturnValueOnce(commitDeferred.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => workspace),
      createRuntime: vi.fn(
        () => createFakeRuntime() as unknown as AgentRuntime,
      ),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        id: "commit",
        cursor: 1,
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          threadId: "thread-1",
          message: "Commit",
        },
      },
      {
        id: "reset",
        cursor: 2,
        command: {
          type: "workspace.reset",
          environmentId: "env-1",
          threadId: "thread-1",
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });
    expect(workspace.reset).not.toHaveBeenCalled();

    commitDeferred.resolve({
      commitSha: "commit-1",
      commitSubject: "subject",
    });
    await handling;

    expect(workspace.reset).toHaveBeenCalledTimes(1);
  });

  it("runs provider commands for different threads concurrently", async () => {
    const runtime = createFakeRuntime();
    const threadA = createDeferred<undefined>();
    const threadB = createDeferred<undefined>();
    runtime.runTurn.mockImplementation(({ threadId }: { threadId: string }) => {
      return threadId === "thread-a" ? threadA.promise : threadB.promise;
    });

    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => createFakeWorkspace("/tmp/env-1")),
      createRuntime: vi.fn(() => runtime as unknown as AgentRuntime),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.markThreadActive("env-1", "thread-a");
    manager.markThreadActive("env-1", "thread-b");

    const router = new CommandRouter({ runtimeManager: manager });
    const handling = router.handleCommands([
      {
        id: "run-a",
        cursor: 1,
        command: {
          type: "turn.run",
          environmentId: "env-1",
          threadId: "thread-a",
          input: [{ type: "text", text: "A" }],
        },
      },
      {
        id: "run-b",
        cursor: 2,
        command: {
          type: "turn.run",
          environmentId: "env-1",
          threadId: "thread-b",
          input: [{ type: "text", text: "B" }],
        },
      },
    ]);

    await Promise.resolve();
    expect(runtime.runTurn).toHaveBeenCalledTimes(2);

    threadA.resolve(undefined);
    threadB.resolve(undefined);
    await handling;
  });

  it("reports completed commands in contiguous cursor order", async () => {
    const runtime = createFakeRuntime();
    const threadOne = createDeferred<{ providerThreadId: string }>();
    const threadTwo = createDeferred<{ providerThreadId: string }>();
    const threadThree = createDeferred<{ providerThreadId: string }>();
    runtime.startThread
      .mockReturnValueOnce(threadOne.promise)
      .mockReturnValueOnce(threadTwo.promise)
      .mockReturnValueOnce(threadThree.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => createFakeWorkspace("/tmp/env-1")),
      createRuntime: vi.fn(() => runtime as unknown as AgentRuntime),
    });
    const reported: number[] = [];
    const router = new CommandRouter({
      runtimeManager: manager,
      reportResult: async (result) => {
        reported.push(result.cursor);
      },
      initialCursor: 4,
    });

    const handling = router.handleCommands([
      {
        id: "cmd-5",
        cursor: 5,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          workspacePath: "/tmp/env-1",
          projectId: "project-1",
          providerId: "fake",
        },
      },
      {
        id: "cmd-6",
        cursor: 6,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          workspacePath: "/tmp/env-1",
          projectId: "project-1",
          providerId: "fake",
        },
      },
      {
        id: "cmd-7",
        cursor: 7,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-3",
          workspacePath: "/tmp/env-1",
          projectId: "project-1",
          providerId: "fake",
        },
      },
    ]);

    threadThree.resolve({ providerThreadId: "provider-3" });
    await Promise.resolve();
    expect(reported).toEqual([]);

    threadOne.resolve({ providerThreadId: "provider-1" });
    await Promise.resolve();
    expect(reported).toEqual([]);

    threadTwo.resolve({ providerThreadId: "provider-2" });
    await handling;
    expect(reported).toEqual([5, 6, 7]);
  });

  it("lazily creates and resumes a runtime for turn.run when no thread session exists", async () => {
    const runtime = createFakeRuntime();
    const provisionWorkspace = vi.fn(async () => createFakeWorkspace("/tmp/env-lazy"));
    const manager = new RuntimeManager({
      provisionWorkspace,
      createRuntime: vi.fn(() => runtime as unknown as AgentRuntime),
    });
    const router = new CommandRouter({
      runtimeManager: manager,
      resolveThreadRuntime: async () => ({
        workspacePath: "/tmp/env-lazy",
        projectId: "project-1",
        providerId: "fake",
        providerThreadId: "provider-1",
      }),
    });

    await router.handleCommands([
      {
        id: "turn-run",
        cursor: 1,
        command: {
          type: "turn.run",
          environmentId: "env-lazy",
          threadId: "thread-1",
          input: [{ type: "text", text: "hello" }],
        },
      },
    ]);

    expect(provisionWorkspace).toHaveBeenCalledWith({
      workspaceProvisionType: "unmanaged",
      path: "/tmp/env-lazy",
    });
    expect(runtime.resumeThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      projectId: "project-1",
      providerThreadId: "provider-1",
      providerId: "fake",
      options: undefined,
      resumePath: "/tmp/env-lazy",
      dynamicTools: undefined,
    });
    expect(runtime.runTurn).toHaveBeenCalledWith({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
      options: undefined,
    });
  });

  it("destroys the runtime and workspace for environment.destroy", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: vi.fn(async () => workspace),
      createRuntime: vi.fn(() => runtime as unknown as AgentRuntime),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({ runtimeManager: manager });

    await router.handleCommands([
      {
        id: "destroy",
        cursor: 1,
        command: {
          type: "environment.destroy",
          environmentId: "env-1",
          path: "/tmp/env-1",
          workspaceProvisionType: "managed-worktree",
        },
      },
    ]);

    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(workspace.destroy).toHaveBeenCalledTimes(1);
  });
});
