import { Hono } from "hono";
import type { ProjectRepository } from "@beanbag/db";
import type { ThreadManager } from "../thread-manager.js";
import { createProjectRoutes } from "./projects.js";
import { createThreadRoutes } from "./threads.js";
import { createSystemRoutes } from "./system.js";

export interface ApiRouteDeps {
  projectRepo: ProjectRepository;
  threadManager: ThreadManager;
  startTime: number;
}

export function createApiRoutes(deps: ApiRouteDeps) {
  return new Hono()
    .route("/projects", createProjectRoutes(deps.projectRepo))
    .route("/threads", createThreadRoutes(deps.threadManager))
    .route("/system", createSystemRoutes(deps.threadManager, deps.startTime));
}
