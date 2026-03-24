import { createHostDaemonLocalClient } from "@bb/host-daemon-contract";

let client: ReturnType<typeof createHostDaemonLocalClient> | null = null;

/**
 * Get or create the host daemon client.
 * Returns null if no daemon port is configured.
 */
export function getHostDaemonClient(port: number) {
  if (!client) {
    client = createHostDaemonLocalClient(`http://localhost:${port}`);
  }
  return client;
}

/**
 * Fetch the local host ID from the daemon.
 * Returns null if the daemon is unreachable.
 */
export async function fetchHostId(port: number): Promise<string | null> {
  try {
    const daemon = getHostDaemonClient(port);
    const res = await daemon["host-id"].$get();
    if (!res.ok) return null;
    const body = (await res.json()) as { hostId: string };
    return body.hostId;
  } catch {
    return null;
  }
}

/**
 * Open a path in the user's default editor via the host daemon.
 */
export async function openPath(port: number, path: string): Promise<void> {
  const daemon = getHostDaemonClient(port);
  await daemon.open.$post({ json: { path } });
}

/**
 * Open a native folder picker dialog via the host daemon.
 * Returns the selected path, or null if cancelled.
 */
export async function pickFolder(port: number): Promise<string | null> {
  const daemon = getHostDaemonClient(port);
  const res = await daemon["pick-folder"].$post({});
  if (!res.ok) return null;
  const body = (await res.json()) as { path: string | null };
  return body.path;
}
