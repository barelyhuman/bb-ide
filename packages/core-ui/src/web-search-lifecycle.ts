import type { ThreadEvent } from "@bb/domain";

export interface WebSearchLifecycleEvent {
  kind: "begin" | "end";
  callId: string;
  query?: string;
  action?: string;
}

export function parseWebSearchLifecycleEvent(
  decoded: ThreadEvent,
): WebSearchLifecycleEvent | null {
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
    };
  }

  return null;
}
