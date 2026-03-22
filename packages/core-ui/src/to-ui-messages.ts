import type {
  ProvisioningTranscriptEntry,
  PromptInput,
  ThreadEvent,
  ThreadEventFileChange,
  ThreadEventItemStatus,
  ThreadEventPlanStepStatus,
  ThreadEventRow,
} from "@bb/domain";
import { assertNever } from "./assert-never.js";
import { getStringField } from "./unknown-helpers.js";
import type {
  ToUIMessagesOptions,
  UIAssistantReasoningMessage,
  UIAssistantTextMessage,
  UIDebugRawEventMessage,
  UIErrorMessage,
  UIFileEditChange,
  UIFileEditMessage,
  UIMessage,
  UIOperationMessage,
  UIProvisioningSetupStatus,
  UIProvisioningTranscriptEntry,
  UIThreadOperationMetadata,
  UIToolCallMessage,
  UIToolCallSummary,
  UIToolExploringMessage,
  UIToolParsedIntent,
  UIWebSearchMessage,
  UIWorktreeCommitMetadata,
  UIWorktreeSquashMergeMetadata,
  UIUserMessage,
} from "./ui-message.js";

/** Row metadata that travels alongside the decoded event. */
interface EventMeta {
  id: string;
  seq: number;
  createdAt: number;
}

function decodeRow(row: ThreadEventRow): { event: ThreadEvent; meta: EventMeta } {
  const data = row.data as Record<string, unknown>;
  return {
    event: { type: row.type, threadId: row.threadId, ...data } as ThreadEvent,
    meta: { id: row.id, seq: row.seq, createdAt: row.createdAt },
  };
}

function getFirstStringField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = getStringField(record, key);
    if (value) return value;
  }
  return undefined;
}

function parsePromptInput(input: PromptInput[] | undefined): {
  text: string;
  webImages: number;
  localImages: number;
  localFiles: number;
  imageUrls: string[];
  localImagePaths: string[];
  localFilePaths: string[];
} | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const textParts: string[] = [];
  let webImages = 0;
  let localImages = 0;
  let localFiles = 0;
  const imageUrls: string[] = [];
  const localImagePaths: string[] = [];
  const localFilePaths: string[] = [];

  for (const part of input) {
    switch (part.type) {
      case "text":
        if (part.text.length > 0) {
          textParts.push(part.text);
        }
        break;
      case "image":
        webImages += 1;
        if (part.url.length > 0) {
          imageUrls.push(part.url);
        }
        break;
      case "localImage":
        localImages += 1;
        if (part.path.length > 0) {
          localImagePaths.push(part.path);
        }
        break;
      case "localFile":
        localFiles += 1;
        if (part.path.length > 0) {
          localFilePaths.push(part.path);
        }
        break;
    }
  }

  const text = textParts.join("");
  if (!text && webImages === 0 && localImages === 0 && localFiles === 0) {
    return null;
  }

  return {
    text,
    webImages,
    localImages,
    localFiles,
    imageUrls,
    localImagePaths,
    localFilePaths,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function threadOperationTitle(meta: UIThreadOperationMetadata | null): string {
  if (!meta) return "Operation update";

  const { operation, status, metadata } = meta;

  switch (operation) {
    case "commit":
      switch (status) {
        case "running":
          return "Committing changes";
        case "completed":
          return "Changes committed";
        case "failed":
          return "Commit failed";
        case "requested":
          return "Commit requested";
        case "queued":
          return "Commit queued";
        case "noop":
          return "No commit needed";
        default:
          return `Commit ${status}`;
      }
    case "squash_merge":
      switch (status) {
        case "running":
          return "Squash merging";
        case "completed":
          return "Squash merged";
        case "failed":
          return "Squash merge failed";
        case "requested":
          return "Squash merge requested";
        case "queued":
          return "Squash merge queued";
        case "noop":
          return "No squash merge needed";
        default:
          return `Squash merge ${status}`;
      }
    case "primary_checkout": {
      const action = typeof metadata?.action === "string" ? metadata.action : undefined;
      const verb = action === "demote" ? "Demoting from" : "Promoting to";
      const past = action === "demote" ? "Demoted from" : "Promoted to";
      switch (status) {
        case "started":
        case "running":
          return `${verb} primary checkout`;
        case "completed":
          return `${past} primary checkout`;
        case "failed":
          return `Primary checkout ${action ?? "update"} failed`;
        case "noop":
          return `Primary checkout already ${action === "demote" ? "demoted" : "promoted"}`;
        default:
          return `Primary checkout ${status}`;
      }
    }
    case "ownership_change": {
      const action = typeof metadata?.action === "string" ? metadata.action : undefined;
      switch (status) {
        case "completed":
          return action === "release"
            ? "Thread management transferred"
            : "Thread assigned to manager";
        case "failed":
          return "Ownership change failed";
        default:
          return `Ownership change ${status}`;
      }
    }
    default:
      // open_external: unknown operations get a generic label.
      return `${capitalize(operation.replace(/_/g, " "))} ${status}`;
  }
}

function threadOperationStatus(
  meta: UIThreadOperationMetadata | null,
): UIOperationMessage["status"] {
  if (!meta) return undefined;
  switch (meta.status) {
    case "requested":
    case "queued":
    case "running":
    case "started":
      return "pending";
    case "completed":
    case "noop":
      return "completed";
    case "failed":
      return "error";
    default:
      // open_external: unknown statuses treated as pending.
      return "pending";
  }
}

function provisioningSetupOperationStatus(
  status: UIProvisioningSetupStatus | undefined,
): UIOperationMessage["status"] {
  if (!status) return undefined;
  switch (status) {
    case "started":
    case "running":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return assertNever(status);
  }
}

function provisioningProgressOperationStatus(
  status: "started" | "completed" | "failed" | undefined,
): UIOperationMessage["status"] {
  if (!status) return undefined;
  switch (status) {
    case "started":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return assertNever(status);
  }
}

function userMessageSignature(value: {
  text: string;
  webImages: number;
  localImages: number;
  localFiles: number;
}): string {
  const totalImages = value.webImages + value.localImages;
  return `${value.text}\u0000${totalImages}\u0000${value.localFiles}`;
}

function shouldRenderThreadStartInput(
  threadStatus: ToUIMessagesOptions["threadStatus"] | undefined,
): boolean {
  if (!threadStatus) return false;
  switch (threadStatus) {
    case "created":
    case "provisioning":
    case "provisioned":
    case "provisioning_failed":
    case "error":
    case "idle":
    case "active":
      return true;
    default:
      return assertNever(threadStatus);
  }
}

function shouldPreservePendingMessages(
  threadStatus: ToUIMessagesOptions["threadStatus"] | undefined,
): boolean {
  if (!threadStatus) return false;
  switch (threadStatus) {
    case "provisioning":
    case "provisioned":
    case "active":
      return true;
    case "created":
    case "provisioning_failed":
    case "error":
    case "idle":
      return false;
    default:
      return assertNever(threadStatus);
  }
}

function messageId(threadId: string, kind: string, key: string): string {
  return `${threadId}:${kind}:${key}`;
}

function parseUserFromItemEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
): UIUserMessage | null {
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return null;
  }
  if (decoded.item.type !== "userMessage") return null;

  const parsedContent = parsePromptInput(decoded.item.content as PromptInput[]);
  if (!parsedContent) return null;

  const { turnId } = decoded;
  const itemId = decoded.item.id ?? `${meta.seq}`;

  return {
    kind: "user",
    id: messageId(decoded.threadId, "user", itemId),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    text: parsedContent.text,
    attachments: {
      webImages: parsedContent.webImages,
      localImages: parsedContent.localImages,
      localFiles: parsedContent.localFiles,
      ...(parsedContent.imageUrls.length > 0 ? { imageUrls: parsedContent.imageUrls } : {}),
      ...(parsedContent.localImagePaths.length > 0 ? { localImagePaths: parsedContent.localImagePaths } : {}),
      ...(parsedContent.localFilePaths.length > 0 ? { localFilePaths: parsedContent.localFilePaths } : {}),
    },
  };
}

function parseUserFromClientStart(
  decoded: ThreadEvent,
  meta: EventMeta,
  options?: ToUIMessagesOptions,
): UIUserMessage | null {
  if (
    decoded.type !== "client/thread/start" &&
    decoded.type !== "client/turn/requested" &&
    decoded.type !== "client/turn/start"
  ) {
    return null;
  }

  if (
    decoded.initiator === "system" &&
    !options?.includeInternalSystemMessages
  ) {
    return null;
  }
  const parsedInput = parsePromptInput(decoded.input);
  if (!parsedInput) return null;
  if (!shouldRenderThreadStartInput(options?.threadStatus)) {
    return null;
  }

  return {
    kind: "user",
    id: messageId(decoded.threadId, "user-seed", `${meta.seq}`),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    text: parsedInput.text,
    attachments: {
      webImages: parsedInput.webImages,
      localImages: parsedInput.localImages,
      localFiles: parsedInput.localFiles,
      ...(parsedInput.imageUrls.length > 0
        ? { imageUrls: parsedInput.imageUrls }
        : {}),
      ...(parsedInput.localImagePaths.length > 0
        ? { localImagePaths: parsedInput.localImagePaths }
        : {}),
      ...(parsedInput.localFilePaths.length > 0
        ? { localFilePaths: parsedInput.localFilePaths }
        : {}),
    },
  };
}

function parseManagerUserMessage(
  decoded: ThreadEvent,
  meta: EventMeta,
): UIAssistantTextMessage | null {
  if (decoded.type !== "system/manager/user_message") {
    return null;
  }

  const { text, turnId } = decoded;
  if (!text) {
    return null;
  }

  return {
    kind: "assistant-text",
    id: messageId(decoded.threadId, "assistant", `manager:${meta.seq}`),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    text,
    status: "completed",
  };
}

