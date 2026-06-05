import { fetchLocalHostId as fetchSdkLocalHostId } from "@bb/sdk/node";

let cachedHostId: string | null | undefined;

export async function fetchLocalHostId(): Promise<string | null> {
  if (cachedHostId !== undefined) {
    return cachedHostId;
  }
  cachedHostId = await fetchSdkLocalHostId();
  return cachedHostId;
}

export async function resolveLocalHostId(): Promise<string> {
  const localHostId = await fetchLocalHostId();
  if (!localHostId) {
    throw new Error("Cannot reach local host daemon. Is it running?");
  }
  return localHostId;
}
