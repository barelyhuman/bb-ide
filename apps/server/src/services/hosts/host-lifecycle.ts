import {
  getActiveSession,
  getHost,
  isEphemeralHostPendingCleanup,
  updateHost,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireSandboxBackendForHost } from "./sandbox-backends.js";

const DEFAULT_SESSION_WAIT_TIMEOUT_MS = 60_000;

interface HostDestroyDeduper {
  run(hostId: string, destroy: () => Promise<void>): Promise<void>;
}

export interface WaitForHostSessionOptions {
  timeoutMs?: number;
}

function createHostDestroyDeduper(): HostDestroyDeduper {
  const pendingHostDestroys = new Map<string, Promise<void>>();

  return {
    run(hostId: string, destroy: () => Promise<void>): Promise<void> {
      const pendingDestroy = pendingHostDestroys.get(hostId);
      if (pendingDestroy) {
        return pendingDestroy;
      }

      const destroyPromise = destroy().finally(() => {
        if (pendingHostDestroys.get(hostId) === destroyPromise) {
          pendingHostDestroys.delete(hostId);
        }
      });
      pendingHostDestroys.set(hostId, destroyPromise);
      return destroyPromise;
    },
  };
}

const hostDestroyDeduper = createHostDestroyDeduper();

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

export async function destroyHost(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "sandboxRegistry">,
  hostId: string,
): Promise<void> {
  return hostDestroyDeduper.run(hostId, async () => destroyHostInternal(deps, hostId));
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

  if (!hostRecord.externalId) {
    deps.sandboxRegistry.remove(hostId);
    updateHost(deps.db, deps.hub, hostId, { destroyedAt });
    return;
  }

  deps.sandboxRegistry.remove(hostId);
  const sandboxBackend = requireSandboxBackendForHost(hostRecord);
  await sandboxBackend.destroyHost({
    config: deps.config,
    externalId: hostRecord.externalId,
  });
  // A concurrent resume can repopulate the registry while destroy is in flight.
  // Clear again after external teardown so no stale live handle survives.
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
