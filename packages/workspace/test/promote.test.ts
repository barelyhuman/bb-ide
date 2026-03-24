import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Workspace,
  createWorktree,
  exportWorkspace,
  importWorkspace,
} from "../src/index.js";
import { runGit, WorkspaceError } from "../src/git.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-workspace-promote-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "README.md"], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function initBareRemoteFrom(repoPath: string): Promise<string> {
  const remotePath = await makeTempDir("bb-workspace-promote-remote-");
  const barePath = `${remotePath}.git`;
  await runGit(["clone", "--bare", repoPath, barePath], {
    cwd: path.dirname(repoPath),
  });
  await runGit(["remote", "add", "origin", barePath], { cwd: repoPath });
  await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
  return barePath;
}

async function createPrimaryAndWorktree(): Promise<{
  primaryRepo: string;
  worktreePath: string;
}> {
  const primaryRepo = await initRepo();
  const worktreeParent = await makeTempDir("bb-workspace-promote-worktree-parent-");
  const worktreePath = path.join(worktreeParent, "env");
  await createWorktree({
    sourcePath: primaryRepo,
    targetPath: worktreePath,
    branchName: "bb/env-test",
  });
  await fs.writeFile(path.join(worktreePath, "feature.txt"), "feature work\n", "utf8");
  await runGit(["add", "."], { cwd: worktreePath });
  await runGit(["commit", "-m", "Feature work"], { cwd: worktreePath });
  return { primaryRepo, worktreePath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("exportWorkspace", () => {
  it("detaches the exported worktree head for same-host promotion", async () => {
    const { worktreePath } = await createPrimaryAndWorktree();
    const workspace = new Workspace(worktreePath);

    const result = await exportWorkspace(workspace);

    expect(result).toEqual({ branch: "bb/env-test" });
    expect(await workspace.currentBranch).toBeUndefined();
  });

  it("pushes to a remote without detaching for cross-host promotion", async () => {
    const { primaryRepo, worktreePath } = await createPrimaryAndWorktree();
    await initBareRemoteFrom(primaryRepo);
    const workspace = new Workspace(worktreePath);

    const result = await exportWorkspace(workspace, "origin");

    expect(result).toEqual({
      branch: "bb/env-test",
      remote: "origin",
    });
    expect(await workspace.currentBranch).toBe("bb/env-test");
  });
});

describe("importWorkspace", () => {
  it("switches the primary workspace to the exported branch", async () => {
    const { primaryRepo, worktreePath } = await createPrimaryAndWorktree();
    const source = new Workspace(worktreePath);
    const primary = new Workspace(primaryRepo);

    const exportData = await exportWorkspace(source);
    const result = await importWorkspace(primary, exportData);

    expect(result.previousBranch).toBe("main");
    expect(await primary.currentBranch).toBe("bb/env-test");
  });

  it("does not create a stash when the primary workspace is clean", async () => {
    const { primaryRepo, worktreePath } = await createPrimaryAndWorktree();
    const source = new Workspace(worktreePath);
    const primary = new Workspace(primaryRepo);

    const exportData = await exportWorkspace(source);
    const result = await importWorkspace(primary, exportData);

    expect(result.previousBranch).toBe("main");
  });

  it("is idempotent when already on the target branch", async () => {
    const { primaryRepo, worktreePath } = await createPrimaryAndWorktree();
    const source = new Workspace(worktreePath);
    const primary = new Workspace(primaryRepo);

    const exportData = await exportWorkspace(source);
    await importWorkspace(primary, exportData);
    const result = await importWorkspace(primary, exportData);

    expect(result).toEqual({ previousBranch: "bb/env-test" });
  });

  it("supports demoting back to the original branch", async () => {
    const { primaryRepo, worktreePath } = await createPrimaryAndWorktree();
    const source = new Workspace(worktreePath);
    const primary = new Workspace(primaryRepo);

    const originalBranch = await primary.currentBranch;
    const exportData = await exportWorkspace(source);
    const importResult = await importWorkspace(primary, exportData);
    await importWorkspace(primary, { branch: importResult.previousBranch ?? "main" });

    expect(await primary.currentBranch).toBe(originalBranch);
  });

  it("fails to export when the source workspace has uncommitted changes", async () => {
    const { worktreePath } = await createPrimaryAndWorktree();
    await fs.writeFile(path.join(worktreePath, "feature.txt"), "dirty export\n", "utf8");

    const workspace = new Workspace(worktreePath);

    await expect(exportWorkspace(workspace)).rejects.toThrow(
      /uncommitted changes/u,
    );
    await expect(exportWorkspace(workspace, "origin")).rejects.toThrow(
      WorkspaceError,
    );
    expect(await workspace.currentBranch).toBe("bb/env-test");
  });

  it("fails to import when the primary workspace has uncommitted changes", async () => {
    const sourceRepo = await initRepo();
    await initBareRemoteFrom(sourceRepo);
    await runGit(["checkout", "-b", "feature"], { cwd: sourceRepo });
    await fs.writeFile(path.join(sourceRepo, "README.md"), "feature branch\n", "utf8");
    await runGit(["add", "README.md"], { cwd: sourceRepo });
    await runGit(["commit", "-m", "Feature branch"], { cwd: sourceRepo });

    const sourceWorkspace = new Workspace(sourceRepo);
    const remoteExport = await exportWorkspace(sourceWorkspace, "origin");

    const primaryParent = await makeTempDir("bb-workspace-promote-clone-parent-");
    await runGit(["clone", sourceRepo, "primary"], { cwd: primaryParent });
    const primaryRepo = path.join(primaryParent, "primary");
    await runGit(["config", "user.name", "BB Tests"], { cwd: primaryRepo });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: primaryRepo });
    await runGit(["checkout", "main"], { cwd: primaryRepo });
    await fs.writeFile(path.join(primaryRepo, "local.txt"), "dirty local\n", "utf8");

    const primary = new Workspace(primaryRepo);
    await expect(importWorkspace(primary, remoteExport)).rejects.toThrow(
      /uncommitted changes/u,
    );

    const restored = await fs.readFile(path.join(primaryRepo, "local.txt"), "utf8");
    expect(restored).toContain("dirty local");
    expect(await primary.currentBranch).toBe("main");
  });
});
