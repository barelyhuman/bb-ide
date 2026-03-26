import { Hono } from "hono";
import {
  upsertHost,
  openSession,
  getHighWaterMarks,
  listThreads,
  listEnvironments,
} from "@bb/db";
import {
  hostDaemonSessionOpenRequestSchema,
} from "@bb/host-daemon-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const LEASE_TIMEOUT_MS = 45_000;

export function createSessionRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.post("/open", async (c) => {
    const body = await c.req.json();
    const parsed = hostDaemonSessionOpenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.message);
    }

    const data = parsed.data;

    // Upsert the host
    upsertHost(deps.db, deps.hub, {
      id: data.hostId,
      name: data.hostName,
      type: data.hostType,
    });

    // Close any existing active sessions for this host (handled by openSession)
    // and notify old daemon WS
    const existingDaemon = deps.hub.findDaemonByHostId(data.hostId);
    if (existingDaemon) {
      deps.hub.sendToDaemon(existingDaemon.sessionId, {
        type: "session-close",
        reason: "replaced",
      });
      deps.hub.removeDaemon(existingDaemon.sessionId);
    }

    const session = openSession(deps.db, deps.hub, {
      hostId: data.hostId,
      instanceId: data.instanceId,
      hostName: data.hostName,
      hostType: data.hostType,
      protocolVersion: data.protocolVersion,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      leaseTimeoutMs: LEASE_TIMEOUT_MS,
    });

    // Get high-water marks for threads on this host's environments
    const environments = listEnvironments(deps.db);
    const hostEnvs = environments.filter((e) => e.hostId === data.hostId);
    const threadIds: string[] = [];
    for (const env of hostEnvs) {
      const threads = listThreads(deps.db, { archived: false });
      for (const t of threads) {
        if (t.environmentId === env.id) threadIds.push(t.id);
      }
    }
    const threadHighWaterMarks = threadIds.length > 0
      ? getHighWaterMarks(deps.db, threadIds)
      : {};

    return c.json(
      {
        sessionId: session.id,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        leaseTimeoutMs: LEASE_TIMEOUT_MS,
        threadHighWaterMarks,
      },
      201,
    );
  });

  return app;
}
