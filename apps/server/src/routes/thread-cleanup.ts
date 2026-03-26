import {
  getEnvironment,
  listThreads,
  queueCommand,
  getActiveSession,
  updateEnvironment,
} from "@bb/db";
import type { ServerDeps } from "../deps.js";

/**
 * After archiving or deleting a thread, check if the thread's environment
 * is managed and now has zero non-archived threads. If so, queue
 * `environment.destroy`.
 */
export async function maybeCleanupEnvironment(
  deps: ServerDeps,
  environmentId: string,
): Promise<void> {
  const env = getEnvironment(deps.db, environmentId);
  if (!env || !env.managed) return;

  const threads = listThreads(deps.db, { archived: false });
  const activeThreads = threads.filter((t) => t.environmentId === environmentId);

  if (activeThreads.length > 0) return;

  // No active threads left — destroy the managed environment
  updateEnvironment(deps.db, deps.hub, environmentId, { status: "destroying" });

  const session = getActiveSession(deps.db, env.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: env.hostId,
    sessionId: session?.id ?? null,
    type: "environment.destroy",
    payload: JSON.stringify({
      type: "environment.destroy",
      environmentId: env.id,
      path: env.path ?? "",
      workspaceProvisionType: env.workspaceProvisionType ?? "unmanaged",
    }),
  });
  deps.hub.notifyCommand(env.hostId);
}
