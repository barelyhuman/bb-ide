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
