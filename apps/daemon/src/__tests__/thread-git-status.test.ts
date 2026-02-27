import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadGitStatusService } from "../thread-git-status.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "bb-thread-git-status-"));
  tempDirs.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ThreadGitStatusService", () => {
  it("returns deleted state when workspace root does not exist", () => {
    const service = new ThreadGitStatusService();
    const tempRoot = makeTempDir();
    const missingWorkspace = join(tempRoot, "missing-worktree");
    const status = service.getStatus({
      workspaceRoot: missingWorkspace,
      projectRoot: tempRoot,
    });

    expect(status.state).toBe("deleted");
    expect(status.workspaceRoot).toBe(missingWorkspace);
    expect(status.workspaceChangedFiles).toBe(0);
  });

  it("does not report ahead commits that are already cherry-picked onto main", () => {
    const repoRoot = makeTempDir();
    git(repoRoot, "init");
    git(repoRoot, "config", "user.name", "Beanbag Test");
    git(repoRoot, "config", "user.email", "beanbag-test@example.com");
    git(repoRoot, "checkout", "-b", "main");

    writeFileSync(join(repoRoot, "README.md"), "initial\n", "utf8");
    git(repoRoot, "add", "README.md");
    git(repoRoot, "commit", "-m", "initial");
    git(repoRoot, "checkout", "-b", "thread");
    writeFileSync(join(repoRoot, "README.md"), "initial\nthread change\n", "utf8");
    git(repoRoot, "add", "README.md");
    git(repoRoot, "commit", "-m", "thread change");
    const threadCommit = git(repoRoot, "rev-parse", "HEAD");

    git(repoRoot, "checkout", "main");
    git(repoRoot, "cherry-pick", threadCommit);
    git(repoRoot, "checkout", "--detach", threadCommit);

    const service = new ThreadGitStatusService();
    const status = service.getStatus({
      workspaceRoot: repoRoot,
      projectRoot: repoRoot,
      defaultBranch: "main",
    });

    expect(status.aheadCount).toBe(0);
    expect(status.hasCommittedUnmergedChanges).toBe(false);
    expect(status.state).toBe("clean");
  });
});