function parseAssistantDeltaText(
  decoded: ThreadEvent,
): string | null {
  if (decoded.type !== "item/agentMessage/delta") {
    return null;
  }

  return decoded.delta.length > 0 ? decoded.delta : null;
}

function parseAssistantFinalText(
  decoded: ThreadEvent,
): string | null {
  if (decoded.type !== "item/completed") return null;
  if (decoded.item.type !== "agentMessage") return null;
  return decoded.item.text.length > 0 ? decoded.item.text : null;
}

function parseReasoningDeltaText(
  decoded: ThreadEvent,
): string | null {
  if (
    decoded.type !== "item/reasoning/summaryTextDelta" &&
    decoded.type !== "item/reasoning/textDelta"
  ) {
    return null;
  }

  return decoded.delta.length > 0 ? decoded.delta : null;
}

function parseReasoningFinalText(
  decoded: ThreadEvent,
): string | null {
  if (decoded.type !== "item/completed") return null;
  if (decoded.item.type !== "reasoning") return null;
  const summaryText = decoded.item.summary.join("");
  const contentText = decoded.item.content.join("");
  const text = summaryText || contentText;
  return text.length > 0 ? text : null;
}

function itemStatusToToolStatus(status: ThreadEventItemStatus): UIToolCallMessage["status"] {
  switch (status) {
    case "pending": return "pending";
    case "completed": return "completed";
    case "failed": return "error";
    case "interrupted": return "interrupted";
  }
}

function itemStatusToFileEditStatus(status: ThreadEventItemStatus): UIFileEditMessage["status"] {
  switch (status) {
    case "pending": return "pending";
    case "completed": return "completed";
    case "failed": return "error";
    case "interrupted": return "interrupted";
  }
}

const SHELL_WRAPPER_NAMES = new Set(["sh", "bash", "zsh"]);

function unwrapQuotedShellArg(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return value;
  }
  return value.slice(1, -1);
}

function isKnownShellWrapper(value: string): boolean {
  const shellName = value.split("/").pop() ?? value;
  // Shell wrapper names are open_external runtime values; unknown shells intentionally
  // preserve the original command payload for display.
  return SHELL_WRAPPER_NAMES.has(shellName);
}

function extractShellCommandFromString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const match = /^(\S+)\s+(-lc|-c)\s+([\s\S]+)$/.exec(trimmed);
  if (!match) return trimmed;

  const shellProgram = match[1];
  const commandArg = match[3];
  if (!shellProgram || !commandArg || !isKnownShellWrapper(shellProgram)) {
    return trimmed;
  }

  return unwrapQuotedShellArg(commandArg.trim());
}


function provisioningProgressTitle(
  phase: "prepare_environment" | "start_provider_session" | undefined,
  status: "started" | "completed" | "failed" | undefined,
): string {
  switch (phase) {
    case "prepare_environment":
      switch (status) {
        case "started":
          return "Preparing environment";
        case "completed":
          return "Environment prepared";
        case "failed":
          return "Environment preparation failed";
        default:
          return "Provisioning progress";
      }
    case "start_provider_session":
      switch (status) {
        case "started":
          return "Starting provider session";
        case "completed":
          return "Provider session started";
        case "failed":
          return "Provider session start failed";
        default:
          return "Provisioning progress";
      }
    default:
      return "Provisioning progress";
  }
}

function readProvisioningTranscript(
  transcript: ProvisioningTranscriptEntry[] | undefined,
): UIProvisioningTranscriptEntry[] | undefined {
  if (!Array.isArray(transcript) || transcript.length === 0) return undefined;

  const entries: UIProvisioningTranscriptEntry[] = [];
  for (const entry of transcript) {
    const key = entry.key?.trim();
    const text = entry.text?.trim();
    if (!key || !text) continue;

    entries.push({
      key,
      text,
      ...(entry.startedAt !== undefined ? { startedAt: entry.startedAt } : {}),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    });
  }

  return entries.length > 0 ? entries : undefined;
}

function getProvisioningProgressFromTranscript(
  transcript: UIProvisioningTranscriptEntry[] | undefined,
): {
  phase?: "prepare_environment" | "start_provider_session";
  status?: "started" | "completed" | "failed";
} {
  const progressEntry = transcript?.find((entry) => entry.key.startsWith("phase:"));
  if (!progressEntry) return {};
  const metadata = progressEntry.metadata as Record<string, unknown> | undefined ?? null;
  const phase = metadata?.phase;
  const status = metadata?.status;

  return {
    phase: phase === "prepare_environment" || phase === "start_provider_session" ? phase : undefined,
    status: status === "started" || status === "completed" || status === "failed" ? status : undefined,
  };
}


function durationToString(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

interface ExecCallPartial extends Partial<UIToolCallSummary> {
  callId: string;
  toolName?: string;
  parsedCmd: UIToolParsedIntent[];
}

interface ExecLifecycleEvent {
  kind: "begin" | "end" | "output";
  call: ExecCallPartial;
  appendOutput?: boolean;
}

function toExecDefaultStatus(kind: "begin" | "end"): UIToolCallMessage["status"] {
  if (kind === "begin") return "pending";
  return "completed";
}

function parseExecLifecycleEvent(
  decoded: ThreadEvent,
  _meta: EventMeta,
  _originalEvent: ThreadEventRow,
): ExecLifecycleEvent | null {
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

    return {
      kind,
      call: {
        callId,
        command: extractShellCommandFromString(decoded.item.command),
        cwd: decoded.item.cwd,
        parsedCmd: [],
        output: decoded.item.aggregatedOutput,
        exitCode,
        durationMs: decoded.item.durationMs,
        duration: durationToString(decoded.item.durationMs),
        status,
      },
    };
  }

  return null;
}

// --- Generic tool call projection (bridge + Codex custom/function calls) ---

// Maps well-known tool names to exploring intents for grouping
function toolNameToParsedIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): UIToolParsedIntent[] {
  const name = toolName;
  switch (name) {
    case "Read":
    case "read": {
      const path = getFirstStringField(args, ["file_path", "file", "path"]) ?? "";
      return [{ type: "read", cmd: `${name} ${path}`.trim(), name, path: path || null }];
    }
    case "Glob":
    case "glob":
    case "ls":
    case "find": {
      const path = getFirstStringField(args, ["pattern", "path"]) ?? "";
      return [{ type: "list_files", cmd: `${name} ${path}`.trim(), path: path || null }];
    }
    case "Grep":
    case "grep": {
      const query = getFirstStringField(args, ["pattern", "query"]) ?? "";
      const path = getFirstStringField(args, ["path"]) ?? "";
      return [{ type: "search", cmd: `${name} '${query}'${path ? ` in ${path}` : ""}`.trim(), query: query || null, path: path || null }];
    }
    default:
      return [];
  }
}

function formatToolCallCommand(toolName: string, args: Record<string, unknown> | null): string {
  if (!args) return toolName;
  switch (toolName) {
    case "Read":
    case "read":
      return `${toolName} ${getFirstStringField(args, ["file_path", "file", "path"]) ?? ""}`.trim();
    case "Glob":
    case "glob":
      return `${toolName} ${getFirstStringField(args, ["pattern"]) ?? ""}`.trim();
    case "Grep":
    case "grep": {
      const pattern = getFirstStringField(args, ["pattern", "query"]) ?? "";
      const path = getFirstStringField(args, ["path"]);
      return `${toolName} '${pattern}'${path ? ` in ${path}` : ""}`;
    }
    case "Bash":
    case "bash":
      return getFirstStringField(args, ["command"]) ?? toolName;
    case "Edit":
    case "Write":
    case "edit":
    case "write":
      return `${toolName} ${getFirstStringField(args, ["file_path", "path"]) ?? ""}`.trim();
    default: {
      // Compact display for custom tools
      const entries = Object.entries(args).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return toolName;
      const compact = entries.map(([k, v]) => {
        const vs = typeof v === "string" ? v : JSON.stringify(v);
        const display = vs.length > 40 ? `${vs.slice(0, 37)}...` : vs;
        return `${k}: ${display}`;
      }).join(", ");
      return `${toolName} { ${compact} }`;
    }
  }
}

function parseToolCallLifecycleEvent(
  decoded: ThreadEvent,
  _meta: EventMeta,
  _originalEvent: ThreadEventRow,
): ExecLifecycleEvent | null {
  if (decoded.type === "item/started" || decoded.type === "item/completed") {
    if (decoded.item.type !== "toolCall") return null;

    const callId = decoded.item.id;
    if (!callId) return null;
    const toolName = decoded.item.tool ?? "tool";
    const serverPrefix = decoded.item.server ? `${decoded.item.server}:` : "";
    const fullToolName = `${serverPrefix}${toolName}`;
    let parsedArgs: Record<string, unknown> | null = null;
    const rawArgs = decoded.item.arguments;
    if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      parsedArgs = rawArgs as Record<string, unknown>;
    }

    const kind = decoded.type === "item/started" ? "begin" : "end";
    const status = kind === "end"
      ? (itemStatusToToolStatus(decoded.item.status) ?? "completed")
      : "pending";
    const result = decoded.item.result;
    const output = typeof result === "string" ? result : (result !== undefined ? JSON.stringify(result) : undefined);
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
      },
    };
  }

  return null;
}

interface WebSearchLifecycleEvent {
  kind: "begin" | "end";
  callId: string;
  query?: string;
  action?: string;
}


function parseWebSearchLifecycleEvent(
  decoded: ThreadEvent,
): WebSearchLifecycleEvent | null {
  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "webSearch"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      callId,
      query: decoded.item.query,
      action: decoded.item.action,
    };
  }

  return null;
}

