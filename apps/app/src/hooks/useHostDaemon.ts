import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { hostDaemonPortAtom, localHostIdAtom } from "@/lib/atoms";
import { openPath as daemonOpenPath, pickFolder as daemonPickFolder } from "@/lib/api-host-daemon";

/**
 * Hook for host daemon operations (open-path, pick-folder).
 *
 * Provides:
 * - `localHostId` — this machine's host ID, null if no daemon
 * - `hasDaemon` — whether a daemon is reachable
 * - `isLocalEnvironment(hostId)` — whether the given host matches this machine
 * - `openPath(path)` — open a path in the user's editor
 * - `pickFolder()` — open native folder picker, returns selected path or null
 */
export function useHostDaemon() {
  const localHostId = useAtomValue(localHostIdAtom);
  const daemonPort = useAtomValue(hostDaemonPortAtom);

  const hasDaemon = localHostId != null && daemonPort != null;

  const isLocalEnvironment = useCallback(
    (hostId: string | null | undefined) => {
      if (!localHostId || !hostId) return false;
      return hostId === localHostId;
    },
    [localHostId],
  );

  const openPath = useMemo(() => {
    if (!daemonPort) return null;
    const port = daemonPort;
    return (path: string) => daemonOpenPath(port, path);
  }, [daemonPort]);

  const pickFolder = useMemo(() => {
    if (!daemonPort) return null;
    const port = daemonPort;
    return () => daemonPickFolder(port);
  }, [daemonPort]);

  return {
    localHostId,
    hasDaemon,
    isLocalEnvironment,
    openPath,
    pickFolder,
  };
}
