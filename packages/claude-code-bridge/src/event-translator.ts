import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

let turnCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${turnCounter}`;
}

export function resetTurnCounter(): void {
  turnCounter = 0;
}

export function translateSdkMessage(
  message: SDKMessage,
  threadId: string,
  currentTurnId: string | undefined,
): { notifications: JsonRpcNotification[]; turnId: string | undefined } {
  const notifications: JsonRpcNotification[] = [];
  let turnId = currentTurnId;

  switch (message.type) {
    case "system":
      // Capture session_id only; no notification emitted for system init.
      break;

    case "assistant": {
      if (!turnId) {
        turnId = nextTurnId();
        notifications.push({
          jsonrpc: "2.0",
          method: "turn/started",
          params: { threadId, turnId },
        });
      }

      const text = extractAssistantText(message);
      if (text) {
        notifications.push({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId,
            turnId,
            item: { normalizedType: "agentmessage", text: { text } },
          },
        });
      }

      const toolUses = extractToolUses(message);
      for (const toolUse of toolUses) {
        notifications.push({
          jsonrpc: "2.0",
          method: "item/started",
          params: {
            threadId,
            turnId,
            item: {
              normalizedType: "toolcall",
              callId: toolUse.id,
              tool: toolUse.name,
              arguments: toolUse.input,
            },
          },
        });
      }
      break;
    }

    case "stream_event": {
      const delta = extractStreamTextDelta(message);
      if (delta && turnId) {
        notifications.push({
          jsonrpc: "2.0",
          method: "item/agentMessage/delta",
          params: { threadId, turnId, delta },
        });
      }
      break;
    }

    case "user": {
      const toolResults = extractToolResults(message);
      for (const result of toolResults) {
        notifications.push({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId,
            turnId: turnId ?? "",
            item: {
              normalizedType: "toolresult",
              callId: result.toolUseId,
              output: result.content,
            },
          },
        });
      }
      break;
    }

    case "result": {
      const resultMessage = message as SDKResultMessage;
      if (turnId) {
        notifications.push({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId,
            turnId,
            result: {
              subtype: resultMessage.subtype,
            },
          },
        });
        turnId = undefined;
      }
      break;
    }

    default:
      break;
  }

  return { notifications, turnId };
}

function extractAssistantText(
  message: Extract<SDKMessage, { type: "assistant" }>,
): string | undefined {
  const content = (message.message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return undefined;

  const chunks: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      chunks.push((block as { text: string }).text);
    }
  }

  const text = chunks.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function extractToolUses(
  message: Extract<SDKMessage, { type: "assistant" }>,
): Array<{ id: string; name: string; input: unknown }> {
  const content = (message.message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];

  const uses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as {
      type?: unknown;
      id?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (
      typed.type === "tool_use" &&
      typeof typed.id === "string" &&
      typeof typed.name === "string"
    ) {
      uses.push({ id: typed.id, name: typed.name, input: typed.input });
    }
  }
  return uses;
}

function extractStreamTextDelta(
  message: Extract<SDKMessage, { type: "stream_event" }>,
): string | undefined {
  const event = message.event as {
    type?: unknown;
    delta?: { type?: unknown; text?: unknown };
    content_block?: { type?: unknown; text?: unknown };
  } | undefined;

  if (!event) return undefined;

  if (event.type === "content_block_delta") {
    if (
      event.delta?.type === "text_delta" &&
      typeof event.delta.text === "string" &&
      event.delta.text.length > 0
    ) {
      return event.delta.text;
    }
  }

  if (event.type === "content_block_start") {
    if (
      event.content_block?.type === "text" &&
      typeof event.content_block.text === "string" &&
      event.content_block.text.length > 0
    ) {
      return event.content_block.text;
    }
  }

  return undefined;
}

function extractToolResults(
  message: Extract<SDKMessage, { type: "user" }>,
): Array<{ toolUseId: string; content: unknown }> {
  const results: Array<{ toolUseId: string; content: unknown }> = [];

  const content = (message.message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return results;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as {
      type?: unknown;
      tool_use_id?: unknown;
      content?: unknown;
    };
    if (
      typed.type === "tool_result" &&
      typeof typed.tool_use_id === "string"
    ) {
      results.push({
        toolUseId: typed.tool_use_id,
        content: typed.content,
      });
    }
  }

  return results;
}
