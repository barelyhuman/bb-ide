import {
  getActiveSession,
  getHost,
  isEphemeralHostPendingCleanup,
  updateHost,
} from "@bb/db";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { createSandboxBackendForId } from "./sandbox-backends.js";

const DEFAULT_SESSION_WAIT_TIMEOUT_MS = 60_000;
const pendingHostDestroys = new Map<string, Promise<void>>();

export interface WaitForHostSessionOptions {
  timeoutMs?: number;
}

export async function waitForHostSession(
  deps: Pick<AppDeps, "db" | "hub">,
  hostId: string,
  options: WaitForHostSessionOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const session = getActiveSession(deps.db, hostId);
    if (session) {
      return session;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new ApiError(
        504,
        "host_connection_timeout",
        "Sandbox host did not connect back to the server in time",
      );
    }
    await deps.hub.waitForHostEvent(hostId, remainingMs);
  }
}

async function loadSandboxHost(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
) {
  const host = getHost(deps.db, hostId);
  if (!host || host.destroyedAt !== null) {
    deps.sandboxRegistry.remove(hostId);
    return null;
  }

  const cached = deps.sandboxRegistry.get(hostId);
  if (cached) {
    return cached;
  }

  if (!host?.externalId) {
    return null;
  }
  const externalId = host.externalId;
  const sandboxBackend = createSandboxBackendForId(host.provider ?? "e2b");

  return deps.sandboxRegistry.getOrCreate(hostId, async () =>
    sandboxBackend.resumeHost({
      config: deps.config,
      externalId,
      hostId: host.id,
      hostName: host.name,
      serverUrl: deps.config.publicUrl,
    }),
  );
}

export async function suspendIdleHost(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
): Promise<void> {
  const host = await loadSandboxHost(deps, hostId);
  if (host) {
    await host.suspend();
  }
}

export async function resumeSuspendedHost(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
) {
  const cached = deps.sandboxRegistry.get(hostId);
  const host = await loadSandboxHost(deps, hostId);
  if (!host) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  if (cached === host) {
    await host.resume();
  }
  return host;
}

export async function destroyHost(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
): Promise<void> {
  const pendingDestroy = pendingHostDestroys.get(hostId);
  if (pendingDestroy) {
    return pendingDestroy;
  }

  const destroyPromise = destroyHostInternal(deps, hostId).finally(() => {
    if (pendingHostDestroys.get(hostId) === destroyPromise) {
      pendingHostDestroys.delete(hostId);
    }
  });
  pendingHostDestroys.set(hostId, destroyPromise);
  return destroyPromise;
}

async function destroyHostInternal(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
): Promise<void> {
  const hostRecord = getHost(deps.db, hostId);
  if (!hostRecord || hostRecord.destroyedAt !== null) {
    deps.sandboxRegistry.remove(hostId);
    return;
  }

  const destroyedAt = Date.now();
  const cached = deps.sandboxRegistry.get(hostId);
  if (cached) {
    await cached.destroy();
    deps.sandboxRegistry.remove(hostId);
    updateHost(deps.db, deps.hub, hostId, { destroyedAt });
    return;
  }

  if (!hostRecord?.externalId) {
    return;
  }

  deps.sandboxRegistry.remove(hostId);
  const sandboxBackend = createSandboxBackendForId(hostRecord.provider ?? "e2b");
  await sandboxBackend.destroyHost({
    config: deps.config,
    externalId: hostRecord.externalId,
  });
  deps.sandboxRegistry.remove(hostId);
  updateHost(deps.db, deps.hub, hostId, { destroyedAt });
}

export async function destroyEphemeralHostIfReady(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
): Promise<boolean> {
  if (!isEphemeralHostPendingCleanup(deps.db, hostId)) {
    return false;
  }

  await destroyHost(deps, hostId);
  return true;
}
