import type {
  PromptInput,
  SpawnThreadRequest,
  Thread,
  ThreadEvent,
} from "@beanbag/core";
import { listCodexModels } from "./codex-models.js";
import type {
  ProviderAdapter,
  ProviderExecutionOptions,
  ProviderTitleGenerator,
  ProviderTitleGeneratorArgs,
} from "./provider-adapter.js";

const DEFAULT_BASE_INSTRUCTIONS =
  "You are a coding agent working on a project thread. Follow the instructions carefully and write clean, working code.";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeProviderEventType(type: string): string {
  return type.toLowerCase().replaceAll(".", "/");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function getStringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getItemRecord(data: unknown): Record<string, unknown> | null {
  const params = asRecord(data);
  if (!params) return null;
  return asRecord(params.item);
}

function getTurnId(data: unknown): string | undefined {
  const params = asRecord(data);
  if (!params) return undefined;

  if (typeof params.turnId === "string" && params.turnId.length > 0) {
    return params.turnId;
  }

  const turn = asRecord(params.turn);
  if (!turn) return undefined;
  return typeof turn.id === "string" && turn.id.length > 0 ? turn.id : undefined;
}

function getItemId(data: unknown): string | undefined {
  const params = asRecord(data);
  if (!params) return undefined;

  if (typeof params.itemId === "string" && params.itemId.length > 0) {
    return params.itemId;
  }

  const item = getItemRecord(data);
  if (!item) return undefined;
  return typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;
}

function getItemTypeToken(data: unknown): string {
  const item = getItemRecord(data);
  const itemType = getStringField(item, "type");
  return itemType ? normalizeToken(itemType) : "";
}

function getNumberField(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getProviderMessageRecord(data: unknown): Record<string, unknown> | null {
  const params = asRecord(data);
  if (!params) return null;
  return asRecord(params.msg);
}

function normalizeCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }

  return undefined;
}

function extractToolCallId(data: unknown): string | undefined {
  const params = asRecord(data);
  const msg = getProviderMessageRecord(data);
  const item = getItemRecord(data);

  return (
    getStringField(params, "callId") ??
    getStringField(params, "call_id") ??
    getStringField(msg, "callId") ??
    getStringField(msg, "call_id") ??
    getStringField(item, "callId") ??
    getStringField(item, "call_id") ??
    getStringField(item, "id") ??
    getStringField(params, "itemId")
  );
}

function extractToolCallTurnId(data: unknown): string | undefined {
  const turnId = getTurnId(data);
  if (turnId) return turnId;

  const params = asRecord(data);
  const msg = getProviderMessageRecord(data);
  return getStringField(params, "turn_id") ?? getStringField(msg, "turn_id");
}

