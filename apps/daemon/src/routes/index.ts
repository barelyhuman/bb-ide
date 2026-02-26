import { Hono } from "hono";
import type { ThreadOrchestrator } from "@beanbag/agent-core";
import type { ProjectRepository } from "@beanbag/db";
import { createProjectRoutes } from "./projects.js";
import { createThreadRoutes } from "./threads.js";
import { createSystemRoutes } from "./system.js";
import { createRoleRoutes } from "./roles.js";
import type { WSManager } from "../ws.js";

export interface ApiRouteDeps {
  projectRepo: ProjectRepository;
  threadManager: ThreadOrchestrator;
  wsManager: WSManager;
  startTime: number;
}

export function createApiRoutes(deps: ApiRouteDeps) {
  return new Hono()
    .route("/projects", createProjectRoutes(deps.projectRepo))
    .route("/roles", createRoleRoutes())
    .route("/threads", createThreadRoutes(deps.threadManager))
    .route("/system", createSystemRoutes(deps.threadManager, deps.startTime));
}
