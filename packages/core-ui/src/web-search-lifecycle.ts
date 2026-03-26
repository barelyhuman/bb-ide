import type { ThreadEvent } from "@bb/domain";
import { getEventParentToolCallId } from "./event-decode.js";

export interface WebSearchLifecycleEvent {
  kind: "begin" | "end";
  callId: string;
  query?: string;
  action?: string;
  parentToolCallId?: string;
}

export function parseWebSearchLifecycleEvent(
  decoded: ThreadEvent,
  parentToolCallIdOverride?: string,
): WebSearchLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "webSearch"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      callId,
      query: decoded.item.query,
      action: decoded.item.action,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  return null;
}
