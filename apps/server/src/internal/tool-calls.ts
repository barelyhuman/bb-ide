import {
  hostDaemonToolCallRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { messageUserToolArgumentsSchema } from "@bb/domain";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { parseValue } from "../services/validation.js";
import { appendThreadEvent } from "../services/thread-events.js";
import { requireThreadEnvironment } from "../services/entity-lookup.js";
import { requireActiveSession } from "./session-state.js";

export function registerInternalToolCallRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post("/session/tool-call", hostDaemonToolCallRequestSchema, async (context, payload) => {
    const session = requireActiveSession(deps.db, payload.sessionId);
    const { environment } = requireThreadEnvironment(deps.db, payload.threadId);
    if (environment.hostId !== session.hostId) {
      throw new ApiError(
        403,
        "invalid_request",
        "Thread does not belong to the session host",
      );
    }

    if (payload.tool === "message_user") {
      const args = parseValue(payload.arguments ?? {}, messageUserToolArgumentsSchema);

      appendThreadEvent(deps, {
        threadId: payload.threadId,
        turnId: payload.turnId,
        type: "system/manager/user_message",
        data: {
          text: args.text,
          toolCallId: payload.callId,
          turnId: payload.turnId,
        },
      });

      return context.json({
        success: true,
        contentItems: [{ type: "inputText", text: "Message delivered" }],
      });
    }

    return context.json({
      success: false,
      contentItems: [{ type: "inputText", text: `Unsupported tool: ${payload.tool}` }],
    });
  });
}
