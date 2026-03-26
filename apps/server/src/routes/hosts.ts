import { Hono } from "hono";
import { getHost, listHosts, getActiveSession } from "@bb/db";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";

function deriveHostStatus(deps: ServerDeps, hostId: string): "connected" | "disconnected" {
  const session = getActiveSession(deps.db, hostId);
  if (!session) return "disconnected";
  return session.leaseExpiresAt > Date.now() ? "connected" : "disconnected";
}

export function createHostRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/", (c) => {
    const hosts = listHosts(deps.db);
    return c.json(hosts.map((h) => ({ ...h, status: deriveHostStatus(deps, h.id) })));
  });

  app.get("/:id", (c) => {
    const host = getHost(deps.db, c.req.param("id"));
    if (!host) throw new ApiError(404, "not_found", "Host not found");
    return c.json({ ...host, status: deriveHostStatus(deps, host.id) });
  });

  return app;
}
