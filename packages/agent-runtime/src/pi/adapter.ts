/**
 * Pi provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the Pi coding agent bridge
 * process. Uses the Pi AI SDK for model catalog and authentication. The adapter
 * owns event translation: it takes raw `AgentSessionEvent` from the Pi SDK
 * and produces `ThreadEvent[]`.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { supportsXhigh, type Model } from "@mariozechner/pi-ai";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import type {
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type {
  AvailableModel,
  ModelReasoningEffort,
  ProviderCapabilities,
  ThreadEvent,
  ThreadEventItem,
  ThreadEventTokenUsage,
  ThreadEventTokenUsageBreakdown,
  ToolCallRequest,
} from "@bb/domain";
import {
  decodeProviderToolCallRequest,
} from "../shared/provider-tool-call-contract.js";
import {
  bashArgsSchema,
} from "../shared/tool-arg-schemas.js";
import {
  HIGH_REASONING_EFFORT,
  buildEditDiff,
  extractResultText,
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
  toNonNegativeNumber,
  toOptionalString,
  withParentToolCallId,
} from "../shared/adapter-utils.js";
import {
  buildUnhandledProviderEvents,
  createUnhandledProviderEvent,
} from "../shared/provider-unhandled-event.js";
import {
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
} from "../shared/json-rpc-envelope.js";
import type {
  AdapterCommand,
  AdapterOptions,
  JsonRpcMessage,
  ProviderTranslationContext,
  ProviderAdapter,
} from "../provider-adapter.js";
import { piVisibilityMetadata } from "./visibility.js";

// ---------------------------------------------------------------------------
// Pi event and command types
// ---------------------------------------------------------------------------

/** The raw SDK event type from the Pi coding agent. */
export type PiEvent = AgentSessionEvent;

interface PiUnhandledEventArgs {
  rawEvent: JsonRpcMessage;
  parentToolCallId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function buildUnhandledPiEvent(
  args: PiUnhandledEventArgs,
): ThreadEvent[] {
  return buildUnhandledProviderEvents({
    providerId: "pi",
    rawEvent: args.rawEvent,
    visibilityMetadata: piVisibilityMetadata,
    ...(args.parentToolCallId ? { parentToolCallId: args.parentToolCallId } : {}),
  });
}

function buildUnexpectedPiSdkEvent(
  rawMessage: PiEvent,
  context?: ProviderTranslationContext,
): ThreadEvent[] {
  const rawEvent: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: "sdk/message",
    params: {
      ...(context?.threadId ? { threadId: context.threadId } : {}),
      message: rawMessage,
    },
  };
  return [
    createUnhandledProviderEvent({
      providerId: "pi",
      rawEvent,
      rawType: piVisibilityMetadata.describeRawEvent(rawEvent).kind,
      ...(context?.parentToolCallId
        ? { parentToolCallId: context.parentToolCallId }
        : {}),
    }),
  ];
}


const PI_DEFAULT_MODEL_PREFERENCES = [
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-20250514",
  "openai/codex-mini",
] as const;

// ---------------------------------------------------------------------------
// Pi-specific helpers
// ---------------------------------------------------------------------------

type PiCatalogModel = Pick<
  Model<any>,
  "id" | "name" | "provider" | "reasoning" | "input"
>;

const piFileEditArgsSchema = z.object({
  path: z.string().optional(),
  oldText: z.string().optional(),
  newText: z.string().optional(),
  content: z.string().optional(),
}).passthrough();

type PiFileEditArgs = z.infer<typeof piFileEditArgsSchema>;
type PiPendingFileChangeItem = Extract<ThreadEventItem, { type: "fileChange" }>;

interface PiToolUseTranslationInput {
  callId: string;
  toolName: string;
  args: unknown;
  parentToolCallId?: string;
}

interface PiToolResultTranslationInput {
  callId: string;
  toolName?: string;
  content: unknown;
  isError: boolean;
  parentToolCallId?: string;
  startedItem?: ThreadEventItem;
}

