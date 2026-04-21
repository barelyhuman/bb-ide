import type { ThreadEvent } from "@bb/domain";
import { getEventParentToolCallId } from "./event-decode.js";

export interface WebSearchLifecycleEvent {
  kind: "begin" | "end";
  itemKind: "web-search";
  callId: string;
  queries: string[];
  resultText: string | null;
  parentToolCallId?: string;
}

export interface WebFetchLifecycleEvent {
  kind: "begin" | "end";
  itemKind: "web-fetch";
  callId: string;
  url: string;
  prompt: string | null;
  pattern: string | null;
  resultText: string | null;
  parentToolCallId?: string;
}

export type WebActivityLifecycleEvent =
  | WebSearchLifecycleEvent
  | WebFetchLifecycleEvent;

export function parseWebActivityLifecycleEvent(
  decoded: ThreadEvent,
  parentToolCallIdOverride?: string,
): WebActivityLifecycleEvent | null {
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
      itemKind: "web-search",
      callId,
      queries: decoded.item.queries,
      resultText: decoded.item.resultText,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "webFetch"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      itemKind: "web-fetch",
      callId,
      url: decoded.item.url,
      prompt: decoded.item.prompt,
      pattern: decoded.item.pattern,
      resultText: decoded.item.resultText,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  return null;
}
