import { Hono } from "hono";
import {
  getEnvironment,
  listThreads,
  archiveThread,
} from "@bb/db";
import {
  environmentActionRequestSchema,
} from "@bb/server-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { queueCommandAndWait } from "../command-wait.js";

export function createEnvironmentRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/:id", (c) => {
    const env = getEnvironment(deps.db, c.req.param("id"));
    if (!env) throw new ApiError(404, "not_found", "Environment not found");
    return c.json(env);
  });

  app.get("/:id/status", async (c) => {
    const env = getEnvironment(deps.db, c.req.param("id"));
    if (!env) throw new ApiError(404, "not_found", "Environment not found");

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: env.hostId,
      command: {
        type: "workspace.status" as const,
        environmentId: env.id,
        mergeBaseBranch: c.req.query("mergeBaseBranch"),
      },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Command failed");
    }

    const data = result.result as { workspaceStatus: unknown };
    return c.json({ workspace: data.workspaceStatus ?? null });
  });

  app.get("/:id/diff", async (c) => {
    const env = getEnvironment(deps.db, c.req.param("id"));
    if (!env) throw new ApiError(404, "not_found", "Environment not found");

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: env.hostId,
      command: {
        type: "workspace.diff" as const,
        environmentId: env.id,
        selection: c.req.query("selection"),
        mergeBaseBranch: c.req.query("mergeBaseBranch"),
      },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Command failed");
    }

    const data = result.result as { diff: unknown };
    return c.json(data.diff);
  });

  app.get("/:id/diff/branches", async (c) => {
    const env = getEnvironment(deps.db, c.req.param("id"));
    if (!env) throw new ApiError(404, "not_found", "Environment not found");

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: env.hostId,
      command: {
        type: "workspace.list_branches" as const,
        environmentId: env.id,
      },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Command failed");
    }

    const data = result.result as { branches: string[] };
    return c.json(data.branches);
  });

  app.post("/:id/actions", async (c) => {
    const env = getEnvironment(deps.db, c.req.param("id"));
    if (!env) throw new ApiError(404, "not_found", "Environment not found");

    const body = await c.req.json();
    const parsed = environmentActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.message);
    }

    const action = parsed.data;

    switch (action.action) {
      case "commit": {
        const result = await queueCommandAndWait({
          db: deps.db,
          hub: deps.hub,
          hostId: env.hostId,
          command: {
            type: "workspace.commit" as const,
            environmentId: env.id,
            message: action.options?.message ?? "commit",
            includeUnstaged: action.options?.includeUnstaged,
          },
        });

        if (!result.ok) {
          return c.json(
            {
              code: result.errorCode ?? "command_failed",
              message: result.errorMessage ?? "Commit failed",
              details: { kind: "commit_failed", errorMessage: result.errorMessage ?? "" },
            },
            409,
          );
        }

        const data = result.result as { commitSha: string; commitSubject?: string };
        const autoArchived = await maybeAutoArchive(deps, env.id, action.options?.autoArchiveOnSuccess);
        return c.json({
          ok: true as const,
          action: "commit" as const,
          commitCreated: true,
          message: "Committed successfully",
          autoArchived,
          commitSha: data.commitSha,
          commitSubject: data.commitSubject,
        });
      }

      case "squash_merge": {
        const opts = action.options ?? {};
        const mergeBaseBranch = opts.mergeBaseBranch ?? env.branchName ?? "main";

        if (opts.commitIfNeeded) {
          const commitResult = await queueCommandAndWait({
            db: deps.db,
            hub: deps.hub,
            hostId: env.hostId,
            command: {
              type: "workspace.commit" as const,
              environmentId: env.id,
              message: opts.commitMessage ?? "WIP commit before squash merge",
              includeUnstaged: opts.includeUnstaged,
            },
          });
          // Commit failures during squash_merge prep are non-fatal (nothing to commit is ok)
          if (commitResult.ok) {
            // committed
          }
        }

        const result = await queueCommandAndWait({
          db: deps.db,
          hub: deps.hub,
          hostId: env.hostId,
          command: {
            type: "workspace.squash_merge" as const,
            environmentId: env.id,
            targetBranch: mergeBaseBranch,
            commitMessage: opts.squashMessage ?? "Squash merge",
          },
        });

        if (!result.ok) {
          return c.json(
            {
              code: result.errorCode ?? "command_failed",
              message: result.errorMessage ?? "Squash merge failed",
            },
            409,
          );
        }

        const data = result.result as { merged: boolean; commitSha?: string; message?: string };
        const autoArchived = await maybeAutoArchive(deps, env.id, opts.autoArchiveOnSuccess);
        return c.json({
          ok: true as const,
          action: "squash_merge" as const,
          merged: data.merged,
          message: data.message ?? "Squash merge completed",
          autoArchived,
          commitSha: data.commitSha,
        });
      }

      case "promote": {
        // Find a thread for this environment to pass threadId
        const envThreads = listThreads(deps.db, { archived: false });
        const thread = envThreads.find((t) => t.environmentId === env.id);

        const source = await getDefaultSourceForProject(deps, env.projectId);
        const result = await queueCommandAndWait({
          db: deps.db,
          hub: deps.hub,
          hostId: env.hostId,
          command: {
            type: "workspace.promote" as const,
            environmentId: env.id,
            threadId: thread?.id ?? "",
            primaryPath: source?.path ?? "",
          },
        });

        if (!result.ok) {
          throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Promote failed");
        }

        return c.json({
          ok: true as const,
          action: "promote" as const,
          message: "Promoted to primary checkout",
        });
      }

      case "demote": {
        const envThreads2 = listThreads(deps.db, { archived: false });
        const thread2 = envThreads2.find((t) => t.environmentId === env.id);

        const source2 = await getDefaultSourceForProject(deps, env.projectId);
        const result = await queueCommandAndWait({
          db: deps.db,
          hub: deps.hub,
          hostId: env.hostId,
          command: {
            type: "workspace.demote" as const,
            environmentId: env.id,
            threadId: thread2?.id ?? "",
            primaryPath: source2?.path ?? "",
            defaultBranch: env.branchName ?? "main",
            envBranch: env.branchName ?? "",
          },
        });

        if (!result.ok) {
          throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Demote failed");
        }

        return c.json({
          ok: true as const,
          action: "demote" as const,
          message: "Demoted from primary checkout",
        });
      }

      default: {
        const _exhaustive: never = action;
        throw new ApiError(400, "invalid_request", `Unknown action: ${(_exhaustive as { action: string }).action}`);
      }
    }
  });

  return app;
}

import { getDefaultProjectSource } from "@bb/db";

async function getDefaultSourceForProject(deps: ServerDeps, projectId: string) {
  return getDefaultProjectSource(deps.db, projectId);
}

async function maybeAutoArchive(deps: ServerDeps, environmentId: string, autoArchive?: boolean): Promise<boolean> {
  if (!autoArchive) return false;
  const threads = listThreads(deps.db, { archived: false });
  const envThreads = threads.filter((t) => t.environmentId === environmentId);
  for (const t of envThreads) {
    archiveThread(deps.db, deps.hub, t.id);
  }
  return envThreads.length > 0;
}