function buildPiFileChangeItem(
  args: PiFileEditArgs,
): PiPendingFileChangeItem | null {
  if (!args.path) {
    return null;
  }

  const diff = buildEditDiff(
    args.path,
    args.oldText,
    args.newText,
  );

  return {
    type: "fileChange",
    id: "",
    changes: [{
      path: args.path,
      kind: "update",
      ...(diff ? { diff } : {}),
    }],
    status: "pending",
  };
}

function translatePiToolUseItem(
  input: PiToolUseTranslationInput,
): ThreadEventItem {
  const baseToolCall = {
    type: "toolCall" as const,
    id: input.callId,
    tool: input.toolName,
    arguments: input.args,
    status: "pending" as const,
  };

  switch (input.toolName) {
    case "bash": {
      const parsed = bashArgsSchema.safeParse(input.args);
      const command = parsed.success
        ? toOptionalString(parsed.data.command)
        : undefined;
      if (!command) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      return withParentToolCallId({
        type: "commandExecution",
        id: input.callId,
        command,
        cwd: parsed.success ? (toOptionalString(parsed.data.cwd) ?? "") : "",
        status: "pending",
      }, input.parentToolCallId);
    }
    case "edit":
    case "write": {
      const parsed = piFileEditArgsSchema.safeParse(input.args);
      if (!parsed.success) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      const fileChangeItem = buildPiFileChangeItem(parsed.data);
      if (!fileChangeItem) {
        return withParentToolCallId({
          ...baseToolCall,
          arguments: parsed.data,
        }, input.parentToolCallId);
      }
      return withParentToolCallId({
        ...fileChangeItem,
        id: input.callId,
      }, input.parentToolCallId);
    }
    default:
      return withParentToolCallId(baseToolCall, input.parentToolCallId);
  }
}

function translatePiToolResultItem(
  input: PiToolResultTranslationInput,
): ThreadEventItem {
  const outputText = extractResultText(input.content);
  const status = input.isError ? "failed" : "completed";
  const startedItem = input.startedItem;

  if (startedItem) {
    switch (startedItem.type) {
      case "commandExecution":
        return withParentToolCallId({
          type: "commandExecution",
          id: input.callId,
          command: startedItem.command,
          cwd: startedItem.cwd,
          aggregatedOutput: outputText,
          exitCode: input.isError ? 1 : 0,
          status,
        }, input.parentToolCallId ?? startedItem.parentToolCallId);
      case "fileChange":
        return withParentToolCallId({
          type: "fileChange",
          id: input.callId,
          changes: startedItem.changes,
          status,
        }, input.parentToolCallId ?? startedItem.parentToolCallId);
      case "toolCall":
        return withParentToolCallId({
          type: "toolCall",
          id: input.callId,
          tool: startedItem.tool,
          arguments: startedItem.arguments,
          status,
          result: outputText,
        }, input.parentToolCallId ?? startedItem.parentToolCallId);
      default:
        break;
    }
  }

  switch (input.toolName) {
    case "bash":
      return withParentToolCallId({
        type: "commandExecution",
        id: input.callId,
        command: "",
        cwd: "",
        aggregatedOutput: outputText,
        exitCode: input.isError ? 1 : 0,
        status,
      }, input.parentToolCallId);
    case "edit":
    case "write":
      return withParentToolCallId({
        type: "fileChange",
        id: input.callId,
        changes: [],
        status,
      }, input.parentToolCallId);
    default:
      return withParentToolCallId({
        type: "toolCall",
        id: input.callId,
        tool: input.toolName ?? "unknown",
        status,
        result: outputText,
      }, input.parentToolCallId);
  }
}

function resolveBridgePath(): string {
  // When running via vitest, __dirname points to src/ where .js doesn't exist.
  // Redirect to dist/ so the bridge is always the compiled JS.
  const dir = __dirname.includes("/src/")
    ? __dirname.replace("/src/", "/dist/")
    : __dirname;
  return resolve(dir, "bridge", "bridge.js");
}