function toCanonicalToolCallData(data: unknown): Record<string, unknown> {
  const params = asRecord(data);
  const msg = getProviderMessageRecord(data);
  const item = getItemRecord(data);
  const itemResult =
    asRecord(item?.result) ??
    asRecord(params?.result) ??
    asRecord(msg?.result);

  const callId = extractToolCallId(data);
  const turnId = extractToolCallTurnId(data);
  const command =
    normalizeCommand(item?.command) ??
    normalizeCommand(item?.cmd) ??
    normalizeCommand(item?.commandLine) ??
    normalizeCommand(item?.command_line) ??
    normalizeCommand(msg?.command) ??
    normalizeCommand(msg?.cmd) ??
    normalizeCommand(msg?.commandLine) ??
    normalizeCommand(msg?.command_line) ??
    normalizeCommand(params?.command) ??
    normalizeCommand(params?.cmd);
  const cwd =
    getStringField(item, "cwd") ??
    getStringField(msg, "cwd") ??
    getStringField(params, "cwd");
  const status =
    getStringField(itemResult, "status") ??
    getStringField(item, "status") ??
    getStringField(msg, "status") ??
    getStringField(params, "status");
  const exitCode =
    getNumberField(itemResult, "exitCode") ??
    getNumberField(itemResult, "exit_code") ??
    getNumberField(item, "exitCode") ??
    getNumberField(item, "exit_code") ??
    getNumberField(msg, "exitCode") ??
    getNumberField(msg, "exit_code") ??
    getNumberField(params, "exitCode") ??
    getNumberField(params, "exit_code");
  const outputText = extractText(
    itemResult?.output ??
      itemResult?.stdout ??
      item?.output ??
      item?.stdout ??
      msg?.output ??
      msg?.stdout ??
      params?.output ??
      params?.stdout,
  );
  const errorText = extractText(
    itemResult?.stderr ?? item?.stderr ?? msg?.stderr ?? params?.stderr,
  );
  const output =
    outputText.trim().length > 0
      ? outputText
      : errorText.trim().length > 0
        ? errorText
        : undefined;

  return {
    toolName: "exec_command",
    ...(turnId ? { turnId } : {}),
    ...(callId ? { callId } : {}),
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(status ? { status } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(output ? { output } : {}),
  };
}

function collectTextFragments(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.length > 0) {
      out.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTextFragments(entry, out);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  const candidates = [
    record.delta,
    record.text,
    record.content,
    record.value,
    record.summary,
    record.summaryText,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    collectTextFragments(candidate, out);
  }
}

function extractText(value: unknown): string {
  const parts: string[] = [];
  collectTextFragments(value, parts);
  return parts.join("");
}

function extractItemText(item: Record<string, unknown> | null): string {
  if (!item) return "";

  if (typeof item.text === "string") {
    return item.text;
  }

  const text = extractText(item.content);
  return text.trim().length > 0 ? text : "";
}

function extractReasoningText(item: Record<string, unknown> | null): string {
  if (!item) return "";

  const summaryText = extractText(item.summary ?? item.summaryText);
  if (summaryText.trim().length > 0) {
    return summaryText;
  }

  const contentText = extractText(item.content ?? item.rawContent);
  return contentText.trim().length > 0 ? contentText : "";
}

function countAttachments(data: unknown): { webImages: number; localImages: number } {
  const item = getItemRecord(data);
  const content = Array.isArray(item?.content) ? item.content : [];

  let webImages = 0;
  let localImages = 0;

  for (const chunk of content) {
    const record = asRecord(chunk);
    if (!record) continue;
    const chunkType =
      typeof record.type === "string" ? normalizeToken(record.type) : "";
    if (chunkType === "image") {
      webImages += 1;
      continue;
    }
    if (chunkType === "localimage") {
      localImages += 1;
    }
  }

  return { webImages, localImages };
}

function toCanonicalErrorData(type: string, data: unknown): Record<string, unknown> {
  if (typeof data === "string" && data.trim().length > 0) {
    return {
      message: data.trim(),
      provider: "codex",
      providerEventType: type,
    };
  }

  const payload = asRecord(data);
  const message =
    getStringField(payload, "message") ??
    getStringField(asRecord(payload?.error), "message");
  if (!message) {
    return {
      provider: "codex",
      providerEventType: type,
      payload: data,
    };
  }

  return {
    message,
    provider: "codex",
    providerEventType: type,
  };
}

function toCanonicalProviderEventData(
  providerEventType: string,
  payload: unknown,
): Record<string, unknown> {
  return {
    provider: "codex",
    providerEventType,
    payload,
  };
}

function toCanonicalTurnStartedData(data: unknown): Record<string, unknown> {
  const params = asRecord(data);
  const turnId = getTurnId(data);
  const input = Array.isArray(params?.input) ? (params.input as PromptInput[]) : [];

  return {
    ...(turnId ? { turnId } : {}),
    ...(input.length > 0 ? { input } : {}),
  };
}

function toCanonicalTurnCompletedData(data: unknown): Record<string, unknown> {
  const turnId = getTurnId(data);
  return {
    ...(turnId ? { turnId } : {}),
  };
}

function toCanonicalTitleUpdatedData(data: unknown): Record<string, unknown> {
  const payload = asRecord(data);
  const title = normalizeTitle(payload?.threadName ?? payload?.thread_name);

  return {
    ...(title ? { title } : {}),
  };
}

function toCanonicalUserMessageData(data: unknown): Record<string, unknown> {
  const item = getItemRecord(data);
  const text = extractItemText(item);
  const turnId = getTurnId(data);
  const itemId = getItemId(data);
  const attachments = countAttachments(data);

  return {
    role: "user",
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    text,
    attachments,
  };
}

function toCanonicalAssistantMessageData(data: unknown): Record<string, unknown> {
  const item = getItemRecord(data);
  const text = extractItemText(item);
  const turnId = getTurnId(data);
  const itemId = getItemId(data);

  return {
    role: "assistant",
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    text,
  };
}

function toCanonicalReasoningMessageData(data: unknown): Record<string, unknown> {
  const item = getItemRecord(data);
  const text = extractReasoningText(item);
  const turnId = getTurnId(data);
  const itemId = getItemId(data);

  return {
    role: "assistant",
    kind: "reasoning",
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    text,
  };
}

function toCanonicalAssistantDeltaData(data: unknown): Record<string, unknown> {
  const params = asRecord(data);
  const text = extractText(params?.delta ?? params?.text ?? params?.content);
  const turnId = getTurnId(data);
  const itemId = getItemId(data);

  return {
    role: "assistant",
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    text,
    delta: text,
  };
}

function toCanonicalReasoningDeltaData(data: unknown): Record<string, unknown> {
  const params = asRecord(data);
  const text = extractText(params?.delta ?? params?.text ?? params?.content);
  const turnId = getTurnId(data);
  const itemId = getItemId(data);

  return {
    role: "assistant",
    kind: "reasoning",
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    text,
    delta: text,
  };
}

function toCanonicalEvent(event: ThreadEvent): ThreadEvent {
  const normalized = normalizeProviderEventType(event.type);

  if (
    normalized === "turn/started" ||
    normalized === "turn/completed" ||
    normalized === "thread/title/updated" ||
    normalized === "tool/call/started" ||
    normalized === "tool/call/completed" ||
    normalized === "message/user" ||
    normalized === "message/assistant" ||
    normalized === "message/assistant/delta" ||
    normalized === "message/reasoning" ||
    normalized === "message/reasoning/delta" ||
    normalized === "error" ||
    normalized === "provider/event"
  ) {
    return event;
  }

  if (normalized === "turn/start" || normalized === "turn/started") {
    return {
      ...event,
      type: "turn/started",
      data: toCanonicalTurnStartedData(event.data),
    };
  }

  if (normalized === "turn/end" || normalized === "turn/completed") {
    return {
      ...event,
      type: "turn/completed",
      data: toCanonicalTurnCompletedData(event.data),
    };
  }

  if (normalized === "thread/name/updated") {
    return {
      ...event,
      type: "thread/title/updated",
      data: toCanonicalTitleUpdatedData(event.data),
    };
  }

  if (normalized === "item/agentmessage/delta") {
    return {
      ...event,
      type: "message/assistant/delta",
      data: toCanonicalAssistantDeltaData(event.data),
    };
  }

  if (normalized === "item/reasoning/summarytextdelta") {
    return {
      ...event,
      type: "message/reasoning/delta",
      data: toCanonicalReasoningDeltaData(event.data),
    };
  }

  if (
    normalized === "codex/event/exec_command_begin" ||
    normalized === "exec_command_begin"
  ) {
    return {
      ...event,
      type: "tool/call/started",
      data: toCanonicalToolCallData(event.data),
    };
  }

  if (
    normalized === "codex/event/exec_command_end" ||
    normalized === "exec_command_end"
  ) {
    return {
      ...event,
      type: "tool/call/completed",
      data: toCanonicalToolCallData(event.data),
    };
  }

  if (normalized === "item/started" && getItemTypeToken(event.data) === "commandexecution") {
    return {
      ...event,
      type: "tool/call/started",
      data: toCanonicalToolCallData(event.data),
    };
  }

  if (normalized === "item/completed") {
    const itemTypeToken = getItemTypeToken(event.data);
    if (itemTypeToken === "usermessage") {
      return {
        ...event,
        type: "message/user",
        data: toCanonicalUserMessageData(event.data),
      };
    }
    if (itemTypeToken === "agentmessage") {
      return {
        ...event,
        type: "message/assistant",
        data: toCanonicalAssistantMessageData(event.data),
      };
    }
    if (itemTypeToken === "reasoning") {
      return {
        ...event,
        type: "message/reasoning",
        data: toCanonicalReasoningMessageData(event.data),
      };
    }
    if (itemTypeToken === "commandexecution") {
      return {
        ...event,
        type: "tool/call/completed",
        data: toCanonicalToolCallData(event.data),
      };
    }
  }

  if (normalized.includes("error")) {
    return {
      ...event,
      type: "error",
      data: toCanonicalErrorData(normalized, event.data),
    };
  }

  return {
    ...event,
    type: "provider/event",
    data: toCanonicalProviderEventData(normalized, event.data),
  };
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= 60) return normalized;
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

function withExecutionOptions(
  params: Record<string, unknown>,
  options?: ProviderExecutionOptions,
): Record<string, unknown> {
  if (!options) {
    return params;
  }

  const nextParams = { ...params };
  if (options.model) {
    nextParams.model = options.model;
  }
  if (options.reasoningLevel) {
    nextParams.config = {
      model_reasoning_effort: options.reasoningLevel,
    };
  }
  return nextParams;
}

function deriveThreadTitleFromInput(input?: PromptInput[]): string | undefined {
  if (!input || input.length === 0) return undefined;
  const textChunk = input.find(
    (chunk): chunk is Extract<PromptInput, { type: "text" }> =>
      chunk.type === "text" && chunk.text.trim().length > 0,
  );
  if (!textChunk) return undefined;
  return normalizeTitle(textChunk.text);
}

function extractThreadIdFromResult(result: unknown): string | undefined {
  const payload = asRecord(result);
  if (!payload) return undefined;

  if (typeof payload.threadId === "string" && payload.threadId.trim().length > 0) {
    return payload.threadId;
  }

  const thread = asRecord(payload.thread);
  if (thread && typeof thread.id === "string" && thread.id.trim().length > 0) {
    return thread.id;
  }

  return undefined;
}

function outputFromEvent(event: ThreadEvent): string | undefined {
  const normalizedType = normalizeProviderEventType(event.type);

  if (normalizedType === "message/assistant") {
    const payload = asRecord(event.data);
    if (typeof payload?.text !== "string") return undefined;
    return payload.text;
  }

  if (normalizedType !== "item/completed") return undefined;

  const payload = asRecord(event.data);
  const item = asRecord(payload?.item);
  if (!item) return undefined;
  if (item.type !== "agentMessage") return undefined;
  if (typeof item.text !== "string") return undefined;
  return item.text;
}

export interface CreateCodexProviderAdapterOptions {
  titleGenerator?: ProviderTitleGenerator;
}

export function createCodexProviderAdapter(
  opts?: CreateCodexProviderAdapterOptions,
): ProviderAdapter {
  const titleGenerator = opts?.titleGenerator;

  return {
    id: "codex",
    displayName: "Codex app-server",
    capabilities: {
      supportsSteer: true,
      supportsRename: true,
      supportsModelList: true,
      supportsReasoningLevels: true,
      supportsMultimodalInput: true,
    },
    processCommand: "codex",
    processArgs: ["app-server"],
    clientInfo: {
      name: "beanbag",
      version: "0.0.1",
    },
    initializeMethod: "initialize",
    threadStartMethod: "thread/start",
    threadResumeMethod: "thread/resume",
    turnStartMethod: "turn/start",
    turnSteerMethod: "turn/steer",
    threadNameSetMethod: "thread/name/set",
    createThreadStartParams(req: SpawnThreadRequest): Record<string, unknown> {
      return withExecutionOptions(
        {
          approvalPolicy: "never",
          baseInstructions: DEFAULT_BASE_INSTRUCTIONS,
        },
        req,
      );
    },
    createThreadResumeParams(
      providerThreadId: string,
      options?: ProviderExecutionOptions,
    ): Record<string, unknown> {
      return withExecutionOptions({ threadId: providerThreadId }, options);
    },
    createTurnStartParams(
      providerThreadId: string,
      input: PromptInput[],
      options?: ProviderExecutionOptions,
    ): Record<string, unknown> {
      return withExecutionOptions(
        {
          threadId: providerThreadId,
          input,
        },
        options,
      );
    },
    createTurnSteerParams(
      providerThreadId: string,
      expectedTurnId: string,
      input: PromptInput[],
    ): Record<string, unknown> {
      return {
        threadId: providerThreadId,
        expectedTurnId,
        input,
      };
    },
    createThreadNameSetParams(
      providerThreadId: string,
      title: string,
    ): Record<string, unknown> {
      return {
        threadId: providerThreadId,
        name: title,
      };
    },
    extractThreadIdFromResult,
    extractThreadIdFromEventData(data: unknown): string | undefined {
      const payload = asRecord(data);
      if (!payload) return undefined;

      if (typeof payload.threadId === "string" && payload.threadId.trim().length > 0) {
        return payload.threadId;
      }

      const thread = asRecord(payload.thread);
      if (thread && typeof thread.id === "string" && thread.id.trim().length > 0) {
        return thread.id;
      }

      return undefined;
    },
    normalizeEventType(type: string): string {
      return normalizeProviderEventType(type);
    },
    shouldBroadcastForEvent(method: string): boolean {
      const normalized = normalizeProviderEventType(method);
      if (normalized.startsWith("codex/event/")) return false;
      if (normalized === "item/agentmessage/delta") return false;
      if (normalized === "item/reasoning/summarytextdelta") return false;
      return true;
    },
    statusForEvent(method: string): Thread["status"] | undefined {
      const normalized = normalizeProviderEventType(method);
      if (normalized === "turn/start" || normalized === "turn/started") {
        return "active";
      }
      if (normalized === "turn/completed" || normalized === "turn/end") {
        return "idle";
      }
      return undefined;
    },
    titleFromEvent(method: string, data: unknown): string | undefined {
      const normalizedMethod = normalizeProviderEventType(method);
      const payload = asRecord(data);

      if (normalizedMethod === "thread/started") {
        const thread = asRecord(payload?.thread);
        return normalizeTitle(thread?.preview);
      }

      if (normalizedMethod === "thread/name/updated") {
        return normalizeTitle(payload?.threadName ?? payload?.thread_name);
      }

      return undefined;
    },
    outputFromEvent,
    toCanonicalEvent,
    listModels() {
      return listCodexModels();
    },
    deriveThreadTitle(input?: PromptInput[]): string | undefined {
      return deriveThreadTitleFromInput(input);
    },
    ...(titleGenerator
      ? {
          async generateThreadTitle(
            args: ProviderTitleGeneratorArgs,
          ): Promise<string | undefined> {
            const generated = await titleGenerator(args);
            return normalizeTitle(generated);
          },
        }
      : {}),
    inactiveSessionErrorMessage(threadId: string): string {
      return `Thread ${threadId} has no codex session`;
    },
  };
}
