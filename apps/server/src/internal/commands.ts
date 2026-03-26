import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  fetchCommands,
  reportCommandResult,
  getThread,
  updateEnvironment,
  transitionThreadStatus,
  listThreads,
  hostDaemonSessions,
  hostDaemonCommands,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import {
  hostDaemonCommandsQuerySchema,
  hostDaemonCommandResultReportSchema,
} from "@bb/host-daemon-contract";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";

function getSessionById(db: DbConnection, sessionId: string) {
  return db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.id, sessionId))
    .get() ?? null;
}

function getCommandById(db: DbConnection, commandId: string) {
  return db
    .select()
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.id, commandId))
    .get() ?? null;
}

export function createCommandRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/commands", async (c) => {
    const query = {
      sessionId: c.req.query("sessionId"),
      afterCursor: c.req.query("afterCursor"),
      limit: c.req.query("limit"),
      waitMs: c.req.query("waitMs"),
    };

    const parsed = hostDaemonCommandsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.message);
    }

    const session = getSessionById(deps.db, parsed.data.sessionId);
    if (!session || session.status !== "active") {
      throw new ApiError(401, "inactive_session", "Session not found or inactive");
    }

    const hostId = session.hostId;
    const afterCursor = parsed.data.afterCursor
      ? parseInt(parsed.data.afterCursor, 10)
      : 0;
    const limit = parsed.data.limit
      ? parseInt(parsed.data.limit, 10)
      : 100;

    let commands = fetchCommands(deps.db, deps.hub, {
      hostId,
      afterCursor,
      limit,
    });

    // Long-poll support
    if (commands.length === 0 && parsed.data.waitMs) {
      const waitMs = parseInt(parsed.data.waitMs, 10);
      if (waitMs > 0 && waitMs <= 30_000) {
        await deps.hub.waitForCommands(hostId, waitMs);
        commands = fetchCommands(deps.db, deps.hub, {
          hostId,
          afterCursor,
          limit,
        });
      }
    }

    if (commands.length === 0) {
      return c.body(null, 204);
    }

    const envelopes = commands.map((cmd) => ({
      id: cmd.id,
      cursor: cmd.cursor,
      command: JSON.parse(cmd.payload),
    }));

    return c.json({ commands: envelopes });
  });

  app.post("/command-result", async (c) => {
    const body = await c.req.json();
    const parsed = hostDaemonCommandResultReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.message);
    }

    const report = parsed.data;

    // Report the result to the DB
    reportCommandResult(deps.db, deps.hub, {
      commandId: report.commandId,
      state: report.ok ? "success" : "error",
      resultPayload: JSON.stringify(
        report.ok
          ? (report as { result: unknown }).result
          : { errorCode: (report as { errorCode: string }).errorCode, errorMessage: (report as { errorMessage: string }).errorMessage },
      ),
    });

    // Resolve any waiters for this command
    if (report.ok) {
      deps.hub.resolveCommandResult(report.commandId, {
        ok: true,
        result: (report as { result: unknown }).result,
      });
    } else {
      deps.hub.resolveCommandResult(report.commandId, {
        ok: false,
        errorCode: (report as { errorCode: string }).errorCode,
        errorMessage: (report as { errorMessage: string }).errorMessage,
      });
    }

    // Handle side effects based on command type
    handleCommandResultSideEffects(deps, report);

    return c.json({ ok: true });
  });

  return app;
}

function handleCommandResultSideEffects(
  deps: ServerDeps,
  report: { type: string; ok: boolean; commandId: string; [key: string]: unknown },
): void {
  if (report.type === "environment.provision") {
    handleProvisionResult(deps, report);
  }
  if (report.type === "thread.start") {
    handleThreadStartResult(deps, report);
  }
}

function handleProvisionResult(
  deps: ServerDeps,
  report: { ok: boolean; commandId: string; [key: string]: unknown },
): void {
  const cmd = getCommandById(deps.db, report.commandId);
  if (!cmd) return;

  const payload = JSON.parse(cmd.payload);
  const environmentId = payload.environmentId as string | undefined;
  if (!environmentId) return;

  if (report.ok) {
    const result = ((report as unknown as { result: Record<string, unknown> }).result) ?? {};

    updateEnvironment(deps.db, deps.hub, environmentId, {
      status: "ready",
      path: result.path as string | undefined,
      isGitRepo: result.isGitRepo as boolean | undefined,
      isWorktree: result.isWorktree as boolean | undefined,
      branchName: result.branchName as string | undefined,
    });

    // Transition threads waiting for this environment
    const threads = listThreads(deps.db, { archived: false });
    for (const thread of threads) {
      if (thread.environmentId === environmentId && thread.status === "created") {
        transitionThreadStatus(deps.db, deps.hub, thread.id, "idle");
        break;
      }
    }
  } else {
    updateEnvironment(deps.db, deps.hub, environmentId, { status: "error" });

    const threads = listThreads(deps.db, { archived: false });
    for (const thread of threads) {
      if (thread.environmentId === environmentId && thread.status === "created") {
        transitionThreadStatus(deps.db, deps.hub, thread.id, "provisioning");
        transitionThreadStatus(deps.db, deps.hub, thread.id, "error");
      }
    }
  }
}

function handleThreadStartResult(
  deps: ServerDeps,
  report: { ok: boolean; commandId: string; [key: string]: unknown },
): void {
  const cmd = getCommandById(deps.db, report.commandId);
  if (!cmd) return;

  const payload = JSON.parse(cmd.payload);
  const threadId = payload.threadId as string | undefined;
  if (!threadId) return;

  const thread = getThread(deps.db, threadId);
  if (!thread) return;

  if (report.ok) {
    if (thread.status === "idle" || thread.status === "created") {
      if (thread.status === "created") {
        transitionThreadStatus(deps.db, deps.hub, threadId, "idle");
      }
      transitionThreadStatus(deps.db, deps.hub, threadId, "active");
    }
  } else {
    try {
      transitionThreadStatus(deps.db, deps.hub, threadId, "error");
    } catch {
      // Status transition may be invalid
    }
  }
}
