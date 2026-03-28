import type {
  ProviderObservedToolCall,
  ProviderObservedToolCallCoverage,
  ProviderRawEventDescription,
  ProviderVisibilityMetadata,
} from "../provider-visibility.js";
import type { JsonRpcMessage } from "../provider-adapter.js";
import {
  getRawSdkMessage,
  getRecordProperty,
  getStringProperty,
} from "../shared/provider-visibility-helpers.js";

const PI_WELL_KNOWN_TOOL_NAMES = [
  "bash",
  "edit",
  "find",
  "grep",
  "read",
  "write",
] as const;
const PI_WELL_KNOWN_TOOL_NAME_SET = new Set<string>(PI_WELL_KNOWN_TOOL_NAMES);

const PI_ACCEPTED_FALLBACK_TOOL_NAMES = new Set([
  "ls",
  "repo_outline",
]);

function toPiRawEventKind(event: JsonRpcMessage): string {
  if (event.method !== "sdk/message") {
    return event.method;
  }
  const message = getRawSdkMessage(event);
  if (!message) {
    return "sdk/unknown";
  }

  const type = getStringProperty(message, "type");
  if (type === "message_start" || type === "message_end") {
    const payload = getRecordProperty(message, "message");
    const role = payload ? getStringProperty(payload, "role") : undefined;
    return role ? `sdk/${type}:${role}` : `sdk/${type}`;
  }
  if (type === "message_update") {
    const assistantMessageEvent = getRecordProperty(message, "assistantMessageEvent");
    const assistantEventType = assistantMessageEvent
      ? getStringProperty(assistantMessageEvent, "type")
      : undefined;
    return assistantEventType
      ? `sdk/message_update:${assistantEventType}`
      : "sdk/message_update";
  }
  return type ? `sdk/${type}` : "sdk/unknown";
}

function toPiRawEventDescription(event: JsonRpcMessage): ProviderRawEventDescription {
  const kind = toPiRawEventKind(event);

  if (
    kind === "thread/identity" ||
    kind === "sdk/agent_start" ||
    kind === "sdk/agent_end" ||
    kind === "sdk/message_update:text_delta" ||
    kind === "sdk/tool_execution_start" ||
    kind === "sdk/tool_execution_end" ||
    kind === "sdk/tool_execution_update"
  ) {
    return { kind, coverage: "normalized" };
  }

  if (
    kind === "sdk/auto_retry_start" ||
    kind === "sdk/auto_retry_end" ||
    kind === "sdk/turn_start" ||
    kind === "sdk/message_start:user" ||
    kind === "sdk/message_end:user" ||
    kind === "sdk/message_start:assistant" ||
    kind === "sdk/message_start:toolResult" ||
    kind === "sdk/message_end:toolResult" ||
    kind === "sdk/message_update:text_start" ||
    kind === "sdk/message_update:text_end" ||
    kind === "sdk/message_update:thinking_start" ||
    kind === "sdk/message_update:thinking_delta" ||
    kind === "sdk/message_update:thinking_end" ||
    kind === "sdk/message_update:toolcall_start" ||
    kind === "sdk/message_update:toolcall_delta" ||
    kind === "sdk/message_update:toolcall_end" ||
    kind === "sdk/message_end:assistant" ||
    kind === "sdk/turn_end"
  ) {
    return { kind, coverage: "noise" };
  }

  return { kind, coverage: "unknown" };
}

function classifyPiToolCallCoverage(
  toolName: string,
): ProviderObservedToolCallCoverage {
  if (PI_WELL_KNOWN_TOOL_NAME_SET.has(toolName)) {
    return "well-known";
  }
  if (PI_ACCEPTED_FALLBACK_TOOL_NAMES.has(toolName)) {
    return "accepted-fallback";
  }
  return "unknown";
}

function toPiObservedToolCalls(event: JsonRpcMessage): ProviderObservedToolCall[] {
  const message = getRawSdkMessage(event);
  if (!message || getStringProperty(message, "type") !== "tool_execution_start") {
    return [];
  }

  const toolName = getStringProperty(message, "toolName");
  if (!toolName) {
    return [];
  }

  return [{
    key: toolName,
    displayName: toolName,
    coverage: classifyPiToolCallCoverage(toolName),
  }];
}

export const piVisibilityMetadata: ProviderVisibilityMetadata = {
  providerId: "pi",
  wellKnownToolNames: PI_WELL_KNOWN_TOOL_NAMES,
  describeRawEvent: toPiRawEventDescription,
  extractObservedToolCalls: toPiObservedToolCalls,
};
