import { getActiveSession, getHost, updateHost } from "@bb/db";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireConnectedHostSession } from "../lib/entity-lookup.js";

const DEFAULT_SESSION_WAIT_TIMEOUT_MS = 60_000;

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
        "Host daemon did not connect back to the server in time",
      );
    }
    await deps.hub.waitForHostEvent(hostId, remainingMs);
  }
}

export async function destroyHost(
  deps: Pick<AppDeps, "db" | "hostLifecycle" | "hub">,
  hostId: string,
): Promise<void> {
  const state = deps.hostLifecycle;
  await state.hostDestroyDeduper.run(hostId, async () =>
    state.hostLifecycleLane.run(hostId, async () => {
      const host = getHost(deps.db, hostId);
      if (!host || host.destroyedAt !== null) {
        return;
      }
      updateHost(deps.db, deps.hub, hostId, {
        destroyedAt: Date.now(),
      });
    }),
  );
}

export async function ensureHostSessionReadyForWork(
  deps: WorkSessionDeps,
  args: { hostId: string },
) {
  const host = getHost(deps.db, args.hostId);
  if (!host || host.destroyedAt !== null) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }

  return requireConnectedHostSession(deps, host.id);
}

export async function markHostSessionOpened(
  deps: Pick<AppDeps, "db" | "hostLifecycle">,
  args: { hostId: string },
): Promise<void> {
  await deps.hostLifecycle.hostLifecycleLane.run(args.hostId, async () => {
    const host = getHost(deps.db, args.hostId);
    if (!host || host.destroyedAt === null) {
      return;
    }
  });
}