function mapFileChanges(changes: ThreadEventFileChange[]): UIFileEditChange[] {
  return changes.map((change) => ({
    path: change.path,
    kind: change.kind,
    movePath: change.movePath ?? null,
    diff: change.diff,
  }));
}

interface FileEditPartial extends Partial<UIFileEditMessage> {
  callId: string;
  appendStdout?: boolean;
}

function parseFileEditFromItemEvent(
  decoded: ThreadEvent,
): FileEditPartial | null {
  if (decoded.type === "item/fileChange/outputDelta") {
    const callId = decoded.itemId;
    if (!callId) return null;

    return {
      callId,
      stdout: decoded.delta,
      appendStdout: true,
      status: "pending",
    };
  }

  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return null;
  }
  if (decoded.item.type !== "fileChange") return null;

  const callId = decoded.item.id;
  if (!callId) return null;

  const defaultStatus = decoded.type === "item/completed" ? "completed" : "pending";
  const changes = mapFileChanges(decoded.item.changes);

  return {
    callId,
    changes,
    status: itemStatusToFileEditStatus(decoded.item.status) ?? defaultStatus,
  };
}

interface CompactionLifecycleEvent {
  key: string;
  kind: "begin" | "end";
  detail?: string;
}

function getCompactionKey(decoded: ThreadEvent, meta: EventMeta): string {
  const turnId = "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;
  if (decoded.type === "item/started" || decoded.type === "item/completed") {
    return turnId ?? decoded.item.id ?? `seq-${meta.seq}`;
  }
  return turnId ?? `seq-${meta.seq}`;
}

function parseCompactionLifecycleEvent(
  decoded: ThreadEvent,
  meta: EventMeta,
): CompactionLifecycleEvent | null {
  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "contextCompaction"
  ) {
    return {
      key: getCompactionKey(decoded, meta),
      kind: decoded.type === "item/started" ? "begin" : "end",
    };
  }

  if (decoded.type === "thread/compacted") {
    return {
      key: getCompactionKey(decoded, meta),
      kind: "end",
    };
  }

  return null;
}

function parseOperationMessage(
  decoded: ThreadEvent,
  meta: EventMeta,
  options?: { includeOptionalOperations?: boolean },
): UIOperationMessage | null {
  function formatPlanStepStatus(status: ThreadEventPlanStepStatus | undefined): string {
    switch (status) {
      case "active":
        return "In progress";
      case "pending":
        return "Pending";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      default:
        return "";
    }
  }

  const eventType: string = decoded.type;
  const eventTurnId = "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;

  if (decoded.type === "turn/plan/updated") {
    const steps = decoded.plan
      .map((entry) => {
        const status = entry.status;
        const text = entry.step;
        if (!text) return null;
        return status
          ? `• [${formatPlanStepStatus(status)}] ${text}`
          : `• ${text}`;
      })
      .filter((value): value is string => Boolean(value));

    const detail =
      decoded.explanation && steps.length > 0
        ? `${decoded.explanation}\n${steps.join("\n")}`
        : decoded.explanation ?? (steps.length > 0 ? steps.join("\n") : undefined);

    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `plan:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: decoded.turnId,
      opType: "plan-updated",
      title: "Plan updated",
      detail,
      status: "completed",
    };
  }

  if (decoded.type === "item/mcpToolCall/progress") {
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `mcp-progress:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: decoded.turnId,
      opType: "mcp-progress",
      title: "MCP tool progress",
      detail: decoded.message || undefined,
      status: "pending",
    };
  }

  if (decoded.type === "warning") {
    const category = decoded.category ?? "general";
    const detail = decoded.summary ?? decoded.details;
    const isDeprecation = category === "deprecation";
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `${isDeprecation ? "deprecation" : "warning"}:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: isDeprecation ? "deprecation" : "warning",
      title: isDeprecation ? "Deprecation notice" : category === "config" ? "Configuration warning" : "Warning",
      detail: detail || undefined,
      status: "completed",
    };
  }

  if (decoded.type === "system/thread/interrupted") {
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `thread-interrupted:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "thread-interrupted",
      title: "Stopped by user",
      detail: decoded.message || undefined,
      status: "interrupted",
    };
  }

  if (decoded.type === "system/provisioning/started") {
    const { attachedEnvironmentId } = decoded;
    const transcript = readProvisioningTranscript(decoded.transcript);
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-started:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-started",
      title: "Provisioning started",
      status: "pending",
      provisioning:
        attachedEnvironmentId || transcript
          ? {
              ...(attachedEnvironmentId ? { attachedEnvironmentId } : {}),
              ...(transcript ? { transcript } : {}),
            }
          : undefined,
    };
  }

  if (decoded.type === "system/provisioning/progress") {
    const transcript = readProvisioningTranscript(decoded.transcript);
    const phase: "prepare_environment" | "start_provider_session" | undefined =
      decoded.phase ?? getProvisioningProgressFromTranscript(transcript).phase;
    const status: "started" | "completed" | "failed" | undefined =
      decoded.status ?? getProvisioningProgressFromTranscript(transcript).status;

    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-progress:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-progress",
      title: provisioningProgressTitle(phase, status),
      status: provisioningProgressOperationStatus(status),
      ...(transcript
        ? {
            provisioning: {
              transcript,
            },
          }
        : {}),
    };
  }

  if (decoded.type === "system/provisioning/env_setup") {
    const { setup, workspaceRoot } = decoded;
    const status = setup.status as UIProvisioningSetupStatus | undefined;
    const title = (() => {
      switch (status) {
        case "started":
          return "Environment setup started";
        case "running":
          return "Environment setup running";
        case "completed":
          return "Environment setup completed";
        case "failed":
          return "Environment setup failed";
        default:
          return "Environment setup update";
      }
    })();
    const setupMetadata =
      status
        ? {
            status,
            startedAt: meta.createdAt,
            ...(setup.scriptPath ? { scriptPath: setup.scriptPath } : {}),
            ...(setup.timeoutMs !== undefined ? { timeoutMs: setup.timeoutMs } : {}),
            ...(setup.durationMs !== undefined ? { durationMs: setup.durationMs } : {}),
            ...(setup.output ? { output: setup.output } : {}),
          }
        : undefined;
    const transcript = readProvisioningTranscript(decoded.transcript);

    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-env-setup:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-env-setup",
      title,
      status: provisioningSetupOperationStatus(status),
      ...(status && setupMetadata
        ? {
            provisioning: {
              ...(workspaceRoot ? { workspaceRoot } : {}),
              setup: setupMetadata,
              ...(transcript ? { transcript } : {}),
            },
          }
        : {}),
    };
  }

  if (decoded.type === "system/thread-title/updated") {
    // Avoid duplicate rows when the underlying provider thread/name/updated
    // event is also present in the timeline.
    if ((decoded.providerMethod ?? "") === "thread/name/updated") {
      return null;
    }
    const { title } = decoded;
    if (!title) return null;
    const { previousTitle } = decoded;
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `thread-title-updated:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "thread-title-updated",
      title: "Title updated",
      detail: previousTitle
        ? `${previousTitle} → ${title}`
        : title,
      status: "completed",
    };
  }

  if (decoded.type === "thread/name/updated") {
    const { threadName } = decoded;
    if (!threadName) return null;
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `thread-title-updated:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "thread-title-updated",
      title: "Title updated",
      detail: threadName,
      status: "completed",
    };
  }

  if (decoded.type === "system/operation") {
    const threadOperation: UIThreadOperationMetadata = {
      operation: decoded.operation,
      status: decoded.status,
      ...(decoded.operationId ? { operationId: decoded.operationId } : {}),
      ...(decoded.metadata ? { metadata: decoded.metadata } : {}),
    };
    const title = threadOperationTitle(threadOperation);

    // Extra runtime fields (e.g. "branch") may be spread into decoded by decodeRow
    const extraBranch = (decoded as unknown as Record<string, unknown>).branch;
    const detailParts = [
      decoded.message,
      typeof extraBranch === "string" ? `Branch: ${extraBranch}` : undefined,
    ].filter((value): value is string => Boolean(value));

    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `operation:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "operation",
      title,
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      status: threadOperationStatus(threadOperation),
      ...(threadOperation ? { threadOperation } : {}),
    };
  }

  if (decoded.type === "system/worktree/commit") {
    const { status } = decoded;
    const title = status === "committed" ? "Committed changes" : "No commit created";
    const { message: commitMessage, commitSha, commitSubject, includeUnstaged } = decoded;
    const worktreeCommit: UIWorktreeCommitMetadata | undefined =
      status === "committed" || status === "noop"
        ? {
            status,
            ...(commitMessage ? { message: commitMessage } : {}),
            ...(commitSha ? { commitSha } : {}),
            ...(commitSubject ? { commitSubject } : {}),
            ...(typeof includeUnstaged === "boolean" ? { includeUnstaged } : {}),
          }
        : undefined;
    const detailParts = [
      commitSubject ?? commitMessage,
      commitSha,
    ].filter((value): value is string => Boolean(value));
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `worktree-commit:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "worktree-commit",
      title,
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      status: "completed",
      ...(worktreeCommit ? { worktreeCommit } : {}),
    };
  }

  if (decoded.type === "system/worktree/squash_merge") {
    const { status } = decoded;
    const { message: squashMessage, commitSha, commitSubject, mergeBaseBranch, committed, conflictFiles } = decoded;
    const normalizedConflictFiles = Array.isArray(conflictFiles)
      ? conflictFiles
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .slice(0, 8)
      : [];
    const worktreeSquashMerge: UIWorktreeSquashMergeMetadata | undefined =
      status === "merged" || status === "noop" || status === "conflict"
        ? {
            status,
            ...(squashMessage ? { message: squashMessage } : {}),
            ...(typeof committed === "boolean" ? { committed } : {}),
            ...(commitSha ? { commitSha } : {}),
            ...(commitSubject ? { commitSubject } : {}),
            ...(mergeBaseBranch ? { mergeBaseBranch } : {}),
            ...(normalizedConflictFiles.length > 0
              ? { conflictFiles: normalizedConflictFiles }
              : {}),
          }
        : undefined;
    const title = status === "merged"
      ? "Squash merged"
      : status === "conflict"
        ? "Squash merge has conflicts"
        : "No squash merge performed";
    const detailParts = [
      squashMessage,
      ...(normalizedConflictFiles.length > 0
        ? [`Conflicts: ${normalizedConflictFiles.join(", ")}`]
        : []),
    ].filter((value): value is string => Boolean(value));
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `worktree-squash-merge:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "worktree-squash-merge",
      title,
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      status: status === "conflict" ? "error" : "completed",
      ...(worktreeSquashMerge ? { worktreeSquashMerge } : {}),
    };
  }

  if (decoded.type === "system/provisioning/fallback") {
    const { fallbackEnvironmentId, detail } = decoded;
    const transcript = readProvisioningTranscript(decoded.transcript);
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-fallback:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-fallback",
      title: "Provisioning fallback",
      detail: detail || undefined,
      status: "pending",
      provisioning:
        fallbackEnvironmentId || transcript
          ? {
              ...(transcript ? { transcript } : {}),
            }
          : undefined,
    };
  }

  if (decoded.type === "system/provisioning/completed") {
    const { attachedEnvironmentId, workspaceRoot } = decoded;
    const transcript = readProvisioningTranscript(decoded.transcript);
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-completed:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-completed",
      title: "Provisioning ready",
      status: "completed",
      provisioning:
        attachedEnvironmentId ||
        workspaceRoot ||
        transcript
          ? {
              ...(attachedEnvironmentId ? { attachedEnvironmentId } : {}),
              ...(workspaceRoot ? { workspaceRoot } : {}),
              ...(transcript ? { transcript } : {}),
            }
          : undefined,
    };
  }

  if (decoded.type === "system/provisioning/cleanup_failed") {
    const detailParts = [
      decoded.message,
      decoded.detail,
    ].filter((value): value is string => Boolean(value));
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `provisioning-cleanup-failed:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "provisioning-cleanup-failed",
      title: "Provisioning cleanup failed",
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      status: "error",
    };
  }

  if (decoded.type === "thread/compacted") {
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `compaction:${getCompactionKey(decoded, meta)}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      turnId: eventTurnId,
      opType: "compaction",
      title: "Context compacted",
      status: "completed",
    };
  }

  if (
    options?.includeOptionalOperations &&
    decoded.type === "turn/diff/updated"
  ) {
    return {
      kind: "operation",
      id: messageId(decoded.threadId, "op", `turn-diff:${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      turnId: decoded.turnId,
      opType: "turn-diff",
      title: "Turn diff updated",
      detail: decoded.diff,
    };
  }

  return null;
}

