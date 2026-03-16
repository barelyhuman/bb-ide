#!/usr/bin/env node

import { createInterface } from "node:readline";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SdkSession, type SdkSessionOptions } from "./sdk-session.js";
import {
  translateSdkMessage,
  resetTurnCounter,
  type JsonRpcNotification,
} from "./event-translator.js";
import {
  buildBridgeMcpServer,
  getAllowedToolNames,
  BRIDGE_MCP_SERVER_NAME,
  type DynamicToolDefinition,
  type ToolCallForwarder,
} from "./tool-proxy-mcp.js";

export const BRIDGE_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "turn/start",
  "turn/steer",
  "thread/stop",
] as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingToolCall {
  resolve: (value: { content: string; isError?: boolean }) => void;
}

let session: SdkSession | undefined;
let currentThreadId: string | undefined;
let currentTurnId: string | undefined;
const pendingToolCalls = new Map<string | number, PendingToolCall>();
let toolCallRequestIdCounter = 0;

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(
  id: string | number,
  code: number,
  message: string,
): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  send({ jsonrpc: "2.0", method, params });
}

function onSdkMessage(message: SDKMessage): void {
  if (!currentThreadId) return;

  const { notifications, turnId } = translateSdkMessage(
    message,
    currentThreadId,
    currentTurnId,
  );
  currentTurnId = turnId;

  for (const notification of notifications) {
    send(notification);
  }
}

function onSdkDone(_error?: unknown): void {
  // Stream ended; session remains available for resume.
}

const forwardToolCall: ToolCallForwarder = (toolName, args) => {
  return new Promise<{ content: string; isError?: boolean }>((resolve) => {
    toolCallRequestIdCounter += 1;
    const requestId = toolCallRequestIdCounter;
    pendingToolCalls.set(requestId, { resolve });
    send({
      jsonrpc: "2.0",
      id: requestId,
      method: "item/tool/call",
      params: {
        threadId: currentThreadId ?? "",
        turnId: currentTurnId ?? "",
        callId: `call-${requestId}`,
        tool: toolName,
        arguments: args,
      },
    } as unknown as JsonRpcResponse);
  });
};

