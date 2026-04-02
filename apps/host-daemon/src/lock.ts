import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export const DAEMON_LOCK_FILE_NAME = "daemon.lock";

export async function acquireDaemonLock(
  dataDir: string,
): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });

  const lockPath = path.join(dataDir, DAEMON_LOCK_FILE_NAME);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  // proper-lockfile creates a directory at `<path>.lock` to hold the lock.
  // We pass lockfilePath explicitly so the exit handler below doesn't rely
  // on an undocumented default.
  const lockDirPath = `${lockPath}.lock`;
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    retries: 0,
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
