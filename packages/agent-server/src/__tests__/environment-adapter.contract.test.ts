import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  EnvironmentPrepareContext,
  EnvironmentSession,
} from "@beanbag/agent-core";
import {
  createLocalEnvironmentAdapter,
  createWorktreeEnvironmentAdapter,
} from "../environment-adapter.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
  }).trim();
}

function createPrepareContext(args: {
  projectId: string;
  threadId: string;
  projectRootPath: string;
}): EnvironmentPrepareContext {
  return {
    projectId: args.projectId,
    threadId: args.threadId,
    projectRootPath: args.projectRootPath,
    runtimeEnv: process.env,
  };
}

function assertSessionBaseContract(args: {
  session: EnvironmentSession;
  expectedWorkspaceRoot: string;
  expectedMode: string;
}): void {
  expect(args.session.cwd).toBe(args.expectedWorkspaceRoot);
  expect(args.session.env?.BB_WORKSPACE_ROOT).toBe(args.expectedWorkspaceRoot);
  expect(args.session.metadata?.workspaceRoot).toBe(args.expectedWorkspaceRoot);
  expect(args.session.metadata?.mode).toBe(args.expectedMode);
}

function initGitRepo(repoRoot: string): void {
  git(repoRoot, "init");
  git(repoRoot, "config", "user.name", "Beanbag Test");
  git(repoRoot, "config", "user.email", "beanbag-test@example.com");
  git(repoRoot, "checkout", "-b", "main");
  writeFileSync(join(repoRoot, "README.md"), "initial\n", "utf-8");
  git(repoRoot, "add", "README.md");
  git(repoRoot, "commit", "-m", "initial");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("environment adapter contract", () => {
  it("local adapter satisfies prepare contract", () => {
    const projectRoot = makeTempDir("bb-env-contract-local-");
    const context = createPrepareContext({
      projectId: "proj-local",
      threadId: "thread-local",
      projectRootPath: projectRoot,
    });

    const adapter = createLocalEnvironmentAdapter();
    const session = adapter.prepare(context);

    assertSessionBaseContract({
      session,
      expectedWorkspaceRoot: projectRoot,
      expectedMode: "local",
    });
    expect(session.env?.BB_WORKSPACE_MODE).toBe("local");
    expect(session.cleanup).toBeUndefined();
  });

  it("worktree adapter satisfies prepare contract in git repos", () => {
    const projectRoot = makeTempDir("bb-env-contract-worktree-");
    initGitRepo(projectRoot);

    const adapter = createWorktreeEnvironmentAdapter({
      worktreeRootName: ".beanbag-test-worktrees",
    });
    const session = adapter.prepare(
      createPrepareContext({
        projectId: "proj-worktree",
        threadId: "thread-worktree",
        projectRootPath: projectRoot,
      }),
    );

    assertSessionBaseContract({
      session,
      expectedWorkspaceRoot: join(
        projectRoot,
        ".beanbag-test-worktrees",
        "thread-worktree",
      ),
      expectedMode: "worktree",
    });
    expect(session.env?.BB_WORKSPACE_MODE).toBe("worktree");
    expect(typeof session.cleanup).toBe("function");
    expect(existsSync(session.cwd)).toBe(true);
    expect(readFileSync(join(projectRoot, "README.md"), "utf-8")).toBe("initial\n");
  });

  it("worktree adapter cleans up only the isolated workspace", () => {
    const projectRoot = makeTempDir("bb-env-contract-cleanup-");
    initGitRepo(projectRoot);

    const adapter = createWorktreeEnvironmentAdapter({
      worktreeRootName: ".beanbag-test-worktrees",
    });
    const session = adapter.prepare(
      createPrepareContext({
        projectId: "proj-cleanup",
        threadId: "thread-cleanup",
        projectRootPath: projectRoot,
      }),
    );

    writeFileSync(join(session.cwd, "THREAD_NOTES.md"), "isolated note\n", "utf-8");
    expect(existsSync(join(session.cwd, "THREAD_NOTES.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "README.md"))).toBe(true);

    session.cleanup?.();
    session.cleanup?.();

    expect(existsSync(session.cwd)).toBe(false);
    expect(existsSync(join(projectRoot, "README.md"))).toBe(true);
    expect(readFileSync(join(projectRoot, "README.md"), "utf-8")).toBe("initial\n");
  });

  it("worktree adapter falls back to local mode outside git repos", () => {
    const projectRoot = makeTempDir("bb-env-contract-fallback-non-git-");

    const adapter = createWorktreeEnvironmentAdapter({
      worktreeRootName: ".beanbag-test-worktrees",
    });
    const session = adapter.prepare(
      createPrepareContext({
        projectId: "proj-fallback",
        threadId: "thread-fallback",
        projectRootPath: projectRoot,
      }),
    );

    assertSessionBaseContract({
      session,
      expectedWorkspaceRoot: projectRoot,
      expectedMode: "local",
    });
    expect(session.env?.BB_WORKSPACE_MODE).toBe("local-fallback");
    expect(session.metadata?.fallbackReason).toBe("missing-git-root");
  });

  it("worktree adapter falls back to local mode when git worktree add fails", () => {
    const projectRoot = makeTempDir("bb-env-contract-fallback-failed-add-");
    initGitRepo(projectRoot);

    const adapter = createWorktreeEnvironmentAdapter({
      gitCommand: join(projectRoot, "missing-git"),
      worktreeRootName: ".beanbag-test-worktrees",
    });
    const session = adapter.prepare(
      createPrepareContext({
        projectId: "proj-fallback-failed-add",
        threadId: "thread-fallback-failed-add",
        projectRootPath: projectRoot,
      }),
    );

    assertSessionBaseContract({
      session,
      expectedWorkspaceRoot: projectRoot,
      expectedMode: "local",
    });
    expect(session.env?.BB_WORKSPACE_MODE).toBe("local-fallback");
    expect(session.metadata?.fallbackReason).toBe("worktree-add-failed");
  });
});
