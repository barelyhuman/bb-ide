import { Hono } from "hono";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  createProjectSource,
  listProjectSources,
  updateProjectSource,
  getDefaultProjectSource,
  deleteProjectSource,
} from "@bb/db";
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  createProjectSourceRequestSchema,
  updateProjectSourceRequestSchema,
} from "@bb/server-contract";
import type { ProjectResponse } from "@bb/server-contract";
import type { ProjectSource } from "@bb/domain";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { queueCommandAndWait } from "../command-wait.js";
import {
  storeAttachment,
  readAttachment,
  deleteProjectAttachments,
} from "../attachments.js";

function toProjectResponse(deps: ServerDeps, projectId: string): ProjectResponse | null {
  const project = getProject(deps.db, projectId);
  if (!project) return null;
  const sources = listProjectSources(deps.db, projectId) as ProjectSource[];
  return { ...project, sources } as ProjectResponse;
}

export function createProjectRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/", (c) => {
    const projects = listProjects(deps.db);
    const result = projects.map((p) => ({
      ...p,
      sources: listProjectSources(deps.db, p.id) as ProjectSource[],
    })) as ProjectResponse[];
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createProjectRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const project = createProject(deps.db, deps.hub, { name: parsed.data.name });
    createProjectSource(deps.db, deps.hub, {
      projectId: project.id,
      type: "local_path",
      hostId: parsed.data.hostId,
      path: parsed.data.sourcePath,
    });

    const response = toProjectResponse(deps, project.id)!;
    return c.json(response, 201);
  });

  app.get("/:id", (c) => {
    const response = toProjectResponse(deps, c.req.param("id"));
    if (!response) throw new ApiError(404, "project_not_found", "Project not found");
    return c.json(response);
  });

  app.patch("/:id", async (c) => {
    const body = await c.req.json();
    const parsed = updateProjectRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const updated = updateProject(deps.db, deps.hub, c.req.param("id"), parsed.data);
    if (!updated) throw new ApiError(404, "project_not_found", "Project not found");

    return c.json(toProjectResponse(deps, updated.id)!);
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    deleteProjectAttachments(deps.dataDir, id);
    const deleted = deleteProject(deps.db, deps.hub, id);
    if (!deleted) throw new ApiError(404, "project_not_found", "Project not found");
    return c.json({ ok: true });
  });

  // Project sources
  app.post("/:id/sources", async (c) => {
    const projectId = c.req.param("id");
    const project = getProject(deps.db, projectId);
    if (!project) throw new ApiError(404, "project_not_found", "Project not found");

    const body = await c.req.json();
    const parsed = createProjectSourceRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const source = createProjectSource(deps.db, deps.hub, {
      projectId,
      type: parsed.data.type ?? "local_path",
      hostId: parsed.data.hostId,
      path: parsed.data.path,
      repoUrl: parsed.data.repoUrl,
    });
    return c.json(source, 201);
  });

  app.patch("/:id/sources/:sourceId", async (c) => {
    const body = await c.req.json();
    const parsed = updateProjectSourceRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "invalid_request", parsed.error.message);

    const updated = updateProjectSource(deps.db, deps.hub, c.req.param("sourceId"), parsed.data);
    if (!updated) throw new ApiError(404, "not_found", "Project source not found");
    return c.json(updated);
  });

  app.delete("/:id/sources/:sourceId", (c) => {
    const deleted = deleteProjectSource(deps.db, deps.hub, c.req.param("sourceId"));
    if (!deleted) throw new ApiError(404, "not_found", "Project source not found");
    return c.json({ ok: true });
  });

  // Project files (proxy to daemon)
  app.get("/:id/files", async (c) => {
    const projectId = c.req.param("id");
    const source = getDefaultProjectSource(deps.db, projectId);
    if (!source) throw new ApiError(404, "project_not_found", "No default source for project");

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: source.hostId,
      command: {
        type: "workspace.list_files" as const,
        environmentId: source.id,
        query: c.req.query("query"),
      },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Failed to list files");
    }

    const data = result.result as { files: Array<{ path: string; name: string }> };
    return c.json(data.files.map((f) => ({ path: f.path })));
  });

  // Attachments
  app.post("/:id/attachments", async (c) => {
    const projectId = c.req.param("id");
    const project = getProject(deps.db, projectId);
    if (!project) throw new ApiError(404, "project_not_found", "Project not found");

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new ApiError(400, "invalid_request", "No file uploaded");

    const attachment = await storeAttachment(deps.dataDir, projectId, file);
    return c.json(attachment, 201);
  });

  app.get("/:id/attachments/content", async (c) => {
    const projectId = c.req.param("id");
    const path = c.req.query("path");
    if (!path) throw new ApiError(400, "invalid_request", "Missing path parameter");

    const content = readAttachment(deps.dataDir, projectId, path);
    if (content === null) throw new ApiError(404, "not_found", "Attachment not found");

    return c.text(content);
  });

  // Manager threads
  app.post("/:id/managers", async (c) => {
    const projectId = c.req.param("id");
    const project = getProject(deps.db, projectId);
    if (!project) throw new ApiError(404, "project_not_found", "Project not found");

    const body = await c.req.json();
    const source = getDefaultProjectSource(deps.db, projectId);
    if (!source) throw new ApiError(400, "invalid_request", "Project has no default source");

    const { createThreadWithEnvironment } = await import("./thread-create.js");
    const thread = await createThreadWithEnvironment(deps, {
      projectId,
      providerId: body.providerId ?? "default",
      type: "manager",
      title: body.title,
      model: body.model,
      reasoningLevel: body.reasoningLevel,
      environment: {
        type: "host" as const,
        hostId: source.hostId,
        workspace: { type: "unmanaged" as const, path: source.path },
      },
    });

    return c.json(thread, 201);
  });

  return app;
}