function buildPiConfig(threadId: string, options?: AdapterOptions): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (threadId) config["shell_environment_policy.set.BB_THREAD_ID"] = threadId;
  const envVars = options?.envVars;
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      config[`shell_environment_policy.set.${key}`] = value;
    }
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export function buildPiAvailableModels(args: {
  providers: string[];
  getModels: (provider: string) => PiCatalogModel[];
  hasAuth: (provider: string) => boolean;
}): AvailableModel[] {
  const models: AvailableModel[] = [];
  for (const provider of args.providers) {
    if (!args.hasAuth(provider)) continue;
    for (const model of args.getModels(provider)) {
      const canonicalId = toCanonicalPiModelId(provider, model.id);
      const supportedReasoningEfforts = getPiReasoningEfforts(model);
      models.push({
        id: canonicalId,
        model: canonicalId,
        displayName: model.name,
        description: describePiModel(model),
        supportedReasoningEfforts,
        defaultReasoningEffort: model.reasoning ? "medium" : "low",
        isDefault: false,
      });
    }
  }
  const defaultId = resolveDefaultPiModelId(models);
  return models.map((m) => (m.id === defaultId ? { ...m, isDefault: true } : m));
}

async function listPiModels(): Promise<AvailableModel[]> {
  const [{ getModels, getProviders }, authStorageModule] = await Promise.all([
    import("@mariozechner/pi-ai"),
    Promise.resolve(AuthStorage.create()),
  ]);
  return buildPiAvailableModels({
    providers: getProviders(),
    // Pi SDK models are parameterized by provider name, but this adapter only
    // consumes a stable read-only subset of fields from the returned models.
    getModels: (provider) => getModels(provider as never) as PiCatalogModel[],
    hasAuth: (provider) => authStorageModule.hasAuth(provider),
  });
}

function toCanonicalPiModelId(provider: string, modelId: string): string {
  return modelId.includes("/") ? modelId : `${provider}/${modelId}`;
}

function getPiReasoningEfforts(model: PiCatalogModel): ModelReasoningEffort[] {
  if (!model.reasoning) return [LOW_REASONING_EFFORT];
  const efforts = [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT];
  // Pi SDK keeps the model generic parameter on supportsXhigh(), but this
  // adapter only needs the shared catalog fields captured by PiCatalogModel.
  if (supportsXhigh(model as Model<any>)) efforts.push(XHIGH_REASONING_EFFORT);
  return efforts;
}

function describePiModel(model: PiCatalogModel): string {
  const capabilities: string[] = [];
  capabilities.push(model.reasoning ? "reasoning" : "non-reasoning");
  if (model.input.includes("image")) capabilities.push("multimodal");
  const provider = model.provider.length > 0
    ? model.provider[0].toUpperCase() + model.provider.slice(1)
    : model.provider;
  return `${provider} ${capabilities.join(", ")} model via Pi`;
}