function parseErrorMessage(decoded: ThreadEvent, meta: EventMeta): UIErrorMessage | null {
  const eventType = decoded.type;
  if (!eventType.includes("error")) return null;

  const eventTurnId = "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;

  // Handle typed error and system/error events
  if (decoded.type === "error") {
    const { message, detail } = decoded;
    const formattedMessage =
      detail && detail !== message ? `${message} - ${detail}` : message;
    return {
      kind: "error",
      id: messageId(decoded.threadId, "error", `${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      turnId: eventTurnId,
      rawType: eventType,
      message: formattedMessage || "Error event",
    };
  }

  if (decoded.type === "system/error") {
    const { message, detail } = decoded;
    const formattedMessage =
      detail && detail !== message ? `${message} - ${detail}` : message;
    return {
      kind: "error",
      id: messageId(decoded.threadId, "error", `${meta.seq}`),
      threadId: decoded.threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      turnId: eventTurnId,
      rawType: eventType,
      message: formattedMessage || "Error event",
    };
  }

  // Fallback for unrecognized error event types (e.g., turn/completed with error status)
  return null;
}

function isIgnoredNoiseType(eventType: string): boolean {
  return (
    eventType === "thread/started" ||
    eventType === "thread/tokenUsage/updated" ||
    eventType === "thread/identity" ||
    eventType === "item/reasoning/summaryPartAdded"
  );
}

function isDuplicateEventType(eventType: string): boolean {
  return (
    eventType === "turn/started" ||
    eventType === "turn/completed" ||
    eventType === "item/commandExecution/outputDelta" ||
    eventType === "item/fileChange/outputDelta" ||
    eventType === "turn/diff/updated"
  );
}

function isIgnoredItemStartEvent(decoded: ThreadEvent): boolean {
  if (decoded.type !== "item/started") return false;
  return decoded.item.type === "reasoning" || decoded.item.type === "agentMessage";
}

function appendDebugEvent(
  out: UIMessage[],
  originalEvent: ThreadEventRow,
  decoded: ThreadEvent,
  meta: EventMeta,
  reason: UIDebugRawEventMessage["reason"],
): void {
  const eventTurnId = "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;
  out.push({
    kind: "debug/raw-event",
    id: messageId(decoded.threadId, "debug", `${meta.seq}:${decoded.type}`),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    turnId: eventTurnId,
    rawType: decoded.type,
    rawEvent: originalEvent,
    reason,
  });
}

interface ProjectionState {
  messages: UIMessage[];
  seenUserKeys: Set<string>;
  openAssistantByTurn: Map<string, UIAssistantTextMessage>;
  finalizedAssistantTurnKeys: Set<string>;
  openReasoningByTurn: Map<string, UIAssistantReasoningMessage>;
  finalizedReasoningTurnKeys: Set<string>;
  openCompactionsByKey: Map<string, UIOperationMessage>;
  finalizedCompactionKeys: Set<string>;
  fileEditsByCallId: Map<string, UIFileEditMessage>;
  toolActivity: ToolActivityState;
}

function createProjectionState(): ProjectionState {
  return {
    messages: [],
    seenUserKeys: new Set(),
    openAssistantByTurn: new Map(),
    finalizedAssistantTurnKeys: new Set(),
    openReasoningByTurn: new Map(),
    finalizedReasoningTurnKeys: new Set(),
    openCompactionsByKey: new Map(),
    finalizedCompactionKeys: new Set(),
    fileEditsByCallId: new Map(),
    toolActivity: {
      runningCallsById: new Map(),
      activeCell: null,
      historyCells: [],
      finalizedExecCallIds: new Set(),
      finalizedWebSearchCallIds: new Set(),
    },
  };
}

interface RunningExecCall extends UIToolCallSummary {
  threadId: string;
  toolName?: string;
  turnId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt: number;
}

interface ToolActivityState {
  runningCallsById: Map<string, RunningExecCall>;
  activeCell: UIToolExploringMessage | UIToolCallMessage | UIWebSearchMessage | null;
  historyCells: Array<UIToolExploringMessage | UIToolCallMessage | UIWebSearchMessage>;
  finalizedExecCallIds: Set<string>;
  finalizedWebSearchCallIds: Set<string>;
}

function getCallStatusRank(
  status: UIToolCallMessage["status"] | undefined,
): number {
  if (!status) return 0;
  if (status === "pending") return 1;
  if (status === "interrupted") return 2;
  if (status === "completed") return 3;
  if (status === "error") return 4;
  return 0;
}

function mergeCallStatus(
  current: UIToolCallMessage["status"] | undefined,
  incoming: UIToolCallMessage["status"] | undefined,
): UIToolCallMessage["status"] | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  return getCallStatusRank(incoming) >= getCallStatusRank(current)
    ? incoming
    : current;
}

function hasSemanticIntent(intents: UIToolParsedIntent[]): boolean {
  return intents.some((intent) => intent.type !== "unknown");
}

function chooseParsedIntents(
  existing: UIToolParsedIntent[],
  incoming: UIToolParsedIntent[],
): UIToolParsedIntent[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  if (!hasSemanticIntent(existing) && hasSemanticIntent(incoming)) {
    return incoming;
  }
  if (incoming.length > existing.length) return incoming;
  return existing;
}

function upsertRunningExecCall(
  existing: RunningExecCall | undefined,
  incoming: ExecCallPartial,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
): RunningExecCall {
  if (!existing) {
    return {
      callId: incoming.callId,
      threadId,
      toolName: incoming.toolName,
      command: incoming.command,
      cwd: incoming.cwd,
      parsedCmd: incoming.parsedCmd,
      source: incoming.source,
      output: incoming.output,
      exitCode: incoming.exitCode,
      duration: incoming.duration,
      durationMs: incoming.durationMs,
      status: incoming.status ?? "pending",
      turnId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
    };
  }

  if (incoming.toolName && !existing.toolName) existing.toolName = incoming.toolName;
  existing.command =
    incoming.command &&
    (!existing.command || incoming.command.length > existing.command.length)
      ? incoming.command
      : existing.command;
  existing.threadId = threadId;
  if (incoming.cwd && !existing.cwd) existing.cwd = incoming.cwd;
  existing.parsedCmd = chooseParsedIntents(existing.parsedCmd, incoming.parsedCmd);
  if (incoming.source && !existing.source) existing.source = incoming.source;
  if (incoming.output && incoming.output.length > 0) {
    existing.output =
      !existing.output || incoming.output.length >= existing.output.length
        ? incoming.output
        : existing.output;
  }
  if (incoming.exitCode !== undefined) existing.exitCode = incoming.exitCode;
  if (incoming.duration && !existing.duration) existing.duration = incoming.duration;
  if (incoming.durationMs !== undefined && existing.durationMs === undefined) {
    existing.durationMs = incoming.durationMs;
  }
  existing.status = mergeCallStatus(existing.status, incoming.status) ?? "pending";
  existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
  existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
  if (!existing.turnId && turnId) {
    existing.turnId = turnId;
  }

  return existing;
}

function appendExecOutputDelta(
  call: RunningExecCall,
  delta: string | undefined,
): void {
  if (!delta || delta.length === 0) return;
  call.output = `${call.output ?? ""}${delta}`;
}

function isExploringIntent(intent: UIToolParsedIntent): boolean {
  return (
    intent.type === "read" ||
    intent.type === "list_files" ||
    intent.type === "search"
  );
}

function isExploringCall(call: Pick<UIToolCallSummary, "parsedCmd">): boolean {
  if (call.parsedCmd.length === 0) return false;
  return call.parsedCmd.every((intent) => isExploringIntent(intent));
}

function areExploringCallsCompatible(
  a: Pick<RunningExecCall, "turnId" | "source">,
  b: Pick<RunningExecCall, "turnId" | "source">,
): boolean {
  const sameTurn = a.turnId === b.turnId;
  const sameSource = (a.source ?? "agent") === (b.source ?? "agent");
  return sameTurn && sameSource;
}

function syncExploringStatus(cell: UIToolExploringMessage): void {
  cell.status = cell.calls.some((call) => call.status === "pending")
    ? "pending"
    : "completed";
}

function findCallInActiveCell(
  activeCell: ToolActivityState["activeCell"],
  callId: string,
): UIToolCallSummary | UIToolCallMessage | null {
  if (!activeCell) return null;
  if (activeCell.kind === "tool-call" && activeCell.callId === callId) {
    return activeCell;
  }
  if (activeCell.kind !== "tool-exploring") return null;
  return activeCell.calls.find((call) => call.callId === callId) ?? null;
}

function findCallInHistoryCells(
  state: ProjectionState,
  callId: string,
):
  | {
      cell: UIToolExploringMessage | UIToolCallMessage;
      call: UIToolCallSummary | UIToolCallMessage;
    }
  | null {
  for (let index = state.toolActivity.historyCells.length - 1; index >= 0; index -= 1) {
    const cell = state.toolActivity.historyCells[index];
    if (!cell || cell.kind === "web-search") continue;

    const call = findCallInActiveCell(cell, callId);
    if (!call) continue;

    return {
      cell,
      call,
    };
  }

  return null;
}

function mergeCallSummary(
  target: UIToolCallSummary | UIToolCallMessage,
  incoming: ExecCallPartial,
  {
    appendOutput,
  }: {
    appendOutput?: boolean;
  } = {},
): void {
  if (incoming.command && (!target.command || incoming.command.length > target.command.length)) {
    target.command = incoming.command;
  }
  if (incoming.cwd && !target.cwd) target.cwd = incoming.cwd;
  target.parsedCmd = chooseParsedIntents(target.parsedCmd ?? [], incoming.parsedCmd);
  if (incoming.source && !target.source) target.source = incoming.source;
  if (incoming.output && incoming.output.length > 0) {
    if (appendOutput) {
      target.output = `${target.output ?? ""}${incoming.output}`;
    } else if (!target.output || incoming.output.length >= target.output.length) {
      target.output = incoming.output;
    }
  }
  if (incoming.exitCode !== undefined) target.exitCode = incoming.exitCode;
  if (incoming.duration && !target.duration) target.duration = incoming.duration;
  if (incoming.durationMs !== undefined && target.durationMs === undefined) {
    target.durationMs = incoming.durationMs;
  }
  target.status = mergeCallStatus(target.status, incoming.status) ?? target.status;
}

function flushActiveToolCell(state: ProjectionState): void {
  const active = state.toolActivity.activeCell;
  if (!active) return;

  if (active.kind === "tool-exploring") {
    syncExploringStatus(active);
    for (const call of active.calls) {
      if (call.status !== "pending") {
        state.toolActivity.finalizedExecCallIds.add(call.callId);
      }
    }
  } else if (active.kind === "tool-call" && active.status !== "pending") {
    state.toolActivity.finalizedExecCallIds.add(active.callId);
  }

  state.toolActivity.historyCells.push(active);
  state.messages.push(active);
  state.toolActivity.activeCell = null;
}

function flushToolActivityBeforeNonToolMessage(state: ProjectionState): void {
  flushActiveToolCell(state);
}

function createToolCallMessage(
  call: RunningExecCall,
): UIToolCallMessage {
  return {
    kind: "tool-call",
    id: messageId(call.threadId, "tool", call.callId),
    threadId: call.threadId,
    sourceSeqStart: call.sourceSeqStart,
    sourceSeqEnd: call.sourceSeqEnd,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    ...(call.turnId ? { turnId: call.turnId } : {}),
    toolName: call.toolName ?? "exec_command",
    callId: call.callId,
    command: call.command,
    cwd: call.cwd,
    parsedCmd: call.parsedCmd,
    source: call.source,
    output: call.output,
    exitCode: call.exitCode,
    duration: call.duration,
    durationMs: call.durationMs,
    status: call.status,
  };
}

function createExploringMessage(
  call: RunningExecCall,
): UIToolExploringMessage {
  return {
    kind: "tool-exploring",
    id: messageId(
      call.threadId,
      "tool-exploring",
      `${call.callId}:${call.sourceSeqStart}`,
    ),
    threadId: call.threadId,
    sourceSeqStart: call.sourceSeqStart,
    sourceSeqEnd: call.sourceSeqEnd,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    ...(call.turnId ? { turnId: call.turnId } : {}),
    status: call.status === "pending" ? "pending" : "completed",
    calls: [call],
  };
}

function onExecBegin(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ExecCallPartial,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(incoming.callId);
  const call = upsertRunningExecCall(existingRunning, incoming, meta, threadId, turnId);
  state.toolActivity.runningCallsById.set(call.callId, call);

  const existingInActive = findCallInActiveCell(state.toolActivity.activeCell, call.callId);
  if (existingInActive) {
    mergeCallSummary(existingInActive, call);
    if (state.toolActivity.activeCell?.kind === "tool-exploring") {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        call.sourceSeqEnd,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        call.createdAt,
      );
      syncExploringStatus(state.toolActivity.activeCell);
    }
    return;
  }

  const exploring = isExploringCall(call);
  const active = state.toolActivity.activeCell;

  if (exploring && active?.kind === "tool-exploring") {
    const lastCall = active.calls[active.calls.length - 1];
    if (lastCall && areExploringCallsCompatible(lastCall as RunningExecCall, call)) {
      active.calls.push(call);
      active.sourceSeqEnd = Math.max(active.sourceSeqEnd, call.sourceSeqEnd);
      active.createdAt = Math.max(active.createdAt, call.createdAt);
      syncExploringStatus(active);
      return;
    }
  }

  flushActiveToolCell(state);

  if (exploring) {
    state.toolActivity.activeCell = createExploringMessage(call);
    return;
  }

  state.toolActivity.activeCell = createToolCallMessage(call);
}

function onExecOutput(
  state: ProjectionState,
  meta: EventMeta,
  incoming: ExecCallPartial,
  appendOutput?: boolean,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(incoming.callId);
  if (existingRunning) {
    if (appendOutput) {
      appendExecOutputDelta(existingRunning, incoming.output);
    } else {
      mergeCallSummary(existingRunning, incoming, { appendOutput });
    }
    existingRunning.sourceSeqEnd = Math.max(existingRunning.sourceSeqEnd, meta.seq);
    existingRunning.createdAt = Math.max(existingRunning.createdAt, meta.createdAt);
  }

  const activeCall = findCallInActiveCell(state.toolActivity.activeCell, incoming.callId);
  if (activeCall) {
    mergeCallSummary(activeCall, incoming, { appendOutput });
    if (state.toolActivity.activeCell?.kind === "tool-exploring") {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        meta.seq,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        meta.createdAt,
      );
    } else if (state.toolActivity.activeCell?.kind === "tool-call") {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        meta.seq,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        meta.createdAt,
      );
    }
  }

  const historyMatch = findCallInHistoryCells(state, incoming.callId);
  if (!historyMatch) return;

  mergeCallSummary(historyMatch.call, incoming, { appendOutput });
  historyMatch.cell.sourceSeqEnd = Math.max(historyMatch.cell.sourceSeqEnd, meta.seq);
  historyMatch.cell.createdAt = Math.max(historyMatch.cell.createdAt, meta.createdAt);

  if (historyMatch.cell.kind === "tool-exploring") {
    syncExploringStatus(historyMatch.cell);
  } else if (historyMatch.cell.kind === "tool-call") {
    historyMatch.cell.status =
      mergeCallStatus(historyMatch.cell.status, incoming.status) ??
      historyMatch.cell.status;
  }
}

function onExecEnd(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ExecCallPartial,
): void {
  const running = state.toolActivity.runningCallsById.get(incoming.callId);
  const merged = upsertRunningExecCall(running, incoming, meta, threadId, turnId);
  state.toolActivity.runningCallsById.delete(incoming.callId);

  const active = state.toolActivity.activeCell;
  const existingInActive = findCallInActiveCell(active, incoming.callId);
  if (existingInActive) {
    mergeCallSummary(existingInActive, merged);
    if (active?.kind === "tool-exploring") {
      active.sourceSeqEnd = Math.max(active.sourceSeqEnd, merged.sourceSeqEnd);
      active.createdAt = Math.max(active.createdAt, merged.createdAt);
      syncExploringStatus(active);
      state.toolActivity.finalizedExecCallIds.add(incoming.callId);
      return;
    }

    if (active?.kind === "tool-call") {
      active.sourceSeqEnd = Math.max(active.sourceSeqEnd, merged.sourceSeqEnd);
      active.createdAt = Math.max(active.createdAt, merged.createdAt);
      active.status = mergeCallStatus(active.status, merged.status) ?? active.status;
      active.output = merged.output ?? active.output;
      active.exitCode = merged.exitCode ?? active.exitCode;
      active.duration = merged.duration ?? active.duration;
      active.durationMs = merged.durationMs ?? active.durationMs;
      state.toolActivity.finalizedExecCallIds.add(incoming.callId);
      flushActiveToolCell(state);
      return;
    }
  }

  if (state.toolActivity.finalizedExecCallIds.has(incoming.callId)) {
    return;
  }

  const historyMatch = findCallInHistoryCells(state, incoming.callId);
  if (historyMatch) {
    mergeCallSummary(historyMatch.call, merged);
    historyMatch.cell.sourceSeqEnd = Math.max(
      historyMatch.cell.sourceSeqEnd,
      merged.sourceSeqEnd,
    );
    historyMatch.cell.createdAt = Math.max(
      historyMatch.cell.createdAt,
      merged.createdAt,
    );

    if (historyMatch.cell.kind === "tool-exploring") {
      syncExploringStatus(historyMatch.cell);
    } else {
      historyMatch.cell.status =
        mergeCallStatus(historyMatch.cell.status, merged.status) ??
        historyMatch.cell.status;
      historyMatch.cell.output = merged.output ?? historyMatch.cell.output;
      historyMatch.cell.exitCode = merged.exitCode ?? historyMatch.cell.exitCode;
      historyMatch.cell.duration = merged.duration ?? historyMatch.cell.duration;
      historyMatch.cell.durationMs = merged.durationMs ?? historyMatch.cell.durationMs;
    }

    state.toolActivity.finalizedExecCallIds.add(incoming.callId);
    return;
  }

  if (isExploringCall(merged)) {
    const exploringMessage = createExploringMessage(merged);
    syncExploringStatus(exploringMessage);
    state.toolActivity.activeCell = exploringMessage;
    flushActiveToolCell(state);
    return;
  }

  const toolCall = createToolCallMessage(merged);
  toolCall.status = mergeCallStatus(toolCall.status, incoming.status) ?? toolCall.status;
  state.toolActivity.activeCell = toolCall;
  flushActiveToolCell(state);
}

function onWebSearchBegin(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: WebSearchLifecycleEvent,
): void {
  if (state.toolActivity.finalizedWebSearchCallIds.has(payload.callId)) {
    return;
  }

  const active = state.toolActivity.activeCell;
  if (active?.kind === "web-search" && active.callId === payload.callId) {
    active.sourceSeqEnd = Math.max(active.sourceSeqEnd, meta.seq);
    active.createdAt = Math.max(active.createdAt, meta.createdAt);
    if (payload.query) active.query = payload.query;
    if (payload.action) active.action = payload.action;
    return;
  }

  flushActiveToolCell(state);
  state.toolActivity.activeCell = {
    kind: "web-search",
    id: messageId(threadId, "web-search", payload.callId),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    callId: payload.callId,
    query: payload.query,
    action: payload.action,
    status: "pending",
  };
}

function onWebSearchEnd(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: WebSearchLifecycleEvent,
): void {
  if (state.toolActivity.finalizedWebSearchCallIds.has(payload.callId)) {
    return;
  }

  const active = state.toolActivity.activeCell;
  if (active?.kind === "web-search" && active.callId === payload.callId) {
    active.sourceSeqEnd = Math.max(active.sourceSeqEnd, meta.seq);
    active.createdAt = Math.max(active.createdAt, meta.createdAt);
    if (payload.query) active.query = payload.query;
    if (payload.action) active.action = payload.action;
    active.status = "completed";
    flushActiveToolCell(state);
    state.toolActivity.finalizedWebSearchCallIds.add(payload.callId);
    return;
  }

  flushActiveToolCell(state);

  state.messages.push({
    kind: "web-search",
    id: messageId(threadId, "web-search", `${payload.callId}:${meta.seq}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    callId: payload.callId,
    query: payload.query,
    action: payload.action,
    status: "completed",
  });
  state.toolActivity.finalizedWebSearchCallIds.add(payload.callId);
}

function mergeFileChanges(
  existing: UIFileEditChange[],
  incoming: UIFileEditChange[],
): UIFileEditChange[] {
  const byPath = new Map<string, UIFileEditChange>();

  for (const change of existing) {
    byPath.set(change.path, { ...change });
  }

  for (const change of incoming) {
    const prev = byPath.get(change.path);
    if (!prev) {
      byPath.set(change.path, { ...change });
      continue;
    }

    byPath.set(change.path, {
      path: change.path,
      kind: change.kind ?? prev.kind,
      movePath: change.movePath ?? prev.movePath,
      diff: change.diff ?? prev.diff,
    });
  }

  return [...byPath.values()];
}

function upsertFileEdit(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  partial: FileEditPartial,
): void {
  const existing = state.fileEditsByCallId.get(partial.callId);

  if (!existing) {
    const message: UIFileEditMessage = {
      kind: "file-edit",
      id: messageId(threadId, "file-edit", partial.callId),
      threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      ...(turnId ? { turnId } : {}),
      callId: partial.callId,
      changes: partial.changes ?? [],
      stdout: partial.stdout,
      stderr: partial.stderr,
      status: partial.status ?? "pending",
    };
    state.fileEditsByCallId.set(partial.callId, message);
    state.messages.push(message);
    return;
  }

  existing.sourceSeqEnd = meta.seq;
  existing.createdAt = meta.createdAt;

  if (!existing.turnId && turnId) existing.turnId = turnId;

  if (partial.changes && partial.changes.length > 0) {
    existing.changes = mergeFileChanges(existing.changes, partial.changes);
  }

  if (partial.stdout) {
    if (partial.appendStdout) {
      existing.stdout = `${existing.stdout ?? ""}${partial.stdout}`;
    } else {
      existing.stdout = partial.stdout;
    }
  }

  if (partial.stderr) {
    existing.stderr = partial.stderr;
  }

  if (partial.status) {
    if (partial.status === "error") {
      existing.status = "error";
    } else if (existing.status === "pending" || existing.status === "interrupted") {
      existing.status = partial.status;
    } else if (existing.status !== "error" && partial.status === "completed") {
      existing.status = "completed";
    }
  }
}

function onCompactionBegin(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.status = "pending";
    existing.title = "Context compacting...";
    existing.detail = payload.detail ?? existing.detail;
    return;
  }

  const message: UIOperationMessage = {
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    opType: "compaction",
    title: "Context compacting...",
    detail: payload.detail,
    status: "pending",
  };
  state.openCompactionsByKey.set(payload.key, message);
  state.messages.push(message);
}

