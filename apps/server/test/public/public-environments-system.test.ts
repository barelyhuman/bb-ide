import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEnvironment, hostDaemonCommands, updateHost } from "@bb/db";
import type { ProviderCapabilities, ProviderInfo } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadErrorCode } from "@bb/server-contract";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_DIFF_MAX_DIFF_BYTES,
  WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
} from "../../src/constants.js";
import {
  internalAuthHeaders,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

interface MakeSystemProviderArgs {
  id: string;
  displayName: string;
  capabilities?: Partial<ProviderCapabilities>;
}

interface ProviderModelLookupFailureCase {
  providerId: string;
  errorCode: string;
  errorMessage: string;
  expectedCode: SystemExecutionOptionsModelLoadErrorCode;
  name: string;
}

type TestAppHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: false,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const PROVIDER_MODEL_LOOKUP_FAILURE_CASES: ProviderModelLookupFailureCase[] = [
  {
    providerId: "codex",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /usr/local/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex ENOENT',
    expectedCode: "missing_executable",
    name: "Codex missing executable",
  },
  {
    providerId: "claude-code",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "claude-code" exited unexpectedly\nstderr: Error: spawn /usr/local/bin/claude ENOENT',
    expectedCode: "missing_executable",
    name: "Claude Code missing executable",
  },
  {
    providerId: "pi",
    errorCode: "missing_executable",
    errorMessage:
      'Provider "pi" exited unexpectedly\nstderr: Error: spawn /Applications/bb.app/Contents/Resources/bb-pi-bridge.mjs ENOENT',
    expectedCode: "missing_executable",
    name: "Pi missing executable",
  },
  {
    providerId: "codex",
    errorCode: "command_timeout",
    errorMessage: "Timed out waiting for command result",
    expectedCode: "timeout",
    name: "command timeout",
  },
  {
    providerId: "codex",
    errorCode: "provider_rpc_error",
    errorMessage: "Provider failed",
    expectedCode: "failed",
    name: "generic provider failure",
  },
  {
    providerId: "codex",
    errorCode: "provider_rpc_error",
    errorMessage:
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /usr/local/bin/codex ENOENT',
    expectedCode: "failed",
    name: "ENOENT-looking message with generic error code",
  },
];

function makeSystemProvider(args: MakeSystemProviderArgs): ProviderInfo {
  return {
    id: args.id,
    displayName: args.displayName,
    capabilities: {
      ...DEFAULT_PROVIDER_CAPABILITIES,
      ...(args.capabilities ?? {}),
    },
    available: true,
  };
}

async function reportLocalSquashMergeTarget(
  harness: TestAppHarness,
  targetBranch: string,
): Promise<void> {
  const targetCommand = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "host.list_branches" &&
      command.selectedBranch === targetBranch,
  );
  expect(targetCommand.command).toMatchObject({
    selectedBranch: targetBranch,
    limit: 1,
  });
  await reportQueuedCommandSuccess(harness, targetCommand, {
    branches: [targetBranch],
    branchesTruncated: false,
    checkout: {
      kind: "branch",
      branchName: "bb/feature",
      headSha: "abc123",
    },
    defaultBranch: "main",
    hasUncommittedChanges: false,
    operation: { kind: "none" },
    remoteBranches: [],
    remoteBranchesTruncated: false,
    selectedBranch: { name: targetBranch, kind: "local" },
  });
}