function resolveDefaultPiModelId(models: AvailableModel[]): string | undefined {
  for (const preferred of PI_DEFAULT_MODEL_PREFERENCES) {
    if (models.some((m) => m.id === preferred)) return preferred;
  }
  return models[0]?.id;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/** Options for overriding pi adapter defaults. Used by test infrastructure. */
export interface CreatePiProviderAdapterOptions {
  /** Override the bridge binary. */
  processCommand?: string;
  /** Override the bridge binary args. */
  processArgs?: string[];
  /** Extra environment variables for the bridge process. */
  launchEnv?: Record<string, string>;
  /** Override model listing. Used by unit tests to avoid real API calls. */
  listModels?: () => Promise<AvailableModel[]>;
}

interface PiTurnState {
  counter: number;
  currentTurnId: string | undefined;
  cumulativeTokens: ThreadEventTokenUsageBreakdown;
  toolItemsByCallId: Map<string, ThreadEventItem>;
}

export function createPiProviderAdapter(
  opts?: CreatePiProviderAdapterOptions,
): ProviderAdapter {
  const capabilities: ProviderCapabilities = {
    supportsRename: false,
    supportsServiceTier: false,
  };
  const models = opts?.listModels ?? listPiModels;

  // Per-thread turn state — Pi SDK doesn't have turn IDs, so the adapter
  // assigns them. Keyed by threadId so multiple threads sharing one adapter
  // instance don't corrupt each other's counters.
  // TODO: turnState grows unboundedly — needs a removeThread(threadId) method
  // on the adapter interface to clean up entries when threads are removed.
  const turnState = new Map<string, PiTurnState>();

  function getTurnState(threadId: string): PiTurnState {
    if (!turnState.has(threadId)) {
      turnState.set(threadId, {
        counter: 0,
        currentTurnId: undefined,
        cumulativeTokens: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
        toolItemsByCallId: new Map(),
      });
    }
    return turnState.get(threadId)!;
  }

  function translatePiEvent(
    event: unknown,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const parentToolCallId =
        sdkEnvelope.data.params.parent_tool_use_id ?? context?.parentToolCallId;
      const translated = translatePiEvent(sdkEnvelope.data.params.message, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      return translated.length > 0
        ? translated
        : buildUnhandledPiEvent({
            rawEvent: {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
    }

    const identityEnvelope = threadIdentityEnvelopeSchema.safeParse(event);
    if (identityEnvelope.success) {
      const { threadId = "", providerThreadId } = identityEnvelope.data.params;
      return providerThreadId
        ? [{ type: "thread/identity", threadId, providerThreadId }]
        : [];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      return [{
        type: "error",
        threadId: "",
        providerThreadId: "",
        message: errorEnvelope.data.params?.message ?? "unknown error",
      }];
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      return buildUnhandledPiEvent({
        rawEvent: {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        parentToolCallId: context?.parentToolCallId,
      });
    }

    const eventType = z.object({ type: z.string() }).safeParse(event);
    if (!eventType.success) {
      return [];
    }

    const piEvent = event as PiEvent;
    const threadId = "";
    const events: ThreadEvent[] = [];

    // Resolve per-thread turn state using the context threadId.
    const stateKey = context?.threadId ?? "";
    const state = getTurnState(stateKey);

    switch (piEvent.type) {
      case "agent_start": {
        if (!state.currentTurnId) {
          state.toolItemsByCallId.clear();
          state.counter += 1;
          state.currentTurnId = `turn-${state.counter}`;
          events.push({ type: "turn/started", threadId, providerThreadId: "", turnId: state.currentTurnId });
        }
        break;
      }

      case "agent_end": {
        const lastAssistant = findLastAssistantMessage(piEvent.messages);
        if (lastAssistant) {
          const text = extractAssistantText(lastAssistant);
          if (text) {
            events.push({
              type: "item/completed",
              threadId,
              providerThreadId: "",
              turnId: state.currentTurnId ?? "",
              item: { type: "agentMessage", id: `msg-${state.counter}`, text },
            });
          }
        }
        if (state.currentTurnId) {
          const tokenUsage = extractPiTokenUsage(lastAssistant, state.cumulativeTokens);
          if (tokenUsage) {
            events.push({
              type: "thread/tokenUsage/updated",
              threadId,
              providerThreadId: "",
              turnId: state.currentTurnId,
              tokenUsage,
            });
          }
          events.push({
            type: "turn/completed",
            threadId,
            providerThreadId: "",
            turnId: state.currentTurnId,
            status: "completed",
          });
          state.toolItemsByCallId.clear();
          state.currentTurnId = undefined;
        }
        break;
      }

      case "message_update": {
        const assistantEvent = piEvent.assistantMessageEvent;
        if (assistantEvent.type === "text_delta" && state.currentTurnId) {
          const delta = assistantEvent.delta;
          if (delta) {
            events.push({
              type: "item/agentMessage/delta",
              threadId,
              providerThreadId: "",
              turnId: state.currentTurnId,
              delta,
            });
          }
        }
        break;
      }

      case "tool_execution_start": {
        if (!state.currentTurnId) {
          return buildUnexpectedPiSdkEvent(piEvent, context);
        }
        const item = translatePiToolUseItem({
          callId: piEvent.toolCallId,
          toolName: piEvent.toolName,
          args: piEvent.args,
          parentToolCallId: context?.parentToolCallId,
        });
        state.toolItemsByCallId.set(piEvent.toolCallId, item);
        events.push({
          type: "item/started",
          threadId,
          providerThreadId: "",
          turnId: state.currentTurnId,
          item,
        });
        break;
      }

      case "tool_execution_end": {
        if (!state.currentTurnId) {
          return buildUnexpectedPiSdkEvent(piEvent, context);
        }
        const startedItem = state.toolItemsByCallId.get(piEvent.toolCallId);
        events.push({
          type: "item/completed",
          threadId,
          providerThreadId: "",
          turnId: state.currentTurnId,
          item: translatePiToolResultItem({
            callId: piEvent.toolCallId,
            toolName: piEvent.toolName,
            content: piEvent.result,
            isError: piEvent.isError,
            startedItem,
            parentToolCallId: context?.parentToolCallId,
          }),
        });
        state.toolItemsByCallId.delete(piEvent.toolCallId);
        break;
      }

      case "tool_execution_update": {
        if (!state.currentTurnId) {
          return buildUnexpectedPiSdkEvent(piEvent, context);
        }
        events.push({
          type: "item/toolCall/progress",
          threadId,
          providerThreadId: "",
          turnId: state.currentTurnId,
          itemId: piEvent.toolCallId,
          message: extractPiToolProgressText(piEvent),
          ...(context?.parentToolCallId
            ? { parentToolCallId: context.parentToolCallId }
            : {}),
        });
        break;
      }

      default:
        break;
    }

    return events;
  }

  return {
    // -- Identity & launch -------------------------------------------------

    id: "pi",
    displayName: "Pi",
    capabilities,
    process: {
      command: opts?.processCommand ?? "node",
      args: opts?.processArgs ?? [resolveBridgePath()],
    },

    // -- Unified command builder -------------------------------------------

    buildCommand(command: AdapterCommand): JsonRpcMessage | null {
      switch (command.type) {
        case "initialize":
          return {
            jsonrpc: "2.0" as const,
            method: "initialize",
            params: { clientInfo: { name: "bb", version: "1.0.0" } },
          };
        case "thread/start": {
          const baseInstructions = command.options?.instructions ?? "";
          const config = buildPiConfig(command.threadId, command.options);
          const finalConfig: Record<string, unknown> = config ? { ...config } : {};
          if (command.options?.reasoningLevel) {
            finalConfig.model_reasoning_effort = command.options.reasoningLevel;
          }
          const dynamicTools = command.dynamicTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
          }));
          return {
            jsonrpc: "2.0" as const,
            method: "thread/start",
            params: {
              threadId: command.threadId,
              baseInstructions,
              ...(Object.keys(finalConfig).length > 0 ? { config: finalConfig } : {}),
              ...(command.options?.model ? { model: command.options.model } : {}),
              ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
            },
          };
        }
        case "thread/resume": {
          const threadId = command.providerThreadId ?? command.threadId;
          const baseInstructions = command.options?.instructions ?? "";
          const config = buildPiConfig(command.threadId, command.options);
          const finalConfig: Record<string, unknown> = config ? { ...config } : {};
          if (command.options?.reasoningLevel) {
            finalConfig.model_reasoning_effort = command.options.reasoningLevel;
          }
          const dynamicTools = command.dynamicTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
          }));
          return {
            jsonrpc: "2.0" as const,
            method: "thread/resume",
            params: {
              threadId,
              baseInstructions,
              ...(Object.keys(finalConfig).length > 0 ? { config: finalConfig } : {}),
              ...(command.options?.model ? { model: command.options.model } : {}),
              ...(command.resumePath ? { sessionPath: command.resumePath } : {}),
              ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
            },
          };
        }
        case "turn/start":
          return {
            jsonrpc: "2.0" as const,
            method: "turn/start",
            params: {
              threadId: command.providerThreadId ?? command.threadId,
              input: command.input,
              ...(command.options?.model ? { model: command.options.model } : {}),
            },
          };
        case "turn/steer":
          return {
            jsonrpc: "2.0" as const,
            method: "turn/steer",
            params: {
              threadId: command.providerThreadId ?? command.threadId,
              expectedTurnId: command.expectedTurnId,
              input: command.input,
            },
          };
        case "thread/stop":
          return null;
        case "thread/name/set":
          return null; // Pi doesn't support rename
      }
    },

    // -- Unified event translator ------------------------------------------

    translateEvent(
      event: unknown,
      context?: ProviderTranslationContext,
    ): ThreadEvent[] {
      return translatePiEvent(event, context);
    },

    // -- Tool call codec ---------------------------------------------------

    decodeToolCallRequest(request: JsonRpcMessage): ToolCallRequest | null {
      if (request.id == null) return null;
      return decodeProviderToolCallRequest(request.id, request.method, request.params);
    },

    // -- Provider capabilities ---------------------------------------------

    listModels() {
      return models();
    },
  };
}

