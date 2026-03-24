import { z } from "zod";
import type { Thread } from "./thread.js";
import type { ThreadEventRow } from "./thread-events.js";

export const viewMessageStatusValues = [
  "streaming",
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export const viewMessageStatusSchema = z.enum(viewMessageStatusValues);
export type ViewMessageStatus = z.infer<typeof viewMessageStatusSchema>;

export interface ViewMessageBase {
  id: string;
  threadId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt?: number;
  turnId?: string;
}

export interface ViewUserMessage extends ViewMessageBase {
  kind: "user";
  text: string;
  attachments?: {
    webImages: number;
    localImages: number;
    localFiles: number;
    imageUrls?: string[];
    localImagePaths?: string[];
    localFilePaths?: string[];
  };
}

export interface ViewAssistantReasoningMessage extends ViewMessageBase {
  kind: "assistant-reasoning";
  text: string;
  status: Extract<ViewMessageStatus, "streaming" | "completed">;
}

export interface ViewAssistantTextMessage extends ViewMessageBase {
  kind: "assistant-text";
  text: string;
  status: Extract<ViewMessageStatus, "streaming" | "completed">;
}

export type ViewToolParsedIntent =
  | {
      type: "read";
      cmd: string;
      name: string;
      path: string | null;
    }
  | {
      type: "list_files";
      cmd: string;
      path: string | null;
    }
  | {
      type: "search";
      cmd: string;
      query: string | null;
      path: string | null;
    }
  | {
      type: "unknown";
      cmd: string;
    };

export interface ViewToolCallSummary {
  callId: string;
  command?: string;
  cwd?: string;
  parsedCmd: ViewToolParsedIntent[];
  source?: string;
  output?: string;
  exitCode?: number;
  duration?: string;
  durationMs?: number;
  status: Extract<
    ViewMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export interface ViewToolExploringMessage extends ViewMessageBase {
  kind: "tool-exploring";
  status: Extract<ViewMessageStatus, "pending" | "completed">;
  calls: ViewToolCallSummary[];
}

export interface ViewToolCallMessage extends ViewMessageBase {
  kind: "tool-call";
  toolName: string;
  callId: string;
  command?: string;
  cwd?: string;
  parsedCmd?: ViewToolParsedIntent[];
  source?: string;
  output?: string;
  exitCode?: number;
  duration?: string;
  durationMs?: number;
  status: Extract<
    ViewMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export interface ViewWebSearchMessage extends ViewMessageBase {
  kind: "web-search";
  callId: string;
  query?: string;
  action?: string;
  status: Extract<ViewMessageStatus, "pending" | "completed">;
}

export interface ViewFileEditChange {
  path: string;
  kind?: string;
  movePath?: string | null;
  diff?: string;
}

export interface ViewFileEditMessage extends ViewMessageBase {
  kind: "file-edit";
  callId: string;
  changes: ViewFileEditChange[];
  stdout?: string;
  stderr?: string;
  status: Extract<
    ViewMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
}

export interface ViewThreadOperationMetadata {
  operation: string;
  status: string;
  operationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ViewProvisioningTranscriptEntry {
  type: "step" | "output";
  key: string;
  text: string;
  startedAt?: number;
  status?: "started" | "completed" | "failed";
  metadata?: Record<string, unknown>;
}

export interface ViewProvisioningMetadata {
  environmentId?: string;
  transcript?: ViewProvisioningTranscriptEntry[];
}

export interface ViewOperationMessage extends ViewMessageBase {
  kind: "operation";
  opType: string;
  title: string;
  detail?: string;
  status?: Extract<
    ViewMessageStatus,
    "pending" | "completed" | "error" | "interrupted"
  >;
  provisioning?: ViewProvisioningMetadata;
  threadOperation?: ViewThreadOperationMetadata;
}

export interface ViewErrorMessage extends ViewMessageBase {
  kind: "error";
  message: string;
  rawType: string;
}

export interface ViewDebugRawEventMessage extends ViewMessageBase {
  kind: "debug/raw-event";
  rawType: string;
  rawEvent: ThreadEventRow;
  reason: "ignored-noise" | "duplicate-event" | "unhandled";
}

export type ViewMessage =
  | ViewUserMessage
  | ViewAssistantReasoningMessage
  | ViewAssistantTextMessage
  | ViewToolExploringMessage
  | ViewToolCallMessage
  | ViewWebSearchMessage
  | ViewFileEditMessage
  | ViewOperationMessage
  | ViewErrorMessage
  | ViewDebugRawEventMessage;

export interface ToViewMessagesOptions {
  includeDebugRawEvents?: boolean;
  includeOptionalOperations?: boolean;
  includeInternalSystemMessages?: boolean;
  threadStatus?: Thread["status"];
  threadType?: Thread["type"];
}

export const viewMessageSchema = z.custom<ViewMessage>();
