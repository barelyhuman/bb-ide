import { typedRoutes, type PublicApiSchema } from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { listHostsWithStatus, requireHostWithStatus } from "../services/entity-lookup.js";

export function registerHostRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app);

  get("/hosts", (context) => context.json(listHostsWithStatus(deps.db)));

  get("/hosts/:id", (context) =>
    context.json(requireHostWithStatus(deps.db, context.req.param("id"))),
  );
}
