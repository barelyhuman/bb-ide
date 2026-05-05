import { jsonValueSchema, type JsonValue } from "./json-value.js";
import { threadEventSchema, type ThreadEvent } from "./provider-event.js";

export interface CanonicalizeProducerEventPayloadArgs {
  event: ThreadEvent;
  protocolVersion: number;
  threadId: string;
}

function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const canonicalValue: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const entryValue = value[key];
    if (entryValue !== undefined) {
      canonicalValue[key] = canonicalizeJsonValue(entryValue);
    }
  }
  return canonicalValue;
}

function parseJsonValue(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

export function canonicalizeProducerEventPayload(
  args: CanonicalizeProducerEventPayloadArgs,
): string {
  const event = threadEventSchema.parse(args.event);
  const json = JSON.stringify({
    event,
    eventType: event.type,
    protocolVersion: args.protocolVersion,
    threadId: args.threadId,
  });
  return JSON.stringify(canonicalizeJsonValue(parseJsonValue(json)));
}
