import type { ThreadEvent, ThreadEventItemStatus } from "@bb/domain";
import { getEventParentToolCallId, type EventMeta } from "./event-decode.js";
import type { ViewFileEditMessage, ViewToolCallMessage, ViewToolCallSummary, ViewToolParsedIntent } from "@bb/domain";
import { durationToString } from "./format-helpers.js";
import {
  extractShellCommandFromString,
  formatToolCallCommand,
  formatToolCallOutput,
  parseShellCommandIntents,
  toolNameToParsedIntents,
} from "./tool-call-parsing.js";
import { toRecord } from "./unknown-helpers.js";

export function itemStatusToToolStatus(status: ThreadEventItemStatus): ViewToolCallMessage["status"] {
  switch (status) {
    case "pending": return "pending";
    case "completed": return "completed";
    case "failed": return "error";
    case "interrupted": return "interrupted";
  }
}

export function itemStatusToFileEditStatus(status: ThreadEventItemStatus): ViewFileEditMessage["status"] {
  switch (status) {
    case "pending": return "pending";
    case "completed": return "completed";
    case "failed": return "error";
    case "interrupted": return "interrupted";
  }
}

export interface ExecCallPartial extends Partial<ViewToolCallSummary> {
  callId: string;
  toolName?: string;
  parsedCmd: ViewToolParsedIntent[];
  parentToolCallId?: string;
}

export interface ExecLifecycleEvent {
  kind: "begin" | "end" | "output";
  call: ExecCallPartial;
  appendOutput?: boolean;
}

function toExecDefaultStatus(kind: "begin" | "end"): ViewToolCallMessage["status"] {
  if (kind === "begin") return "pending";
  return "completed";
}

export function parseExecLifecycleEvent(
  decoded: ThreadEvent,
  _meta: EventMeta,
  parentToolCallIdOverride?: string,
): ExecLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (decoded.type === "item/commandExecution/outputDelta") {
    const callId = decoded.itemId;
    if (!callId) return null;
    return {
      kind: "output",
      call: {
        callId,
        parsedCmd: [],
        output: decoded.delta,
        status: "pending",
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
      appendOutput: true,
    };
  }

  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "commandExecution"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    const kind = decoded.type === "item/started" ? "begin" : "end";
    const exitCode = decoded.item.exitCode;
    const status =
      exitCode !== undefined && exitCode !== 0
        ? "error"
        : (itemStatusToToolStatus(decoded.item.status) ??
            toExecDefaultStatus(kind));

    const command = extractShellCommandFromString(decoded.item.command);
    return {
      kind,
      call: {
        callId,
        command,
        cwd: decoded.item.cwd,
        parsedCmd: parseShellCommandIntents(command),
        output: decoded.item.aggregatedOutput,
        exitCode,
        durationMs: decoded.item.durationMs,
        duration: durationToString(decoded.item.durationMs),
        status,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
    };
  }

  return null;
}

export function parseToolCallLifecycleEvent(
  decoded: ThreadEvent,
  _meta: EventMeta,
  parentToolCallIdOverride?: string,
): ExecLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (decoded.type === "item/started" || decoded.type === "item/completed") {
    if (decoded.item.type !== "toolCall") return null;

    const callId = decoded.item.id;
    if (!callId) return null;
    const toolName = decoded.item.tool ?? "tool";
    const serverPrefix = decoded.item.server ? `${decoded.item.server}:` : "";
    const fullToolName = `${serverPrefix}${toolName}`;
    const parsedArgs = toRecord(decoded.item.arguments);

    const kind = decoded.type === "item/started" ? "begin" : "end";
    const status = kind === "end"
      ? (itemStatusToToolStatus(decoded.item.status) ?? "completed")
      : "pending";
    const result = decoded.item.result;
    const rawOutput = typeof result === "string"
      ? result
      : (result !== undefined ? JSON.stringify(result) : undefined);
    const output = rawOutput !== undefined
      ? formatToolCallOutput(fullToolName, rawOutput)
      : undefined;
    const errorField = decoded.item.error;

    return {
      kind,
      call: {
        callId,
        toolName: fullToolName,
        command: formatToolCallCommand(fullToolName, parsedArgs),
        parsedCmd: toolNameToParsedIntents(fullToolName, parsedArgs),
        output: kind === "end" ? (output ?? errorField) : undefined,
        durationMs: decoded.item.durationMs,
        duration: durationToString(decoded.item.durationMs),
        status,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      },
    };
  }

  return null;
}
