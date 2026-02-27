import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  EnvironmentAdapter,
  EnvironmentPrepareContext,
  EnvironmentSession,
  SystemEnvironmentInfo,
} from "@beanbag/agent-core";

const LOCAL_ENVIRONMENT_INFO: SystemEnvironmentInfo = {
  id: "local",
  displayName: "Local Workspace",
  description: "Run directly in the project root on the host machine.",
  capabilities: {
    isolatedFilesystem: false,
    ephemeralWorkspace: false,
    supportsCleanup: false,
  },
};

const WORKTREE_ENVIRONMENT_INFO: SystemEnvironmentInfo = {
  id: "worktree",
  displayName: "Git Worktree Workspace",
  description:
    "Provision an isolated per-thread git worktree when the project is a git repository.",
  capabilities: {
    isolatedFilesystem: true,
    ephemeralWorkspace: true,
    supportsCleanup: true,
  },
};

function toChildEnv(
  env: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return env;
}

function runGit(
  gitCommand: string,
  cwd: string,
  args: string[],
): { ok: boolean; stdout: string } {
  const result = spawnSync(gitCommand, args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
  };
}

function hasLocalBranch(
  gitCommand: string,
  projectRoot: string,
  branch: string,
): boolean {
  return runGit(
    gitCommand,
    projectRoot,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
  ).ok;
}

function resolveWorktreeStartRef(
  gitCommand: string,
  projectRoot: string,
): string | undefined {
  if (hasLocalBranch(gitCommand, projectRoot, "main")) return "main";
  if (hasLocalBranch(gitCommand, projectRoot, "master")) return "master";
  const headBranch = runGit(gitCommand, projectRoot, ["symbolic-ref", "--short", "HEAD"]);
  if (headBranch.ok && headBranch.stdout.length > 0) {
    return headBranch.stdout;
  }
  return undefined;
}

function toWorktreeBranchName(threadId: string): string {
  const normalized = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = normalized.length > 0 ? normalized : "thread";
  return `bb/thread-${suffix}`;
}

function localSession(context: EnvironmentPrepareContext): EnvironmentSession {
  return {
    cwd: context.projectRootPath,
    env: {
      BB_WORKSPACE_ROOT: context.projectRootPath,
      BB_WORKSPACE_MODE: "local",
    },
    metadata: {
      mode: "local",
      workspaceRoot: context.projectRootPath,
    },
  };
}

export function createLocalEnvironmentAdapter(): EnvironmentAdapter {
  return {
    info: { ...LOCAL_ENVIRONMENT_INFO },
    prepare(context: EnvironmentPrepareContext): EnvironmentSession {
      return localSession(context);
    },
  };
}

export interface CreateWorktreeEnvironmentAdapterOptions {
  gitCommand?: string;
  worktreeRootName?: string;
}

const DEFAULT_WORKTREE_ROOT = "~/.beanbag/worktrees";

function expandHomeDirectory(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function resolveConfiguredWorktreeRoot(
  projectRoot: string,
  configuredRoot: string,
): { root: string; isGlobalRoot: boolean } {
  const normalizedRoot = expandHomeDirectory(configuredRoot.trim());
  if (isAbsolute(normalizedRoot)) {
    return { root: normalizedRoot, isGlobalRoot: true };
  }
  return {
    root: resolve(projectRoot, normalizedRoot),
    isGlobalRoot: false,
  };
}

export function createWorktreeEnvironmentAdapter(
  opts?: CreateWorktreeEnvironmentAdapterOptions,
): EnvironmentAdapter {
  const gitCommand = opts?.gitCommand ?? process.env.BEANBAG_GIT_COMMAND ?? "git";
  const worktreeRootName = opts?.worktreeRootName ??
    process.env.BEANBAG_WORKTREE_ROOT ??
    DEFAULT_WORKTREE_ROOT;

  return {
    info: { ...WORKTREE_ENVIRONMENT_INFO },
    prepare(context: EnvironmentPrepareContext): EnvironmentSession {
      const fallback = localSession(context);
      const projectRoot = context.projectRootPath;
      const gitDir = join(projectRoot, ".git");
      if (!existsSync(gitDir)) {
        return {
          ...fallback,
          env: {
            ...(fallback.env ?? {}),
            BB_WORKSPACE_MODE: "local-fallback",
          },
          metadata: {
            ...(fallback.metadata ?? {}),
            fallbackReason: "missing-git-root",
          },
        };
      }

      const { root: configuredWorktreeRoot, isGlobalRoot } =
        resolveConfiguredWorktreeRoot(projectRoot, worktreeRootName);
      const worktreeRoot = isGlobalRoot
        ? resolve(configuredWorktreeRoot, context.projectId)
        : configuredWorktreeRoot;
      const workspaceRoot = resolve(worktreeRoot, context.threadId);
      mkdirSync(worktreeRoot, { recursive: true });

      if (!existsSync(workspaceRoot)) {
        const worktreeBranch = toWorktreeBranchName(context.threadId);
        const startRef = resolveWorktreeStartRef(gitCommand, projectRoot);
        const branchAddArgs = hasLocalBranch(gitCommand, projectRoot, worktreeBranch)
          ? ["worktree", "add", workspaceRoot, worktreeBranch]
          : [
              "worktree",
              "add",
              "-b",
              worktreeBranch,
              workspaceRoot,
              ...(startRef ? [startRef] : []),
            ];
        const branchAddResult = spawnSync(
          gitCommand,
          branchAddArgs,
          {
            cwd: projectRoot,
            env: toChildEnv(context.runtimeEnv),
            stdio: "pipe",
          },
        );
        const addResult = branchAddResult.status === 0
          ? branchAddResult
          : spawnSync(
              gitCommand,
              ["worktree", "add", "--detach", workspaceRoot],
              {
                cwd: projectRoot,
                env: toChildEnv(context.runtimeEnv),
                stdio: "pipe",
              },
            );
        if (addResult.status !== 0) {
          return {
            ...fallback,
            env: {
              ...(fallback.env ?? {}),
              BB_WORKSPACE_MODE: "local-fallback",
            },
            metadata: {
              ...(fallback.metadata ?? {}),
              fallbackReason: "worktree-add-failed",
            },
          };
        }
      }

      return {
        cwd: workspaceRoot,
        env: {
          BB_WORKSPACE_ROOT: workspaceRoot,
          BB_WORKSPACE_MODE: "worktree",
        },
        metadata: {
          mode: "worktree",
          workspaceRoot,
        },
        cleanup: () => {
          spawnSync(gitCommand, ["worktree", "remove", "--force", workspaceRoot], {
            cwd: projectRoot,
            env: toChildEnv(context.runtimeEnv),
            stdio: "pipe",
          });
          rmSync(workspaceRoot, { recursive: true, force: true });
        },
      };
    },
  };
}
