import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export const DAEMON_LOCK_FILE_NAME = "daemon.lock";

// proper-lockfile refreshes the held lock's mtime while the holder is alive.
// A lock older than the stale window is therefore an abandoned daemon lock.
const DAEMON_LOCK_STALE_MS = 10_000;
const DAEMON_LOCK_RETRY_INTERVAL_MS = 1_000;
const DAEMON_LOCK_ACQUIRE_RETRIES = 13;

export interface AcquireDaemonLockOptions {
  /** Lock is treated as stale once its mtime is older than this many ms. */
  staleMs?: number;
  /** How many times to retry acquisition while a lock exists. */
  retries?: number;
  /** Fixed delay between acquisition retries. */
  retryIntervalMs?: number;
}

export async function acquireDaemonLock(
  dataDir: string,
  options: AcquireDaemonLockOptions = {},
): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });

  const lockPath = path.join(dataDir, DAEMON_LOCK_FILE_NAME);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  // proper-lockfile creates a directory at `<path>.lock` to hold the lock.
  // We pass lockfilePath explicitly so the exit handler below doesn't rely
  // on an undocumented default.
  const lockDirPath = `${lockPath}.lock`;
  const retryIntervalMs =
    options.retryIntervalMs ?? DAEMON_LOCK_RETRY_INTERVAL_MS;
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    stale: options.staleMs ?? DAEMON_LOCK_STALE_MS,
    retries: {
      retries: options.retries ?? DAEMON_LOCK_ACQUIRE_RETRIES,
      factor: 1,
      minTimeout: retryIntervalMs,
      maxTimeout: retryIntervalMs,
    },
    lockfilePath: lockDirPath,
  });

  // Synchronous fallback: if the process exits before the async release
  // completes, remove the lock directory so the next startup isn't blocked.
  const onExit = () => {
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {
      // Best-effort — nothing we can do if this fails during exit.
    }
  };
  process.once("exit", onExit);

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    process.removeListener("exit", onExit);
    await release();
  };
}
