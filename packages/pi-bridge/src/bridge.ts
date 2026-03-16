#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createInterface } from "node:readline";
import {
  translatePiEvent,
  createTurnCounterState,
  type JsonRpcNotification,
  type TurnCounterState,
} from "./event-translator.js";

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
  error?: { code: number; message: string };
}

interface PiThreadSession {
  piProcess: ChildProcess;
  stdoutBuffer: string;
  turnId: string | undefined;
  turnCounter: TurnCounterState;
}

const sessions = new Map<string, PiThreadSession>();

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendToPi(threadSession: PiThreadSession, command: Record<string, unknown>): void {
  if (!threadSession.piProcess.stdin?.writable) return;
  threadSession.piProcess.stdin.write(JSON.stringify(command) + "\n");
}

function onPiOutput(threadId: string, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }

  // Skip pi's command responses — we already sent our JSON-RPC response
  if (parsed.type === "response") return;

  const threadSession = sessions.get(threadId);
  if (!threadSession) return;

  const { notifications, turnId } = translatePiEvent(
    parsed,
    threadId,
    threadSession.turnId,
    threadSession.turnCounter,
  );
  threadSession.turnId = turnId;

  for (const notification of notifications) {
    send(notification);
  }
}

function startPiProcess(
  threadId: string,
  cwd: string,
  model?: string,
  env?: NodeJS.ProcessEnv,
): ChildProcess {
  const args = ["--mode", "rpc", "--no-session"];
  if (model) {
    args.push("--model", model);
  }

  const piProcess = spawn("pi", args, {
    cwd,
    env: env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Read pi's stdout line by line using raw buffer splitting (not readline,
  // which splits on U+2028/U+2029 — pi's docs warn against this).
  let stdoutBuffer = "";
  piProcess.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    while (true) {
      const idx = stdoutBuffer.indexOf("\n");
      if (idx === -1) break;
      let line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      onPiOutput(threadId, line);
    }
  });

  piProcess.on("exit", () => {
    const session = sessions.get(threadId);
    if (session && session.piProcess === piProcess) {
      sessions.delete(threadId);
    }
  });

  return piProcess;
}

function extractEnvOverrides(params: Record<string, unknown>): Record<string, string> {
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
  return envOverrides;
}

function handleRequest(request: JsonRpcRequest): void {
  const { id, method, params } = request;

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
      handleThreadStop(id, params ?? {});
      break;

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

function handleThreadStart(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const threadId =
    typeof params.threadId === "string"
      ? params.threadId
      : `pi-${Date.now()}`;

  // Stop existing session for this thread if any
  const existing = sessions.get(threadId);
  if (existing) {
    existing.piProcess.kill();
    sessions.delete(threadId);
  }

  const cwd =
    typeof params.cwd === "string" ? params.cwd : process.cwd();
  const model =
    typeof params.model === "string" ? params.model : undefined;

  const envOverrides = extractEnvOverrides(params);
  const piEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envOverrides,
  };

  const piProcess = startPiProcess(threadId, cwd, model, piEnv);

  const threadSession: PiThreadSession = {
    piProcess,
    stdoutBuffer: "",
    turnId: undefined,
    turnCounter: createTurnCounterState(),
  };
  sessions.set(threadId, threadSession);

  // Send the initial prompt
  const { text: inputText, images: inputImages } = extractInput(params.input);
  if (inputText) {
    const prompt: Record<string, unknown> = { type: "prompt", message: inputText };
    if (inputImages.length > 0) {
      prompt.images = inputImages;
    }
    sendToPi(threadSession, prompt);
  }

  sendResult(id, { threadId });
}

function handleThreadResume(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const threadId =
    typeof params.threadId === "string"
      ? params.threadId
      : `pi-${Date.now()}`;

  // Stop existing session for this thread if any
  const existing = sessions.get(threadId);
  if (existing) {
    existing.piProcess.kill();
    sessions.delete(threadId);
  }

  const cwd =
    typeof params.cwd === "string" ? params.cwd : process.cwd();
  const model =
    typeof params.model === "string" ? params.model : undefined;

  const envOverrides = extractEnvOverrides(params);
  const piEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envOverrides,
  };

  // Pi doesn't have a built-in resume mechanism via RPC, so we start a fresh
  // session. The Beanbag daemon tracks conversation state externally.
  const piProcess = startPiProcess(threadId, cwd, model, piEnv);

  const threadSession: PiThreadSession = {
    piProcess,
    stdoutBuffer: "",
    turnId: undefined,
    turnCounter: createTurnCounterState(),
  };
  sessions.set(threadId, threadSession);

  sendResult(id, { threadId });
}

function handleTurnStart(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const threadSession = threadId ? sessions.get(threadId) : undefined;
  if (!threadSession) {
    sendError(id, -32000, "No active pi process");
    return;
  }

  const { text: turnText, images: turnImages } = extractInput(params.input);
  if (!turnText) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  const turnPrompt: Record<string, unknown> = { type: "prompt", message: turnText };
  if (turnImages.length > 0) {
    turnPrompt.images = turnImages;
  }
  sendToPi(threadSession, turnPrompt);
  sendResult(id, { threadId });
}

function handleTurnSteer(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const threadSession = threadId ? sessions.get(threadId) : undefined;
  if (!threadSession) {
    sendError(id, -32000, "No active pi process");
    return;
  }

  const { text: steerText, images: steerImages } = extractInput(params.input);
  if (!steerText) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  const steerCmd: Record<string, unknown> = { type: "steer", message: steerText };
  if (steerImages.length > 0) {
    steerCmd.images = steerImages;
  }
  sendToPi(threadSession, steerCmd);
  sendResult(id, { threadId });
}

function handleThreadStop(
  id: string | number,
  params: Record<string, unknown>,
): void {
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  if (threadId) {
    const threadSession = sessions.get(threadId);
    if (threadSession) {
      sendToPi(threadSession, { type: "abort" });
      threadSession.piProcess.kill();
      sessions.delete(threadId);
    }
  }
  sendResult(id, { ok: true });
}

interface PiImage {
  type: "image";
  data: string;
  mimeType: string;
}

interface ExtractedInput {
  text?: string;
  images: PiImage[];
}

function mimeTypeFromExtension(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "image/png";
  }
}

function extractInput(input: unknown): ExtractedInput {
  if (typeof input === "string") return { text: input, images: [] };
  if (!Array.isArray(input)) return { images: [] };

  const chunks: string[] = [];
  const images: PiImage[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const typed = item as {
      type?: string;
      text?: string;
      path?: string;
      url?: string;
      mimeType?: string;
    };

    if (typed.type === "text" && typeof typed.text === "string") {
      chunks.push(typed.text);
    } else if (typed.type === "localImage" && typeof typed.path === "string") {
      try {
        const data = readFileSync(typed.path).toString("base64");
        const mimeType = typed.mimeType ?? mimeTypeFromExtension(typed.path);
        images.push({ type: "image", data, mimeType });
      } catch {
        // Skip unreadable images silently
      }
    } else if (typed.type === "image" && typeof typed.url === "string") {
      // For remote images, we'd need to fetch — skip for now as Pi RPC
      // protocol expects base64 data, not URLs.
    }
  }

  return {
    text: chunks.length > 0 ? chunks.join("\n") : undefined,
    images,
  };
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
  if (
    !request ||
    typeof request !== "object" ||
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string"
  ) {
    return;
  }

  handleRequest(request);
}

// Main entry point
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", handleLine);
rl.on("close", () => {
  for (const threadSession of sessions.values()) {
    threadSession.piProcess.kill();
  }
  sessions.clear();
  process.exit(0);
});
