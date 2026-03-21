import { getStringField, toRecord } from "./unknown-helpers.js";

export function decodeThreadIdFromWireValue(value: unknown): string | undefined {
  const payload = toRecord(value);
  if (!payload) return undefined;

  return (
    getStringField(payload, "threadId") ??
    getStringField(payload, "thread_id") ??
    getStringField(payload, "conversationId") ??
    getStringField(payload, "conversation_id") ??
    getStringField(toRecord(payload.thread), "id")
  );
}
