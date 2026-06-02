import { fetchCommands } from "@bb/db";
import {
  hostDaemonCommandSchema,
  hostDaemonCommandsQuerySchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { parseInteger } from "../services/lib/validation.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

export function registerInternalCommandRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<HostDaemonInternalSchema>(app);

  get("/session/commands", hostDaemonCommandsQuerySchema, async (context, query) => {
    const session = requireAuthenticatedDaemonSession({
      context,
      db: deps.db,
      sessionId: query.sessionId,
    });
    const waitMs = parseInteger(query.waitMs, "waitMs");
    const fetchPending = () =>
      fetchCommands(deps.db, deps.hub, {
        hostId: session.hostId,
        limit: parseInteger(query.limit, "limit"),
        sessionId: session.id,
      });

    let commands = fetchPending();
    if (commands.length === 0 && waitMs > 0) {
      await deps.hub.waitForCommands(session.hostId, waitMs);
      commands = fetchPending();
    }

    if (commands.length === 0) {
      if (waitMs > 0) {
        return new Response(null, { status: 204 });
      }
      return context.json({ commands: [] });
    }

    return context.json({
      commands: commands.map((command) => ({
        id: command.id,
        attemptId: command.attemptId,
        cursor: command.cursor,
        command: hostDaemonCommandSchema.parse(JSON.parse(command.payload)),
      })),
    });
  });
}