function onCompactionEnd(
  state: ProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: CompactionLifecycleEvent,
): void {
  const existing = state.openCompactionsByKey.get(payload.key);
  if (existing) {
    existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
    existing.createdAt = Math.max(existing.createdAt, meta.createdAt);
    existing.status = "completed";
    existing.title = "Context compacted";
    existing.detail = payload.detail ?? existing.detail;
    state.openCompactionsByKey.delete(payload.key);
    state.finalizedCompactionKeys.add(payload.key);
    return;
  }

  if (state.finalizedCompactionKeys.has(payload.key)) {
    return;
  }

  state.messages.push({
    kind: "operation",
    id: messageId(threadId, "op", `compaction:${payload.key}`),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId ? { turnId } : {}),
    opType: "compaction",
    title: "Context compacted",
    detail: payload.detail,
    status: "completed",
  });
  state.finalizedCompactionKeys.add(payload.key);
}

function interruptOperationMessage(message: UIOperationMessage): void {
  if (message.status !== "pending") return;
  message.status = "interrupted";

  switch (message.opType) {
    case "operation":
      switch (message.threadOperation?.operation) {
        case "commit":
          message.title = "Commit interrupted";
          return;
        case "squash_merge":
          message.title = "Squash merge interrupted";
          return;
        case "primary_checkout":
          message.title = "Primary checkout interrupted";
          return;
        default:
          message.title = "Operation interrupted";
          return;
      }
    case "provisioning-started":
    case "provisioning-fallback":
      message.title = "Provisioning interrupted";
      return;
    case "provisioning-progress":
      message.title = "Provisioning interrupted";
      return;
    case "provisioning-env-setup":
      message.title = "Environment setup interrupted";
      return;
    case "mcp-progress":
      message.title = "MCP tool progress interrupted";
      return;
    case "compaction":
      message.title = "Context compaction interrupted";
      return;
    default:
      return;
  }
}