// ---------------------------------------------------------------------------
// Pi SDK event extraction helpers
// ---------------------------------------------------------------------------

type PiAgentEndEvent = Extract<AgentSessionEvent, { type: "agent_end" }>;
type PiAssistantMessage = Extract<PiAgentEndEvent["messages"][number], { role: "assistant" }>;
type PiToolExecutionUpdateEvent = Extract<AgentSessionEvent, { type: "tool_execution_update" }>;

function findLastAssistantMessage(
  messages: PiAgentEndEvent["messages"],
): PiAssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant") {
      return message as PiAssistantMessage;
    }
  }
  return undefined;
}

function extractAssistantText(
  message: PiAssistantMessage,
): string | undefined {
  const content = message.content;
  const chunks: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      chunks.push(block.text);
    }
  }
  const text = chunks.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function extractPiTokenUsage(
  lastAssistant: PiAssistantMessage | undefined,
  cumulativeTokens: ThreadEventTokenUsageBreakdown,
): ThreadEventTokenUsage | undefined {
  const last = toAssistantUsageBreakdown(lastAssistant);

  if (!last) return undefined;

  // Accumulate into the per-thread cumulative total
  cumulativeTokens.totalTokens += last.totalTokens;
  cumulativeTokens.inputTokens += last.inputTokens;
  cumulativeTokens.cachedInputTokens += last.cachedInputTokens;
  cumulativeTokens.outputTokens += last.outputTokens;
  cumulativeTokens.reasoningOutputTokens += last.reasoningOutputTokens;

  return {
    total: { ...cumulativeTokens },
    last,
    modelContextWindow: null,
  };
}

function extractPiToolProgressText(
  event: PiToolExecutionUpdateEvent,
): string {
  const text = extractResultText(event.partialResult).trim();
  if (text.length > 0) {
    return text;
  }
  return `${event.toolName} progress update`;
}

function toAssistantUsageBreakdown(
  lastAssistant: PiAssistantMessage | undefined,
): ThreadEventTokenUsageBreakdown | undefined {
  const typedUsage = lastAssistant?.usage;
  if (!typedUsage) return undefined;

  const inputTokens = toNonNegativeNumber(typedUsage.input);
  const outputTokens = toNonNegativeNumber(typedUsage.output);
  const cachedInputTokens =
    toNonNegativeNumber(typedUsage.cacheRead) + toNonNegativeNumber(typedUsage.cacheWrite);
  const totalTokens = toNonNegativeNumber(typedUsage.totalTokens);

  return {
    totalTokens:
      totalTokens > 0 ? totalTokens : inputTokens + outputTokens + cachedInputTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}
