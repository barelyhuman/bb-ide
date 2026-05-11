import path from "node:path";
import {
  getAbsoluteGitDir,
  runGit,
  type GitCommandResult,
  type RunGitOptions,
} from "./git.js";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockSpec,
  type ProcessLocalQueuedLockWork,
} from "./process-local-queued-lock.js";

type CheckoutMutationLockWork<T> = ProcessLocalQueuedLockWork<T>;

async function resolveCheckoutMutationLockSpec(
  checkoutPath: string,
): Promise<ProcessLocalQueuedLockSpec> {
  return { key: await getAbsoluteGitDir(checkoutPath) };
}

async function tryResolveCheckoutMutationLockSpec(
  checkoutPath: string,
): Promise<ProcessLocalQueuedLockSpec | null> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], {
    cwd: checkoutPath,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }

  const gitDir = result.stdout.trim();
  return gitDir ? { key: path.resolve(gitDir) } : null;
}

export async function withCheckoutMutationLock<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
): Promise<T> {
  const lock = await resolveCheckoutMutationLockSpec(checkoutPath);
  return withProcessLocalQueuedLocks({ locks: [lock], work });
}

export async function tryWithCheckoutMutationLock<T>(
  checkoutPath: string,
  work: CheckoutMutationLockWork<T>,
): Promise<T | null> {
  const lock = await tryResolveCheckoutMutationLockSpec(checkoutPath);
  if (!lock) {
    return null;
  }

  return withProcessLocalQueuedLocks({ locks: [lock], work });
}

export async function withCheckoutMutationLocks<T>(
  checkoutPaths: string[],
  work: CheckoutMutationLockWork<T>,
): Promise<T> {
  const locks = await Promise.all(
    checkoutPaths.map((checkoutPath) =>
      resolveCheckoutMutationLockSpec(checkoutPath),
    ),
  );
  return withProcessLocalQueuedLocks({ locks, work });
}

export async function runGitWithCheckoutMutationLock(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  return withCheckoutMutationLock(options.cwd, () => runGit(args, options));
}