function finalizeOperationMessage(
  message: UIOperationMessage,
  options: ToUIMessagesOptions | undefined,
): void {
  if (message.status !== "pending") return;

  if (options?.threadStatus === "provisioning_failed") {
    switch (message.opType) {
      case "provisioning-started":
      case "provisioning-fallback":
        message.status = "error";
        message.title = "Provisioning failed";
        return;
      case "provisioning-progress":
        message.status = "error";
        if (
          getProvisioningProgressFromTranscript(message.provisioning?.transcript).phase ===
          "prepare_environment"
        ) {
          message.title = "Environment preparation failed";
          return;
        }
        if (
          getProvisioningProgressFromTranscript(message.provisioning?.transcript).phase ===
          "start_provider_session"
        ) {
          message.title = "Provider session start failed";
          return;
        }
        message.title = "Provisioning failed";
        return;
      case "provisioning-env-setup":
        message.status = "error";
        message.title = "Environment setup failed";
        return;
      default:
        break;
    }
  }

  interruptOperationMessage(message);
}

function isTerminalAssistantFlushEvent(eventType: string): boolean {
  return (
    eventType === "system/thread/interrupted" ||
    eventType === "turn/completed"
  );
}

function flushBufferedAssistantMessages(state: ProjectionState): void {
  if (state.openAssistantByTurn.size === 0) {
    return;
  }

  const pendingAssistants = Array.from(state.openAssistantByTurn.entries()).sort(
    (left, right) =>
      left[1].sourceSeqStart - right[1].sourceSeqStart ||
      left[1].sourceSeqEnd - right[1].sourceSeqEnd ||
      left[1].createdAt - right[1].createdAt,
  );

  flushToolActivityBeforeNonToolMessage(state);
  for (const [turnKey, assistant] of pendingAssistants) {
    if (assistant.status === "streaming") {
      assistant.status = "completed";
    }
    state.messages.push(assistant);
    state.finalizedAssistantTurnKeys.add(turnKey);
  }
  state.openAssistantByTurn.clear();
}

