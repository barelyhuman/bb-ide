export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export interface TurnCounterState {
  turnCounter: number;
}

export function createTurnCounterState(): TurnCounterState {
  return { turnCounter: 0 };
}

function nextTurnId(state: TurnCounterState): string {
  state.turnCounter += 1;
  return `turn-${state.turnCounter}`;
}

export function translatePiEvent(
  event: Record<string, unknown>,
  threadId: string,
  currentTurnId: string | undefined,
  counterState: TurnCounterState,
): { notifications: JsonRpcNotification[]; turnId: string | undefined } {
  const notifications: JsonRpcNotification[] = [];
  let turnId = currentTurnId;
  const eventType = event.type as string;

  switch (eventType) {
    case "agent_start":
      if (!turnId) {
        turnId = nextTurnId(counterState);
        notifications.push({
          jsonrpc: "2.0",
          method: "turn/started",
          params: { threadId, turnId },
        });
      }
      break;

    case "agent_end": {
      const messages = event.messages as Array<Record<string, unknown>> | undefined;
      const lastAssistant = messages
        ?.filter((m) => m.role === "assistant")
        .pop();
      if (lastAssistant) {
        const text = extractAssistantText(lastAssistant);
        if (text) {
          notifications.push({
            jsonrpc: "2.0",
            method: "item/completed",
            params: {
              threadId,
              turnId: turnId ?? "",
              item: { type: "agentMessage", text },
            },
          });
        }
      }
      if (turnId) {
        notifications.push({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { threadId, turnId },
        });
        turnId = undefined;
      }
      break;
    }

    case "message_update": {
      const assistantEvent = event.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      if (assistantEvent?.type === "text_delta" && turnId) {
        const delta = assistantEvent.delta as string | undefined;
        if (delta) {
          notifications.push({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: { threadId, turnId, delta },
          });
        }
      }
      break;
    }

    case "tool_execution_start": {
      if (turnId) {
        const toolName = event.toolName as string;
        notifications.push({
          jsonrpc: "2.0",
          method: "item/started",
          params: {
            threadId,
            turnId,
            item: translateToolCallToItem(
              event.toolCallId as string,
              toolName,
              event.args,
            ),
          },
        });
      }
      break;
    }

    case "tool_execution_end": {
      if (turnId) {
        const toolName = event.toolName as string;
        notifications.push({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId,
            turnId: turnId,
            item: translateToolResultToItem(
              event.toolCallId as string,
              toolName,
              event.result,
              (event.isError as boolean) ?? false,
            ),
          },
        });
      }
      break;
    }

    default:
      break;
  }

  return { notifications, turnId };
}

// Well-known tool name sets for semantic translation
const BASH_TOOLS = new Set(["Bash", "bash"]);
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "edit", "write"]);
const WEB_SEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);

function translateToolCallToItem(
  callId: string,
  toolName: string,
  args: unknown,
): Record<string, unknown> {
  const argsRecord =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  if (BASH_TOOLS.has(toolName)) {
    return {
      type: "commandExecution",
      id: callId,
      command: argsRecord.command ?? "",
      cwd: argsRecord.cwd,
      status: "running",
    };
  }

  if (FILE_EDIT_TOOLS.has(toolName)) {
    const filePath =
      (argsRecord.file_path as string | undefined) ??
      (argsRecord.path as string | undefined) ??
      "";
    return {
      type: "filechange",
      id: callId,
      changes: [
        {
          path: filePath,
          kind: { type: "update" },
        },
      ],
    };
  }

  if (WEB_SEARCH_TOOLS.has(toolName)) {
    return {
      type: "webSearch",
      id: callId,
      query: argsRecord.query ?? argsRecord.url ?? "",
    };
  }

  // Generic tool call — use custom_tool_call shape
  return {
    type: "custom_tool_call",
    call_id: callId,
    name: toolName,
    input: JSON.stringify(args ?? {}),
  };
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;

  // Handle { content: [...] } wrapper objects (Pi tool results)
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const wrapper = content as { content?: unknown };
    if (Array.isArray(wrapper.content)) {
      return extractResultText(wrapper.content);
    }
    return JSON.stringify(content);
  }

  if (!Array.isArray(content)) return JSON.stringify(content ?? "");

  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      chunks.push(typed.text);
    }
  }
  return chunks.join("\n");
}

function translateToolResultToItem(
  callId: string,
  toolName: string,
  content: unknown,
  isError: boolean,
): Record<string, unknown> {
  const outputText = extractResultText(content);

  if (BASH_TOOLS.has(toolName)) {
    return {
      type: "commandExecution",
      id: callId,
      aggregatedOutput: outputText,
      exitCode: isError ? 1 : 0,
      status: isError ? "error" : "completed",
    };
  }

  if (FILE_EDIT_TOOLS.has(toolName)) {
    return {
      type: "filechange",
      id: callId,
      stdout: outputText,
      status: isError ? "error" : "completed",
    };
  }

  if (WEB_SEARCH_TOOLS.has(toolName)) {
    return {
      type: "webSearch",
      id: callId,
      status: isError ? "error" : "completed",
    };
  }

  // Generic tool result
  return {
    type: "custom_tool_call_output",
    call_id: callId,
    output: outputText,
  };
}

function extractAssistantText(
  message: Record<string, unknown>,
): string | undefined {
  const content = message.content;
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
