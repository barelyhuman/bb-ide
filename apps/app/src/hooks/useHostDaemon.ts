import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import {
  hostDaemonPortAtom,
  localHostDaemonHostIdAtom,
  localHostDaemonReachableAtom,
  localHostIdAtom,
  localHostStatusAtom,
} from "@/lib/system-config-atoms";
import { pickFolder as daemonPickFolder } from "@/lib/api-host-daemon";

/**
 * Hook for host daemon operations.
 *
 * Provides:
 * - `localHostId` — this machine's connected host ID, null if no daemon session is open
 * - `localDaemonHostId` — the host ID reported by the reachable local daemon
 * - `hasDaemon` — whether a daemon is reachable
 * - `supportsNativeFolderPicker` — whether the daemon can open a native folder picker
 * - `isLocalHost(hostId)` — whether the given host matches this machine's connected server session
 * - `isLocalDaemonHost(hostId)` — whether the given host matches the reachable local daemon
 * - `pickFolder()` — open native folder picker (null if unavailable)
 */
export function useHostDaemon() {
  const localHostDaemonReachable = useAtomValue(localHostDaemonReachableAtom);
  const localDaemonHostId = useAtomValue(localHostDaemonHostIdAtom);
  const localHostStatus = useAtomValue(localHostStatusAtom);
  const localHostId = useAtomValue(localHostIdAtom);
  const daemonPort = useAtomValue(hostDaemonPortAtom);

  const hasDaemon = localHostDaemonReachable;
  const supportsNativeFolderPicker =
    localHostStatus?.supportsNativeFolderPicker ?? false;
  const platform = localHostStatus?.platform ?? null;

  const isLocalHost = useCallback(
    (hostId: string | null | undefined) => {
      if (!localHostId || !hostId) return false;
      return hostId === localHostId;
    },
    [localHostId],
  );

  const isLocalDaemonHost = useCallback(
    (hostId: string | null | undefined) => {
      if (!localDaemonHostId || !hostId) return false;
      return hostId === localDaemonHostId;
    },
    [localDaemonHostId],
  );

  const pickFolder = useMemo(() => {
    if (!hasDaemon || !daemonPort || !supportsNativeFolderPicker) return null;
    const port = daemonPort;
    return () => daemonPickFolder(port);
  }, [hasDaemon, daemonPort, supportsNativeFolderPicker]);

  return {
    localDaemonHostId,
    localHostId,
    hasDaemon,
    supportsNativeFolderPicker,
    platform,
    isLocalHost,
    isLocalDaemonHost,
    pickFolder,
  };
}