function finalizePendingMessages(
  state: ProjectionState,
  options: ToUIMessagesOptions | undefined,
): void {
  const shouldPreservePending = shouldPreservePendingMessages(options?.threadStatus);
  const shouldFinalizeBufferedAssistants =
    options?.threadStatus !== undefined && !shouldPreservePending;
  if (shouldPreservePending) {
    flushActiveToolCell(state);
    return;
  }

  for (const call of state.toolActivity.runningCallsById.values()) {
    call.status = mergeCallStatus(call.status, "interrupted") ?? "interrupted";
    if (!call.output) {
      call.output = "Tool execution interrupted";
    }

    const activeCall = findCallInActiveCell(state.toolActivity.activeCell, call.callId);
    if (activeCall) {
      mergeCallSummary(activeCall, {
        ...call,
        parsedCmd: call.parsedCmd,
      });
      continue;
    }

    const historyMatch = findCallInHistoryCells(state, call.callId);
    if (historyMatch) {
      mergeCallSummary(historyMatch.call, {
        ...call,
        parsedCmd: call.parsedCmd,
      });
      if (historyMatch.cell.kind === "tool-exploring") {
        syncExploringStatus(historyMatch.cell);
      }
      continue;
    }

    state.messages.push(createToolCallMessage(call));
  }
  state.toolActivity.runningCallsById.clear();

  if (state.toolActivity.activeCell?.kind === "tool-call") {
    if (state.toolActivity.activeCell.status === "pending") {
      state.toolActivity.activeCell.status = "interrupted";
      if (!state.toolActivity.activeCell.output) {
        state.toolActivity.activeCell.output = "Tool execution interrupted";
      }
    }
  } else if (state.toolActivity.activeCell?.kind === "tool-exploring") {
    for (const call of state.toolActivity.activeCell.calls) {
      if (call.status === "pending") {
        call.status = "interrupted";
        if (!call.output) {
          call.output = "Tool execution interrupted";
        }
      }
    }
    syncExploringStatus(state.toolActivity.activeCell);
  } else if (state.toolActivity.activeCell?.kind === "web-search") {
    state.toolActivity.activeCell.status = "completed";
  }

  for (const fileEdit of state.fileEditsByCallId.values()) {
    if (fileEdit.status === "pending") {
      fileEdit.status = "interrupted";
    }
  }

  if (shouldFinalizeBufferedAssistants) {
    flushBufferedAssistantMessages(state);
  }

  for (const reasoning of state.openReasoningByTurn.values()) {
    if (reasoning.status === "streaming") {
      reasoning.status = "completed";
    }
  }
  state.openReasoningByTurn.clear();

  for (const message of state.messages) {
    if (message.kind !== "operation") continue;
    finalizeOperationMessage(message, options);
  }

  flushActiveToolCell(state);
}