describe("public environment and system routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows status without a merge-base branch and rejects branch-relative diff without one", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-merge-base-required",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-merge-base-required/worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/merge-base",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).not.toHaveProperty("mergeBaseBranch");
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/merge-base",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      const statusResponse = await statusPromise;
      expect(statusResponse.status).toBe(200);
      await expect(readJson(statusResponse)).resolves.toMatchObject({
        workspace: {
          mergeBase: null,
        },
      });

      const diffResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}/diff?target=all`,
      );
      expect(diffResponse.status).toBe(400);
      await expect(readJson(diffResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "A merge base branch is required",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns null status for non-git environments without queuing a git probe", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-non-git",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/environment-non-git/workspace",
        status: "ready",
        managed: false,
        isGitRepo: false,
        isWorktree: false,
        workspaceProvisionType: "unmanaged",
        branchName: null,
        defaultBranch: null,
        mergeBaseBranch: null,
      });
      const commandCountBefore = harness.db
        .select({ id: hostDaemonCommands.id })
        .from(hostDaemonCommands)
        .all().length;

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ workspace: null });

      const commandCountAfter = harness.db
        .select({ id: hostDaemonCommands.id })
        .from(hostDaemonCommands)
        .all().length;
      expect(commandCountAfter).toBe(commandCountBefore);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns environment details and queues status, diff, and branch queries", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-details",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-details/worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/details",
      });

      const getResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
      );
      expect(getResponse.status).toBe(200);
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: environment.id,
        projectId: project.id,
        branchName: "bb/details",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status?mergeBaseBranch=main`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/environment-details/worktree",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      });
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: makeWorkspaceStatus({
          workingTree: makeWorkspaceWorkingTree({
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 5,
            deletions: 1,
          }),
          branch: { currentBranch: "bb/details", defaultBranch: "main" },
          mergeBase: makeWorkspaceMergeBase({
            baseRef: "origin/main",
            aheadCount: 1,
            hasCommittedUnmergedChanges: true,
          }),
        }),
      });
      const statusResponse = await statusPromise;
      expect(statusResponse.status).toBe(200);
      await expect(readJson(statusResponse)).resolves.toEqual({
        workspace: expect.objectContaining({
          workingTree: expect.objectContaining({
            state: "dirty_uncommitted",
          }),
          branch: expect.objectContaining({
            currentBranch: "bb/details",
          }),
        }),
      });

      const diffPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff?target=all&mergeBaseBranch=main`,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        maxDiffBytes: WORKSPACE_DIFF_MAX_DIFF_BYTES,
        maxFileListBytes: WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
        workspaceContext: {
          workspacePath: "/tmp/environment-details/worktree",
          workspaceProvisionType: "managed-worktree",
        },
        target: { type: "all", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });
      const diffResponse = await diffPromise;
      expect(diffResponse.status).toBe(200);
      await expect(readJson(diffResponse)).resolves.toEqual({
        diff: "diff --git a/file.ts b/file.ts",
        truncated: false,
        shortstat: " 1 file changed, 1 insertion(+)\n",
        files: "M\tfile.ts\n",
        mergeBaseRef: "abc1234",
      });

      const branchesPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/branches?selectedBranch=origin%2Fmain`,
      );
      const branchesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_branches" &&
          command.path === "/tmp/environment-details/worktree",
      );
      expect(branchesCommand.command).toMatchObject({
        path: "/tmp/environment-details/worktree",
        selectedBranch: "origin/main",
        limit: 50,
      });
      await reportQueuedCommandSuccess(harness, branchesCommand, {
        branches: ["main", "bb/details"],
        branchesTruncated: false,
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "bb/details",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: false,
        operation: { kind: "none" },
        selectedBranch: { name: "origin/main", kind: "remote" },
      });
      const branchesResponse = await branchesPromise;
      expect(branchesResponse.status).toBe(200);
      await expect(readJson(branchesResponse)).resolves.toEqual({
        branches: ["main", "bb/details"],
        branchesTruncated: false,
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        selectedBranch: { name: "origin/main", kind: "remote" },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("updates an environment merge base branch", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/environment-update",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/environment-update/worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mergeBaseBranch: "release" }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: environment.id,
        mergeBaseBranch: "release",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("queues workspace.commit after checking status and diff, then returns the reported commit info", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "commit",
          }),
        },
      );

      // Step 1: Server queries workspace status
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 1,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      // Step 2: Server queries diff for AI commit message generation
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        maxDiffBytes: 32_000,
        maxFileListBytes: 4_000,
        target: { type: "uncommitted" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: null,
        },
      });

      // Step 3: Server queues commit (AI message generation may fall back)
      const commitCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.commit" &&
          command.environmentId === environment.id,
      );
      expect(commitCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/test-environment",
          workspaceProvisionType: "unmanaged",
        },
        message: "bb: automated commit",
      });
      await reportQueuedCommandSuccess(harness, commitCommand, {
        commitSha: "abc123",
        commitSubject: "bb: automated commit",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "commit",
        commitSha: "abc123",
        commitSubject: "bb: automated commit",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("queues workspace.squash_merge after checking status and diff, then returns the merge result", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "squash_merge",
            options: {
              mergeBaseBranch: "main",
            },
          }),
        },
      );

      // Step 1: Server queries workspace status
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      // Step 2: Server queries branch_committed diff
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        target: { type: "branch_committed", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      // Step 3: Server queues squash_merge with generated message
      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        workspaceContext: {
          workspacePath: "/tmp/test-environment",
          workspaceProvisionType: "managed-worktree",
        },
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("uses fallback squash commit message when Codex inference fails", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    });
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "squash_merge",
            options: {
              mergeBaseBranch: "main",
            },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 1 insertion(+)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      const inferenceCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      await reportQueuedCommandError(harness, inferenceCommand, {
        errorCode: "codex_auth_missing",
        errorMessage: "Codex auth file not found",
      });

      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "merge123",
        commitSubject: "bb: squash merge",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects squash merge with 409 when workspace is in detached HEAD state", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: false,
            state: "clean",
            insertions: 0,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: null,
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects squash merge into a remote-only target before commit or diff", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "origin/main" },
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 1,
            deletions: 0,
            files: [],
          },
          branch: {
            currentBranch: "bb/feature",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });

      const targetCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_branches" &&
          command.selectedBranch === "origin/main",
      );
      await reportQueuedCommandSuccess(harness, targetCommand, {
        branches: ["main"],
        branchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "bb/feature",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: true,
        operation: { kind: "none" },
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        selectedBranch: { name: "origin/main", kind: "remote" },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects commit with 409 when workspace has no uncommitted changes", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "commit",
          }),
        },
      );

      // Status and diff are fired in parallel; respond to both
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await Promise.all([
        reportQueuedCommandSuccess(harness, statusCommand, {
          workspaceStatus: {
            workingTree: {
              hasUncommittedChanges: false,
              state: "clean",
              insertions: 0,
              deletions: 0,
              files: [],
            },
            branch: {
              currentBranch: "feature",
              defaultBranch: "main",
            },
            mergeBase: null,
          },
        }),
        reportQueuedCommandSuccess(harness, diffCommand, {
          diff: {
            diff: "",
            truncated: false,
            shortstat: "",
            files: "",
            mergeBaseRef: null,
          },
        }),
      ]);

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "no_changes",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("auto-commits dirty workspace before squash merge", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );

      // Step 1: Status reports dirty workspace
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        workspaceStatus: {
          workingTree: {
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
            insertions: 5,
            deletions: 1,
            files: [],
          },
          branch: {
            currentBranch: "bb/dirty-merge",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      });
      await reportLocalSquashMergeTarget(harness, "main");

      // Step 2: Server issues pre-merge commit
      const preCommitCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.commit" &&
          command.environmentId === environment.id,
      );
      expect(preCommitCommand.command).toMatchObject({
        message: "bb: pre-merge commit",
      });
      await reportQueuedCommandSuccess(harness, preCommitCommand, {
        commitSha: "pre-merge-sha",
        commitSubject: "bb: pre-merge commit",
      });

      // Step 3: Diff for AI message
      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        target: { type: "branch_committed", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        diff: {
          diff: "diff --git a/file.ts b/file.ts",
          truncated: false,
          shortstat: " 1 file changed, 5 insertions(+), 1 deletion(-)\n",
          files: "M\tfile.ts\n",
          mergeBaseRef: "abc1234",
        },
      });

      // Step 4: Final squash merge
      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.squash_merge" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        targetBranch: "main",
        commitMessage: "bb: squash merge",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {
        merged: true,
        commitSha: "squash-sha",
        commitSubject: "bb: squash merge",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "squash_merge",
        merged: true,
        commitSha: "squash-sha",
        commitSubject: "bb: squash merge",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns runtime config from GET /system/config", async () => {
    const harness = await createTestAppHarness({
      featureFlags: {
        askUserQuestion: true,
      },
      hostDaemonPort: 4010,
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    });
    try {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        featureFlags: {
          askUserQuestion: true,
          terminals: true,
        },
        hostDaemonPort: 4010,
        voiceTranscriptionEnabled: false,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("reports Codex voice transcription enabled when a persistent host is connected", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    });
    try {
      seedHostSession(harness.deps, {
        id: "host-voice-availability",
      });
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        voiceTranscriptionEnabled: true,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("reloads bb-app managed config from POST /system/config/reload", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "ambient-openai-key",
    });
    try {
      await writeFile(
        join(harness.config.dataDir, "env.json"),
        `${JSON.stringify({ env: { OPENAI_API_KEY: "stored-openai-key" } })}\n`,
        "utf8",
      );

      const response = await harness.app.request(
        "/api/v1/system/config/reload",
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(harness.config.openAiApiKey).toBe("stored-openai-key");
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects invalid bb-app managed config reloads without changing runtime config", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "openai/gpt-4o-mini",
    });
    try {
      await writeFile(
        join(harness.config.dataDir, "config.json"),
        `${JSON.stringify({ config: { BB_INFERENCE: "gpt-4o-mini" } })}\n`,
        "utf8",
      );

      const response = await harness.app.request(
        "/api/v1/system/config/reload",
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(422);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_config",
      });
      expect(harness.config.inferenceModel).toBe("openai/gpt-4o-mini");
    } finally {
      await harness.cleanup();
    }
  });

  it("returns ok from GET /health", async () => {
    const harness = await createTestAppHarness();
    try {
      const response = await harness.app.request("/health");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
    } finally {
      await harness.cleanup();
    }
  });

  it("queues provider list and provider list_models commands for system routes", async () => {
    const harness = await createTestAppHarness({
      featureFlags: {
        askUserQuestion: false,
      },
    });
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-system-routes",
      });

      const providersPromise = harness.app.request(
        `/api/v1/system/providers?hostId=${host.id}`,
      );
      const providersCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.list",
      );
      await reportQueuedCommandSuccess(harness, providersCommand, {
        providers: [
          {
            id: "codex",
            displayName: "Codex",
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: false,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
            available: true,
          },
        ],
      });
      const providersResponse = await providersPromise;
      expect(providersResponse.status).toBe(200);
      await expect(readJson(providersResponse)).resolves.toEqual([
        {
          id: "codex",
          displayName: "Codex",
          capabilities: {
            supportsArchive: true,
            supportsRename: true,
            supportsServiceTier: true,
            supportsUserQuestion: false,
            supportedPermissionModes: ["full", "workspace-write", "readonly"],
          },
          available: true,
        },
      ]);

      const executionOptionsPromise = harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=codex`,
      );
      const executionProvidersCommand = await waitForQueuedCommandAfter(
        harness,
        providersCommand.row.cursor,
        ({ command }) => command.type === "provider.list",
      );
      await reportQueuedCommandSuccess(harness, executionProvidersCommand, {
        providers: [
          {
            id: "codex",
            displayName: "Codex",
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: true,
              supportsUserQuestion: false,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
            available: true,
          },
          {
            id: "claude-code",
            displayName: "Claude Code",
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: false,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full"],
            },
            available: true,
          },
        ],
      });
      const executionModelsCommand = await waitForQueuedCommandAfter(
        harness,
        executionProvidersCommand.row.cursor,
        ({ command }) =>
          command.type === "provider.list_models" &&
          command.providerId === "codex",
      );
      await reportQueuedCommandSuccess(harness, executionModelsCommand, {
        models: [
          {
            id: "codex-mini",
            model: "gpt-4o-mini",
            displayName: "Codex Mini",
            description: "Fast codex model",
            supportedReasoningEfforts: [
              {
                reasoningEffort: "medium",
                description: "Balanced",
              },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
        selectedOnlyModels: [
          {
            id: "gpt-4o-mini-legacy",
            model: "gpt-4o-mini-legacy",
            displayName: "Legacy Mini",
            description: "Retired mini model retained for existing selections",
            supportedReasoningEfforts: [
              {
                reasoningEffort: "medium",
                description: "Balanced",
              },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      });
      const executionOptionsResponse = await executionOptionsPromise;
      expect(executionOptionsResponse.status).toBe(200);
      await expect(readJson(executionOptionsResponse)).resolves.toEqual({
        providers: [
          expect.objectContaining({
            id: "codex",
          }),
          expect.objectContaining({
            id: "claude-code",
            capabilities: expect.objectContaining({
              supportsUserQuestion: false,
            }),
          }),
        ],
        models: [
          expect.objectContaining({
            id: "codex-mini",
          }),
        ],
        selectedOnlyModels: [
          expect.objectContaining({
            id: "gpt-4o-mini-legacy",
          }),
        ],
        modelLoadError: null,
      });

      // A stale providerId falls back to the first provider in the list and
      // fetches that provider's models — the response still contains the full
      // providers list so the client can recover.
      const missingProviderOptionsPromise = harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=missing-provider`,
      );
      const missingProviderCommand = await waitForQueuedCommandAfter(
        harness,
        executionModelsCommand.row.cursor,
        ({ command }) => command.type === "provider.list",
      );
      await reportQueuedCommandSuccess(harness, missingProviderCommand, {
        providers: [
          {
            id: "claude-code",
            displayName: "Claude Code",
            capabilities: {
              supportsArchive: true,
              supportsRename: true,
              supportsServiceTier: false,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full"],
            },
            available: true,
          },
        ],
      });
      const missingProviderModelsCommand = await waitForQueuedCommandAfter(
        harness,
        missingProviderCommand.row.cursor,
        ({ command }) =>
          command.type === "provider.list_models" &&
          command.providerId === "claude-code",
      );
      await reportQueuedCommandSuccess(harness, missingProviderModelsCommand, {
        models: [],
        selectedOnlyModels: [],
      });
      const missingProviderOptionsResponse =
        await missingProviderOptionsPromise;
      expect(missingProviderOptionsResponse.status).toBe(200);
      await expect(readJson(missingProviderOptionsResponse)).resolves.toEqual({
        providers: [
          expect.objectContaining({
            id: "claude-code",
            capabilities: expect.objectContaining({
              supportsUserQuestion: false,
            }),
          }),
        ],
        models: [],
        selectedOnlyModels: [],
        modelLoadError: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it.each(PROVIDER_MODEL_LOOKUP_FAILURE_CASES)(
    "returns provider choices with a provider-specific error when model lookup fails: $name",
    async ({ errorCode, providerId, errorMessage, expectedCode }) => {
      const harness = await createTestAppHarness();
      try {
        const { host } = seedHostSession(harness.deps, {
          id: `host-system-${providerId}-models-fail`,
        });

        const executionOptionsPromise = harness.app.request(
          `/api/v1/system/execution-options?hostId=${host.id}&providerId=${providerId}`,
        );
        const providersCommand = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "provider.list",
        );
        await reportQueuedCommandSuccess(harness, providersCommand, {
          providers: [
            makeSystemProvider({
              id: "codex",
              displayName: "Codex",
              capabilities: {
                supportsArchive: true,
                supportsRename: true,
                supportsServiceTier: true,
              },
            }),
            makeSystemProvider({
              id: "claude-code",
              displayName: "Claude Code",
              capabilities: {
                supportsUserQuestion: true,
              },
            }),
            makeSystemProvider({
              id: "pi",
              displayName: "Pi",
              capabilities: {
                supportedPermissionModes: ["full"],
              },
            }),
          ],
        });
        const modelsCommand = await waitForQueuedCommandAfter(
          harness,
          providersCommand.row.cursor,
          ({ command }) =>
            command.type === "provider.list_models" &&
            command.providerId === providerId,
        );
        await reportQueuedCommandError(harness, modelsCommand, {
          errorCode,
          errorMessage,
        });

        const response = await executionOptionsPromise;
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toEqual({
          providers: [
            expect.objectContaining({
              id: "codex",
            }),
            expect.objectContaining({
              id: "claude-code",
            }),
            expect.objectContaining({
              id: "pi",
            }),
          ],
          models: [],
          selectedOnlyModels: [],
          modelLoadError: {
            providerId,
            code: expectedCode,
          },
        });
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("does not degrade non-502/504 model lookup failures into modelLoadError", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-system-models-type-mismatch",
      });

      const executionOptionsPromise = harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=codex`,
      );
      const providersCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.list",
      );
      await reportQueuedCommandSuccess(harness, providersCommand, {
        providers: [
          makeSystemProvider({
            id: "codex",
            displayName: "Codex",
          }),
        ],
      });
      const modelsCommand = await waitForQueuedCommandAfter(
        harness,
        providersCommand.row.cursor,
        ({ command }) =>
          command.type === "provider.list_models" &&
          command.providerId === "codex",
      );

      const commandResultResponse = await harness.app.request(
        "/internal/session/command-result",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: modelsCommand.row.sessionId,
            commandId: modelsCommand.row.id,
            completedAt: Date.now(),
            type: "provider.list",
            ok: true,
            result: {
              providers: [],
            },
          }),
        },
      );
      expect(commandResultResponse.status).toBe(200);

      const response = await executionOptionsPromise;
      expect(response.status).toBe(500);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "command_result_type_mismatch",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it.each([
    {
      askUserQuestion: false,
      expectedCapability: false,
      name: "masks user-question provider capability when the flag is disabled",
    },
    {
      askUserQuestion: true,
      expectedCapability: true,
      name: "preserves user-question provider capability when the flag is enabled",
    },
  ])("$name", async ({ askUserQuestion, expectedCapability }) => {
    const harness = await createTestAppHarness({
      featureFlags: {
        askUserQuestion,
      },
    });
    try {
      const { host } = seedHostSession(harness.deps, {
        id: `host-system-provider-question-${askUserQuestion ? "enabled" : "disabled"}`,
      });

      const providersPromise = harness.app.request(
        `/api/v1/system/providers?hostId=${host.id}`,
      );
      const providersCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider.list",
      );
      await reportQueuedCommandSuccess(harness, providersCommand, {
        providers: [
          {
            id: "claude-code",
            displayName: "Claude Code",
            capabilities: {
              supportsArchive: false,
              supportsRename: false,
              supportsServiceTier: false,
              supportsUserQuestion: true,
              supportedPermissionModes: ["full", "workspace-write", "readonly"],
            },
            available: true,
          },
        ],
      });

      const providersResponse = await providersPromise;
      expect(providersResponse.status).toBe(200);
      await expect(readJson(providersResponse)).resolves.toEqual([
        {
          id: "claude-code",
          displayName: "Claude Code",
          capabilities: {
            supportsArchive: false,
            supportsRename: false,
            supportsServiceTier: false,
            supportsUserQuestion: expectedCapability,
            supportedPermissionModes: ["full", "workspace-write", "readonly"],
          },
          available: true,
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("uses a persistent host for default system provider lookups", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-system-default-persistent",
      });

      const providersPromise = harness.app.request("/api/v1/system/providers");
      const providersCommand = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "provider.list" &&
          queued.row.hostId === host.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        providersCommand,
        {
          providers: [
            {
              id: "codex",
              displayName: "Codex",
              capabilities: {
                supportsArchive: true,
                supportsRename: true,
                supportsServiceTier: true,
                supportsUserQuestion: false,
                supportedPermissionModes: [
                  "full",
                  "workspace-write",
                  "readonly",
                ],
              },
              available: true,
            },
          ],
        },
        { hostId: host.id },
      );

      expect((await providersPromise).status).toBe(200);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns 502 when no persistent host is connected for default system provider lookup", async () => {
    const harness = await createTestAppHarness();
    try {
      const response = await harness.app.request("/api/v1/system/providers");

      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_disconnected",
        message: "Persistent host is not connected",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects destroyed hosts for system host lookups", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-system-destroyed",
      });
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });

      const response = await harness.app.request(
        `/api/v1/system/providers?hostId=${host.id}`,
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects destroyed environment hosts for system execution-option lookups", async () => {
    const harness = await createTestAppHarness();
    try {
      const host = seedHost(harness.deps, {
        id: "host-system-env-destroyed",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });

      const response = await harness.app.request(
        `/api/v1/system/execution-options?environmentId=${environment.id}&providerId=codex`,
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "host_unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects invalid system query params with a 400", async () => {
    const harness = await createTestAppHarness();
    try {
      const response = await harness.app.request(
        "/api/v1/system/execution-options?providerId=",
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("uses the configured OpenAI voice transcription model when selected", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "transcribed text" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const harness = await createTestAppHarness({
      openAiApiKey: "provider-key",
      transcriptionModel: "openai/gpt-4o-transcribe",
    });
    try {
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );
      formData.set("prompt", "  Use repo vocabulary.  ");

      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        text: "transcribed text",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchCall = fetchMock.mock.calls[0];
      if (!fetchCall) {
        throw new Error("Expected fetch call");
      }
      expect(fetchCall[0]).toBe(
        "https://api.openai.com/v1/audio/transcriptions",
      );
      const init = fetchCall[1];
      expect(init?.headers).toEqual({
        authorization: "Bearer provider-key",
      });
      const body = init?.body;
      if (!(body instanceof FormData)) {
        throw new Error("Expected transcription request body to be FormData");
      }
      expect(body.get("model")).toBe("gpt-4o-transcribe");
      expect(body.get("prompt")).toBe("Use repo vocabulary.");
      const file = body.get("file");
      if (!(file instanceof File)) {
        throw new Error("Expected transcription request file");
      }
      expect(file.name).toBe("audio.wav");
    } finally {
      await harness.cleanup();
    }
  });

  it("queues Codex voice transcription through the persistent host", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    });
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-voice-transcription",
      });
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );
      formData.set("prompt", "  Use repo vocabulary.  ");

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      expect(command.command).toEqual({
        type: "codex.voice.transcribe",
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/wav",
        filename: "audio.wav",
        prompt: "Use repo vocabulary.",
        timeoutMs: 60_000,
      });
      await reportQueuedCommandSuccess(
        harness,
        command,
        {
          model: "gpt-4o-mini-transcribe",
          text: "transcribed through codex",
        },
        { hostId: host.id },
      );

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        text: "transcribed through codex",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("maps Codex voice transcription timeouts to a retryable API error", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    });
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-voice-transcription-timeout",
      });
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      await reportQueuedCommandError(
        harness,
        command,
        {
          errorCode: "codex_request_timeout",
          errorMessage: "Codex request timed out",
        },
        { hostId: host.id },
      );

      const response = await responsePromise;
      expect(response.status).toBe(504);
      await expect(readJson(response)).resolves.toEqual({
        code: "transcription_timeout",
        message: "Voice transcription timed out",
        retryable: true,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("surfaces Codex voice transcription auth failures", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "",
      transcriptionModel: "codex/gpt-4o-mini-transcribe",
    });
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-voice-transcription-auth-failure",
      });
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const responsePromise = harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "codex.voice.transcribe" &&
          queued.row.hostId === host.id,
      );
      await reportQueuedCommandError(
        harness,
        command,
        {
          errorCode: "codex_auth_missing",
          errorMessage: "Codex auth file not found",
        },
        { hostId: host.id },
      );

      const response = await responsePromise;
      expect(response.status).toBe(502);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "codex_auth_missing",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects OpenAI voice transcription requests when the API key is not configured", async () => {
    const harness = await createTestAppHarness({
      openAiApiKey: "",
      transcriptionModel: "openai/gpt-4o-transcribe",
    });
    try {
      const formData = new FormData();
      formData.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "audio.wav", {
          type: "audio/wav",
        }),
        "audio.wav",
      );

      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        {
          method: "POST",
          body: formData,
        },
      );

      expect(response.status).toBe(501);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "not_configured",
        message:
          "Voice transcription requires OPENAI_API_KEY for openai/* transcription",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