function handleRequest(request: JsonRpcRequest): void {
  const { id, method, params } = request;

  // Check if this is a response to a pending tool call request
  if (
    id !== undefined &&
    pendingToolCalls.has(id) &&
    "result" in request
  ) {
    const pending = pendingToolCalls.get(id)!;
    pendingToolCalls.delete(id);
    const result = (request as unknown as { result: unknown }).result;
    const record = result as Record<string, unknown> | undefined;
    const contentItems = record?.contentItems as
      | Array<{ type: string; text?: string }>
      | undefined;
    const text =
      contentItems
        ?.filter((item) => item.type === "inputText" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n") ?? "OK";
    pending.resolve({
      content: text,
      isError: (record?.success as boolean | undefined) === false,
    });
    return;
  }

  switch (method) {
    case "initialize":
      sendResult(id, { ok: true });
      break;

    case "thread/start":
      handleThreadStart(id, params ?? {});
      break;

    case "thread/resume":
      handleThreadResume(id, params ?? {});
      break;

    case "turn/start":
      handleTurnStart(id, params ?? {});
      break;

    case "turn/steer":
      handleTurnSteer(id, params ?? {});
      break;

    case "thread/stop":
      handleThreadStop(id);
      break;

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

function handleThreadStart(
  id: string | number,
  params: Record<string, unknown>,
): void {
  if (session) {
    session.stop();
  }

  resetTurnCounter();
  currentTurnId = undefined;

  const systemPrompt =
    typeof params.baseInstructions === "string"
      ? params.baseInstructions
      : "You are a helpful coding assistant.";
  const model =
    typeof params.model === "string" ? params.model : undefined;
  const cwd =
    typeof params.cwd === "string" ? params.cwd : process.cwd();

  const envOverrides: Record<string, string> = {};
  const config = params.config as Record<string, unknown> | undefined;
  if (config) {
    for (const [key, value] of Object.entries(config)) {
      if (
        key.startsWith("shell_environment_policy.set.") &&
        typeof value === "string"
      ) {
        const envVar = key.slice("shell_environment_policy.set.".length);
        envOverrides[envVar] = value;
      }
    }
  }

  const sessionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envOverrides,
    CLAUDE_AGENT_SDK_CLIENT_APP: "beanbag/1.0.0",
  };

  const sessionOptions: SdkSessionOptions = {
    cwd,
    systemPrompt,
    model,
    env: sessionEnv,
  };

  // Set up dynamic tools if provided
  const dynamicTools = params.dynamicTools as
    | DynamicToolDefinition[]
    | undefined;
  if (dynamicTools && dynamicTools.length > 0) {
    const mcpServer = buildBridgeMcpServer(dynamicTools, forwardToolCall);
    sessionOptions.mcpServers = {
      [BRIDGE_MCP_SERVER_NAME]: mcpServer,
    };
    sessionOptions.allowedTools = getAllowedToolNames(dynamicTools);
  }

  session = new SdkSession(sessionOptions, onSdkMessage, onSdkDone);
  session.start();

  const input = extractInputText(params.input);
  if (input) {
    session.pushInput(input);
  }

  // The threadId will be the session ID once captured; for now use a placeholder
  currentThreadId = `bridge-${Date.now()}`;

  sendResult(id, { threadId: currentThreadId });
}

function handleThreadResume(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : undefined;
  const threadId =
    typeof params.threadId === "string" ? params.threadId : undefined;

  if (session) {
    session.stop();
  }

  resetTurnCounter();
  currentTurnId = undefined;
  currentThreadId = threadId ?? `bridge-${Date.now()}`;

  const systemPrompt =
    typeof params.baseInstructions === "string"
      ? params.baseInstructions
      : "You are a helpful coding assistant.";
  const model =
    typeof params.model === "string" ? params.model : undefined;
  const cwd =
    typeof params.cwd === "string" ? params.cwd : process.cwd();

  const sessionOptions: SdkSessionOptions = {
    cwd,
    systemPrompt,
    model,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "beanbag/1.0.0" },
  };

  session = new SdkSession(sessionOptions, onSdkMessage, onSdkDone);
  session.start(sessionId);

  sendResult(id, { threadId: currentThreadId });
}

function handleTurnStart(
  id: string | number,
  params: Record<string, unknown>,
): void {
  if (!session) {
    sendError(id, -32000, "No active session");
    return;
  }

  const input = extractInputText(params.input);
  if (!input) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  session.pushInput(input);
  sendResult(id, { threadId: currentThreadId });
}

function handleTurnSteer(
  id: string | number,
  params: Record<string, unknown>,
): void {
  if (!session) {
    sendError(id, -32000, "No active session");
    return;
  }

  const input = extractInputText(params.input);
  if (!input) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  session.pushInput(input);
  sendResult(id, { threadId: currentThreadId });
}

function handleThreadStop(id: string | number): void {
  if (session) {
    session.stop();
    session = undefined;
  }
  currentTurnId = undefined;
  sendResult(id, { ok: true });
}

function extractInputText(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return undefined;

  const chunks: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const typed = item as { type?: string; text?: string };
    if (typed.type === "text" && typeof typed.text === "string") {
      chunks.push(typed.text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const request = parsed as JsonRpcRequest;
  if (!request || typeof request !== "object" || request.jsonrpc !== "2.0") {
    return;
  }

  // Handle tool call responses (they come back as JSON-RPC responses)
  if ("result" in request && pendingToolCalls.has(request.id)) {
    handleRequest(request);
    return;
  }

  if (typeof request.method !== "string") return;
  handleRequest(request);
}

// Main entry point
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", handleLine);
rl.on("close", () => {
  if (session) {
    session.stop();
  }
  process.exit(0);
});