export function toUIMessages(
  events: ThreadEventRow[] | undefined,
  options?: ToUIMessagesOptions,
): UIMessage[] {
  if (!events || events.length === 0) return [];

  const state = createProjectionState();
  const includeDebugRawEvents = options?.includeDebugRawEvents ?? false;
  const includeInternalSystemMessages =
    options?.includeInternalSystemMessages ?? false;

  let areEventsOrdered = true;
  for (let index = 1; index < events.length; index += 1) {
    if (events[index - 1].seq > events[index].seq) {
      areEventsOrdered = false;
      break;
    }
  }
  const orderedEvents = areEventsOrdered ? events : [...events].sort((a, b) => a.seq - b.seq);
  const pendingClientStartUserSignatureCounts = new Map<string, number>();
  const pendingClientThreadStartUserSignatureCounts = new Map<string, number>();
  const pendingClientRequestedUserSignatureCounts = new Map<string, number>();
  const pendingProviderUserSignatureCounts = new Map<string, number>();

  for (const originalEvent of orderedEvents) {
    const { event: decoded, meta } = decodeRow(originalEvent);
    const eventType = decoded.type;

    if (eventType === "turn/completed") {
      pendingClientStartUserSignatureCounts.clear();
      pendingClientThreadStartUserSignatureCounts.clear();
      pendingClientRequestedUserSignatureCounts.clear();
      pendingProviderUserSignatureCounts.clear();
    }

    const eventTurnId = "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;

    if (state.openAssistantByTurn.size > 0 && isTerminalAssistantFlushEvent(eventType)) {
      flushBufferedAssistantMessages(state);
    }

    if (
      decoded.type === "client/thread/start" ||
      decoded.type === "client/turn/requested" ||
      decoded.type === "client/turn/start"
    ) {
      if (
        decoded.initiator === "system" &&
        !includeInternalSystemMessages
      ) {
        const parsedInput = parsePromptInput(decoded.input);
        if (parsedInput && shouldRenderThreadStartInput(options?.threadStatus)) {
          const signature = userMessageSignature({
            text: parsedInput.text,
            webImages: parsedInput.webImages,
            localImages: parsedInput.localImages,
            localFiles: parsedInput.localFiles,
          });
          const startSource = decoded.source;
          const isClientThreadStart = eventType === "client/thread/start";
          const isClientTurnRequested = eventType === "client/turn/requested";
          const isClientTurnStart = eventType === "client/turn/start";
          const pendingThreadStartCount =
            pendingClientThreadStartUserSignatureCounts.get(signature) ?? 0;
          const pendingRequestedCount =
            pendingClientRequestedUserSignatureCounts.get(signature) ?? 0;
          const pendingProviderCount =
            pendingProviderUserSignatureCounts.get(signature) ?? 0;
          if (isClientTurnStart && startSource === "spawn" && pendingThreadStartCount > 0) {
            continue;
          }
          if (isClientTurnStart && pendingRequestedCount > 0) {
            continue;
          }
          if (isClientTurnStart && pendingProviderCount > 0) {
            if (pendingProviderCount === 1) {
              pendingProviderUserSignatureCounts.delete(signature);
            } else {
              pendingProviderUserSignatureCounts.set(
                signature,
                pendingProviderCount - 1,
              );
            }
            continue;
          }
          pendingClientStartUserSignatureCounts.set(
            signature,
            (pendingClientStartUserSignatureCounts.get(signature) ?? 0) + 1,
          );
          if (isClientThreadStart) {
            pendingClientThreadStartUserSignatureCounts.set(
              signature,
              pendingThreadStartCount + 1,
            );
          }
          if (isClientTurnRequested) {
            pendingClientRequestedUserSignatureCounts.set(
              signature,
              pendingRequestedCount + 1,
            );
          }
        }
        continue;
      }
    }

    const userFromClientThreadStart = parseUserFromClientStart(
      decoded,
      meta,
      options,
    );
    if (userFromClientThreadStart) {
      const signature = userMessageSignature({
        text: userFromClientThreadStart.text,
        webImages: userFromClientThreadStart.attachments?.webImages ?? 0,
        localImages: userFromClientThreadStart.attachments?.localImages ?? 0,
        localFiles: userFromClientThreadStart.attachments?.localFiles ?? 0,
      });
      const startSource = (decoded.type === "client/thread/start" || decoded.type === "client/turn/requested" || decoded.type === "client/turn/start") ? decoded.source : undefined;
      const isClientThreadStart = eventType === "client/thread/start";
      const isClientTurnRequested = eventType === "client/turn/requested";
      const isClientTurnStart = eventType === "client/turn/start";
      const pendingThreadStartCount =
        pendingClientThreadStartUserSignatureCounts.get(signature) ?? 0;
      if (isClientTurnStart && startSource === "spawn" && pendingThreadStartCount > 0) {
        continue;
      }
      const pendingRequestedCount =
        pendingClientRequestedUserSignatureCounts.get(signature) ?? 0;
      if (isClientTurnStart && pendingRequestedCount > 0) {
        continue;
      }
      const pendingProviderCount =
        pendingProviderUserSignatureCounts.get(signature) ?? 0;
      if (isClientTurnStart && pendingProviderCount > 0) {
        if (pendingProviderCount === 1) {
          pendingProviderUserSignatureCounts.delete(signature);
        } else {
          pendingProviderUserSignatureCounts.set(
            signature,
            pendingProviderCount - 1,
          );
        }
        continue;
      }
      const key = `${userFromClientThreadStart.id}:${userFromClientThreadStart.text}`;
      if (!state.seenUserKeys.has(key)) {
        state.seenUserKeys.add(key);
        pendingClientStartUserSignatureCounts.set(
          signature,
          (pendingClientStartUserSignatureCounts.get(signature) ?? 0) + 1,
        );
        if (isClientThreadStart) {
          pendingClientThreadStartUserSignatureCounts.set(
            signature,
            pendingThreadStartCount + 1,
          );
        }
        if (isClientTurnRequested) {
          pendingClientRequestedUserSignatureCounts.set(
            signature,
            pendingRequestedCount + 1,
          );
        }
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(userFromClientThreadStart);
      }
      continue;
    }

    const managerUserMessage = parseManagerUserMessage(decoded, meta);
    if (managerUserMessage) {
      flushToolActivityBeforeNonToolMessage(state);
      state.messages.push(managerUserMessage);
      continue;
    }

    const userMessage = parseUserFromItemEvent(decoded, meta);
    if (userMessage) {
      const signature = userMessageSignature({
        text: userMessage.text,
        webImages: userMessage.attachments?.webImages ?? 0,
        localImages: userMessage.attachments?.localImages ?? 0,
        localFiles: userMessage.attachments?.localFiles ?? 0,
      });
      const pendingClientStartCount =
        pendingClientStartUserSignatureCounts.get(signature) ?? 0;
      if (pendingClientStartCount > 0) {
        if (pendingClientStartCount === 1) {
          pendingClientStartUserSignatureCounts.delete(signature);
        } else {
          pendingClientStartUserSignatureCounts.set(
            signature,
            pendingClientStartCount - 1,
          );
        }
        const pendingThreadStartCount =
          pendingClientThreadStartUserSignatureCounts.get(signature) ?? 0;
        if (pendingThreadStartCount === 1) {
          pendingClientThreadStartUserSignatureCounts.delete(signature);
        } else if (pendingThreadStartCount > 1) {
          pendingClientThreadStartUserSignatureCounts.set(
            signature,
            pendingThreadStartCount - 1,
          );
        }
        const dedupeKey = `${userMessage.turnId ?? userMessage.id}:${userMessage.text}`;
        state.seenUserKeys.add(dedupeKey);
        continue;
      }
      const key = `${userMessage.turnId ?? userMessage.id}:${userMessage.text}`;
      if (!state.seenUserKeys.has(key)) {
        state.seenUserKeys.add(key);
        pendingProviderUserSignatureCounts.set(
          signature,
          (pendingProviderUserSignatureCounts.get(signature) ?? 0) + 1,
        );
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(userMessage);
      }
      continue;
    }

    // Extract itemId from decoded for delta/final event grouping
    const decodedItemId = (decoded.type === "item/agentMessage/delta" ||
      decoded.type === "item/reasoning/summaryTextDelta" ||
      decoded.type === "item/reasoning/textDelta")
      ? decoded.itemId
      : (decoded.type === "item/completed" && (decoded.item.type === "agentMessage" || decoded.item.type === "reasoning"))
        ? decoded.item.id
        : undefined;

    const assistantDelta = options?.threadType === "manager"
      ? null
      : parseAssistantDeltaText(decoded);
    if (assistantDelta) {
      const turnKey = decodedItemId ?? eventTurnId ?? `seq-${meta.seq}`;
      if (state.finalizedAssistantTurnKeys.has(turnKey)) {
        continue;
      }

      let existing = state.openAssistantByTurn.get(turnKey);
      if (existing?.status === "completed") {
        continue;
      }
      if (!existing) {
        existing = {
          kind: "assistant-text",
          id: messageId(decoded.threadId, "assistant", turnKey),
          threadId: decoded.threadId,
          sourceSeqStart: meta.seq,
          sourceSeqEnd: meta.seq,
          createdAt: meta.createdAt,
          ...(eventTurnId ? { turnId: eventTurnId } : {}),
          text: assistantDelta,
          status: "streaming",
        };
        state.openAssistantByTurn.set(turnKey, existing);
      } else {
        existing.sourceSeqEnd = meta.seq;
        existing.createdAt = meta.createdAt;
        existing.text += assistantDelta;
      }
      continue;
    }

    const assistantFinal = options?.threadType === "manager"
      ? null
      : parseAssistantFinalText(decoded);
    if (assistantFinal) {
      const turnKey = decodedItemId ?? eventTurnId ?? `seq-${meta.seq}`;
      if (state.finalizedAssistantTurnKeys.has(turnKey)) {
        continue;
      }
      const existing = state.openAssistantByTurn.get(turnKey);

      if (existing) {
        existing.sourceSeqEnd = meta.seq;
        existing.createdAt = meta.createdAt;
        existing.text = assistantFinal;
        existing.status = "completed";
        state.openAssistantByTurn.delete(turnKey);
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(existing);
        state.finalizedAssistantTurnKeys.add(turnKey);
      } else {
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push({
          kind: "assistant-text",
          id: messageId(decoded.threadId, "assistant", `${turnKey}:${meta.seq}`),
          threadId: decoded.threadId,
          sourceSeqStart: meta.seq,
          sourceSeqEnd: meta.seq,
          createdAt: meta.createdAt,
          ...(eventTurnId ? { turnId: eventTurnId } : {}),
          text: assistantFinal,
          status: "completed",
        });
        state.finalizedAssistantTurnKeys.add(turnKey);
      }
      continue;
    }

    const reasoningDelta = options?.threadType === "manager"
      ? null
      : parseReasoningDeltaText(decoded);
    if (reasoningDelta) {
      const turnKey = decodedItemId ?? eventTurnId ?? `seq-${meta.seq}`;
      if (state.finalizedReasoningTurnKeys.has(turnKey)) {
        continue;
      }

      let existing = state.openReasoningByTurn.get(turnKey);
      if (!existing) {
        existing = {
          kind: "assistant-reasoning",
          id: messageId(decoded.threadId, "reasoning", turnKey),
          threadId: decoded.threadId,
          sourceSeqStart: meta.seq,
          sourceSeqEnd: meta.seq,
          createdAt: meta.createdAt,
          ...(eventTurnId ? { turnId: eventTurnId } : {}),
          text: reasoningDelta,
          status: "streaming",
        };
        state.openReasoningByTurn.set(turnKey, existing);
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push(existing);
      } else {
        existing.sourceSeqEnd = meta.seq;
        existing.createdAt = meta.createdAt;
        existing.text += reasoningDelta;
      }
      continue;
    }

    const reasoningFinal = options?.threadType === "manager"
      ? null
      : parseReasoningFinalText(decoded);
    if (reasoningFinal) {
      const turnKey = decodedItemId ?? eventTurnId ?? `seq-${meta.seq}`;
      const existing = state.openReasoningByTurn.get(turnKey);

      if (existing) {
        existing.sourceSeqEnd = meta.seq;
        existing.createdAt = meta.createdAt;
        existing.text = reasoningFinal;
        existing.status = "completed";
        state.openReasoningByTurn.delete(turnKey);
        state.finalizedReasoningTurnKeys.add(turnKey);
      } else {
        flushToolActivityBeforeNonToolMessage(state);
        state.messages.push({
          kind: "assistant-reasoning",
          id: messageId(decoded.threadId, "reasoning", `${turnKey}:${meta.seq}`),
          threadId: decoded.threadId,
          sourceSeqStart: meta.seq,
          sourceSeqEnd: meta.seq,
          createdAt: meta.createdAt,
          ...(eventTurnId ? { turnId: eventTurnId } : {}),
          text: reasoningFinal,
          status: "completed",
        });
        state.finalizedReasoningTurnKeys.add(turnKey);
      }
      continue;
    }

    const execEvent = parseExecLifecycleEvent(decoded, meta, originalEvent);
    if (execEvent) {
      if (execEvent.kind === "begin") {
        onExecBegin(state, meta, decoded.threadId, eventTurnId, execEvent.call);
      } else if (execEvent.kind === "output") {
        onExecOutput(state, meta, execEvent.call, execEvent.appendOutput);
      } else {
        onExecEnd(state, meta, decoded.threadId, eventTurnId, execEvent.call);
      }
      continue;
    }

    const toolCallEvent = parseToolCallLifecycleEvent(decoded, meta, originalEvent);
    if (toolCallEvent) {
      if (toolCallEvent.kind === "begin") {
        onExecBegin(state, meta, decoded.threadId, eventTurnId, toolCallEvent.call);
      } else {
        onExecEnd(state, meta, decoded.threadId, eventTurnId, toolCallEvent.call);
      }
      continue;
    }

    const webSearchEvent = parseWebSearchLifecycleEvent(decoded);
    if (webSearchEvent) {
      if (webSearchEvent.kind === "begin") {
        onWebSearchBegin(state, meta, decoded.threadId, eventTurnId, webSearchEvent);
      } else {
        onWebSearchEnd(state, meta, decoded.threadId, eventTurnId, webSearchEvent);
      }
      continue;
    }

    const fileEdit = parseFileEditFromItemEvent(decoded);
    if (fileEdit) {
      flushToolActivityBeforeNonToolMessage(state);
      upsertFileEdit(state, meta, decoded.threadId, eventTurnId, fileEdit);
      continue;
    }

    const compactionEvent = parseCompactionLifecycleEvent(decoded, meta);
    if (compactionEvent) {
      flushToolActivityBeforeNonToolMessage(state);
      if (compactionEvent.kind === "begin") {
        onCompactionBegin(state, meta, decoded.threadId, eventTurnId, compactionEvent);
      } else {
        onCompactionEnd(state, meta, decoded.threadId, eventTurnId, compactionEvent);
      }
      continue;
    }

    const operation = parseOperationMessage(decoded, meta, {
      includeOptionalOperations: options?.includeOptionalOperations,
    });
    if (operation) {
      flushToolActivityBeforeNonToolMessage(state);
      state.messages.push(operation);
      continue;
    }

    const error = parseErrorMessage(decoded, meta);
    if (error) {
      flushToolActivityBeforeNonToolMessage(state);
      state.messages.push(error);
      continue;
    }

    if (includeDebugRawEvents) {
      const debugReason = isDuplicateEventType(eventType)
        ? "duplicate-event"
        : (isIgnoredNoiseType(eventType) || isIgnoredItemStartEvent(decoded))
          ? "ignored-noise"
          : "unhandled";

      if (debugReason !== "unhandled") {
        continue;
      }

      flushToolActivityBeforeNonToolMessage(state);
      appendDebugEvent(
        state.messages,
        originalEvent,
        decoded,
        meta,
        debugReason,
      );
    }
  }

  finalizePendingMessages(state, options);
  return state.messages;
}
