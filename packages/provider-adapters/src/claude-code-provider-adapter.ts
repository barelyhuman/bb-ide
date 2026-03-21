/**
 * Claude Code provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the Claude Code SDK bridge
 * process. The bridge communicates via JSON-RPC over stdin/stdout. The adapter
 * owns event translation: it takes raw `SDKMessage` from the Claude Agent SDK
 * and produces `BbProviderEvent[]`.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelInfo } from "@anthropic-ai/sdk/resources/models";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  AvailableModel,
  ModelReasoningEffort,
  ProviderCapabilities,
} from "@bb/core";
import { renderTemplate } from "@bb/templates";
import type { ClaudeCodeCommand } from "./bridges/claude-code/bridge.js";
import {
  decodeProviderToolCallRequest,
  encodeProviderToolCallResponse,
} from "./provider-tool-call-contract.js";
import {
  bashArgsSchema,
  fileEditArgsSchema,
  textBlockSchema,
  webSearchArgsSchema,
} from "./tool-arg-schemas.js";
import type {
  BbProviderEvent,
  BbProviderEventItem,
  BbProviderEventTokenUsage,
  BbProviderEventTokenUsageBreakdown,
  ProviderAdapter,
  ProviderLaunchConfiguration,
  ProviderRequest,
  ProviderThreadContext,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Claude Code event and command types
// ---------------------------------------------------------------------------

/** The raw SDK message type from the Claude Agent SDK. */
export type ClaudeCodeEvent = SDKMessage;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_BASE_INSTRUCTIONS = renderTemplate("agentBaseInstructions", {});

const LOW_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "low",
  description: "Low reasoning effort",
};
const MEDIUM_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "medium",
  description: "Medium reasoning effort",
};
const HIGH_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "high",
  description: "High reasoning effort",
};
const XHIGH_REASONING_EFFORT: ModelReasoningEffort = {
  reasoningEffort: "xhigh",
  description: "Extra high reasoning effort",
};

const STATIC_CLAUDE_CODE_MODELS: AvailableModel[] = [
  {
    id: "claude-sonnet-4-6",
    model: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    description: "Fast, intelligent model for everyday coding tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
  {
    id: "claude-opus-4-6",
    model: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    description: "Most capable model for complex coding tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
  {
    id: "claude-haiku-4-5",
    model: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    description: "Fast, compact model for simple tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT],
    defaultReasoningEffort: "low",
    isDefault: false,
  },
];

const CLAUDE_DEFAULT_MODEL_PREFERENCES = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-opus-4-6",
  "claude-haiku-4-5",
] as const;

const CLAUDE_CODE_AUTH_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

// ---------------------------------------------------------------------------
// Claude Code–specific helpers
// ---------------------------------------------------------------------------

function resolveBridgePath(): string {
  return resolve(__dirname, "bridges", "claude-code", "bridge.js");
}

function resolveClaudeCodeLaunchEnv(
  launchEnv?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const varName of CLAUDE_CODE_AUTH_ENV_VARS) {
    const value = process.env[varName];
    if (value) env[varName] = value;
  }
  if (launchEnv) Object.assign(env, launchEnv);
  return env;
}

function isClaudeCodeAuthConfigured(launchEnv?: Record<string, string>): boolean {
  const env = resolveClaudeCodeLaunchEnv(launchEnv);
  return CLAUDE_CODE_AUTH_ENV_VARS.some((varName) => {
    const value = env[varName];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function resolveBaseInstructions(developerInstructions?: string): string {
  const trimmed = developerInstructions?.trim();
  if (!trimmed) return DEFAULT_BASE_INSTRUCTIONS;
  if (trimmed === DEFAULT_BASE_INSTRUCTIONS || trimmed.startsWith(`${DEFAULT_BASE_INSTRUCTIONS}\n`)) {
    return trimmed;
  }
  return `${DEFAULT_BASE_INSTRUCTIONS}\n\n${trimmed}`;
}

function buildClaudeCodeConfig(context: ProviderThreadContext): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (context.projectId) config["shell_environment_policy.set.BB_PROJECT_ID"] = context.projectId;
  if (context.threadId) config["shell_environment_policy.set.BB_THREAD_ID"] = context.threadId;
  if (context.serverUrl) config["shell_environment_policy.set.BB_SERVER_URL"] = context.serverUrl;
  if (context.path) config["shell_environment_policy.set.PATH"] = context.path;
  return Object.keys(config).length > 0 ? config : undefined;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export function buildClaudeCodeAvailableModels(
  modelInfos: ModelInfo[],
): AvailableModel[] {
  const models = modelInfos
    .filter((model) => model.id.startsWith("claude-"))
    .map((model) => {
      const supportedReasoningEfforts = getClaudeReasoningEfforts(model.id);
      return {
        id: model.id,
        model: model.id,
        displayName: model.display_name,
        description: describeClaudeModel(model.id),
        supportedReasoningEfforts,
        defaultReasoningEffort: supportedReasoningEfforts.some(
          (e) => e.reasoningEffort === "medium",
        )
          ? ("medium" as const)
          : supportedReasoningEfforts[0].reasoningEffort,
        isDefault: false,
      };
    });

  const defaultId = resolveDefaultClaudeModelId(models);
  return models.map((m) => (m.id === defaultId ? { ...m, isDefault: true } : m));
}

async function listClaudeCodeModels(): Promise<AvailableModel[]> {
  if (!shouldFetchClaudeCodeModelsFromAnthropic(process.env)) {
    return [...STATIC_CLAUDE_CODE_MODELS];
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const client = new Anthropic({ ...(apiKey ? { apiKey } : {}) });
  const page = await client.models.list();
  const models = buildClaudeCodeAvailableModels(page.data);
  return models.length > 0 ? models : [...STATIC_CLAUDE_CODE_MODELS];
}

function shouldUseStaticClaudeModelList(env: NodeJS.ProcessEnv): boolean {
  return (
    env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    env.CLAUDE_CODE_USE_VERTEX === "1" ||
    env.CLAUDE_CODE_USE_FOUNDRY === "1"
  );
}

export function shouldFetchClaudeCodeModelsFromAnthropic(
  env: NodeJS.ProcessEnv,
): boolean {
  if (shouldUseStaticClaudeModelList(env)) return false;
  return !!env.ANTHROPIC_API_KEY?.trim();
}

function getClaudeReasoningEfforts(modelId: string): ModelReasoningEffort[] {
  if (modelId.startsWith("claude-haiku")) {
    return [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT];
  }
  if (modelId.startsWith("claude-opus-4-6")) {
    return [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT, XHIGH_REASONING_EFFORT];
  }
  return [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT];
}

function describeClaudeModel(modelId: string): string {
  if (modelId.startsWith("claude-opus")) return "Most capable Claude model for complex coding tasks";
  if (modelId.startsWith("claude-haiku")) return "Fast Claude model for lightweight coding tasks";
  return "Fast, intelligent Claude model for everyday coding tasks";
}

function resolveDefaultClaudeModelId(models: AvailableModel[]): string | undefined {
  for (const preferred of CLAUDE_DEFAULT_MODEL_PREFERENCES) {
    if (models.some((m) => m.id === preferred)) return preferred;
  }
  return models[0]?.id;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/** Options for overriding claude-code adapter defaults. Used by test infrastructure. */
export interface CreateClaudeCodeProviderAdapterOptions {
  /** Override the bridge binary. */
  processCommand?: string;
  /** Override the bridge binary args. */
  processArgs?: string[];
  /** Extra environment variables for the bridge process. */
  launchEnv?: Record<string, string>;
  /** Override model listing. Used by unit tests to avoid real API calls. */
  listModels?: () => Promise<AvailableModel[]>;
}

export function createClaudeCodeProviderAdapter(
  opts?: CreateClaudeCodeProviderAdapterOptions,
): ProviderAdapter<ClaudeCodeEvent, ClaudeCodeCommand> {
  const capabilities: ProviderCapabilities = {
    supportsRename: false,
    supportsServiceTier: false,
  };
  const models = opts?.listModels ?? listClaudeCodeModels;

  // Turn counter state — the Claude SDK doesn't have turn IDs, so the adapter
  // assigns them. This state persists across translateEvent calls.
  let turnCounter = 0;
  let currentTurnId: string | undefined;

  function nextTurnId(): string {
    turnCounter += 1;
    return `turn-${turnCounter}`;
  }

  return {
    // -- Identity & launch -------------------------------------------------

    id: "claude-code",
    displayName: "Claude Code",
    capabilities,
    process: {
      command: opts?.processCommand ?? "node",
      args: opts?.processArgs ?? [resolveBridgePath()],
    },

    async resolveLaunchConfiguration(): Promise<ProviderLaunchConfiguration | undefined> {
      const env = resolveClaudeCodeLaunchEnv(opts?.launchEnv);
      if (Object.keys(env).length === 0) return undefined;
      return { env };
    },

    preflightSessionStart(): string | undefined {
      if (isClaudeCodeAuthConfigured(opts?.launchEnv)) return undefined;
      return "Claude Code authentication is unavailable. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.";
    },

    // -- Unified command builder -------------------------------------------

    buildCommand(request: ProviderRequest): ClaudeCodeCommand | null {
      switch (request.type) {
        case "initialize":
          return { method: "initialize", params: { clientInfo: request.clientInfo } };
        case "thread/start": {
          const baseInstructions = resolveBaseInstructions(request.req.developerInstructions);
          const config = buildClaudeCodeConfig(request.context);
          const dynamicTools = request.dynamicTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
          }));
          return {
            method: "thread/start",
            params: {
              baseInstructions,
              threadId: request.context.threadId,
              ...(config ? { config } : {}),
              ...(request.req.model ? { model: request.req.model } : {}),
              ...(request.req.reasoningLevel ? { config: { ...config, model_reasoning_effort: request.req.reasoningLevel } } : {}),
              ...(request.req.type === "manager" ? { managerMode: true } : {}),
              ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
            },
          };
        }
        case "thread/resume":
          return {
            method: "thread/resume",
            params: {
              threadId: request.context.threadId,
              providerThreadId: request.providerThreadId ?? null,
              ...(buildClaudeCodeConfig(request.context) ? { config: buildClaudeCodeConfig(request.context) } : {}),
              ...(request.options?.model ? { model: request.options.model } : {}),
              ...(request.options?.reasoningLevel ? { config: { ...buildClaudeCodeConfig(request.context), model_reasoning_effort: request.options.reasoningLevel } } : {}),
            },
          };
        case "turn/start":
          return {
            method: "turn/start",
            params: {
              threadId: request.threadId,
              providerThreadId: request.providerThreadId ?? null,
              input: request.input,
              ...(request.options?.model ? { model: request.options.model } : {}),
              ...(request.options?.reasoningLevel ? { config: { model_reasoning_effort: request.options.reasoningLevel } } : {}),
            },
          };
        case "turn/steer":
          return {
            method: "turn/steer",
            params: {
              threadId: request.threadId,
              providerThreadId: request.providerThreadId ?? null,
              expectedTurnId: request.expectedTurnId,
              input: request.input,
            },
          };
        case "thread/name/set":
          return null; // Claude Code doesn't support rename
      }
    },

    // -- Unified event translator ------------------------------------------

    translateEvent(message: ClaudeCodeEvent): BbProviderEvent[] {
      // threadId is not available from SDKMessage — the bridge/env-daemon
      // supplies it from the session context. We use "" here; the caller
      // overrides it.
      const threadId = "";
      const events: BbProviderEvent[] = [];

      switch (message.type) {
        case "system":
          // System init — no events emitted
          break;

        case "assistant": {
          if (!currentTurnId) {
            currentTurnId = nextTurnId();
            events.push({ type: "turn/started", threadId, turnId: currentTurnId });
          }

          const text = extractAssistantText(message);
          if (text) {
            events.push({
              type: "item/completed",
              threadId,
              turnId: currentTurnId,
              item: { type: "agentMessage", id: `msg-${turnCounter}`, text },
            });
          }

          const toolUses = extractToolUses(message);
          for (const toolUse of toolUses) {
            events.push({
              type: "item/started",
              threadId,
              turnId: currentTurnId,
              item: translateToolCallToItem(toolUse.id, toolUse.name, toolUse.input),
            });
          }
          break;
        }

        case "stream_event": {
          const delta = extractStreamTextDelta(message);
          if (delta && currentTurnId) {
            events.push({
              type: "item/agentMessage/delta",
              threadId,
              turnId: currentTurnId,
              delta,
            });
          }
          break;
        }

        case "user": {
          const toolResults = extractToolResults(message);
          for (const result of toolResults) {
            events.push({
              type: "item/completed",
              threadId,
              turnId: currentTurnId ?? "",
              item: translateToolResultToItem(
                result.toolUseId,
                result.toolName,
                result.content,
              ),
            });
          }
          break;
        }

        case "result": {
          const resultMessage = message as SDKResultMessage;
          if (currentTurnId) {
            const tokenUsage = extractTokenUsage(resultMessage);
            if (tokenUsage) {
              events.push({
                type: "thread/tokenUsage/updated",
                threadId,
                turnId: currentTurnId,
                tokenUsage,
              });
            }
            events.push({
              type: "turn/completed",
              threadId,
              turnId: currentTurnId,
              status: resultMessage.subtype.startsWith("error") ? "failed" : "completed",
            });
            currentTurnId = undefined;
          }
          break;
        }

        default:
          break;
      }

      return events;
    },

    // -- Tool call codec ---------------------------------------------------

    decodeToolCallRequest({ requestId, method, params }) {
      return decodeProviderToolCallRequest(requestId, method, params);
    },

    encodeToolCallResponse(response) {
      return encodeProviderToolCallResponse(response);
    },

    // -- Provider capabilities ---------------------------------------------

    listModels() {
      return models();
    },
  };
}

// ---------------------------------------------------------------------------
// SDK message parsing — Zod schemas for opaque SDK types
// ---------------------------------------------------------------------------

const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  tool_name: z.string().optional(),
  content: z.unknown(),
});

const messageContentSchema = z.object({
  content: z.array(z.object({ type: z.string() }).passthrough()).optional(),
}).passthrough();

const sdkUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
}).passthrough();

const contentBlockDeltaSchema = z.object({
  type: z.literal("content_block_delta"),
  delta: z.object({ type: z.literal("text_delta"), text: z.string() }).passthrough(),
}).passthrough();

const contentBlockStartSchema = z.object({
  type: z.literal("content_block_start"),
  content_block: z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
}).passthrough();

const streamEventSchema = z.union([contentBlockDeltaSchema, contentBlockStartSchema]);

// ---------------------------------------------------------------------------
// SDK message extraction helpers
// ---------------------------------------------------------------------------

function parseMessageContent(
  message: { message: unknown },
): Array<{ type: string } & Record<string, unknown>> {
  const parsed = messageContentSchema.safeParse(message.message);
  return parsed.success ? (parsed.data.content ?? []) : [];
}

function extractAssistantText(
  message: Extract<SDKMessage, { type: "assistant" }>,
): string | undefined {
  const chunks: string[] = [];
  for (const block of parseMessageContent(message)) {
    const text = textBlockSchema.safeParse(block);
    if (text.success) chunks.push(text.data.text);
  }
  const joined = chunks.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

function extractToolUses(
  message: Extract<SDKMessage, { type: "assistant" }>,
): Array<{ id: string; name: string; input: unknown }> {
  const uses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of parseMessageContent(message)) {
    const tool = toolUseBlockSchema.safeParse(block);
    if (tool.success) uses.push({ id: tool.data.id, name: tool.data.name, input: tool.data.input });
  }
  return uses;
}

function extractStreamTextDelta(
  message: Extract<SDKMessage, { type: "stream_event" }>,
): string | undefined {
  const parsed = streamEventSchema.safeParse(message.event);
  if (!parsed.success) return undefined;

  if (parsed.data.type === "content_block_delta") {
    return parsed.data.delta.text.length > 0 ? parsed.data.delta.text : undefined;
  }
  return parsed.data.content_block.text.length > 0 ? parsed.data.content_block.text : undefined;
}

function extractToolResults(
  message: Extract<SDKMessage, { type: "user" }>,
): Array<{ toolUseId: string; toolName?: string; content: unknown }> {
  const results: Array<{ toolUseId: string; toolName?: string; content: unknown }> = [];
  for (const block of parseMessageContent(message)) {
    const result = toolResultBlockSchema.safeParse(block);
    if (result.success) {
      results.push({
        toolUseId: result.data.tool_use_id,
        toolName: result.data.tool_name,
        content: result.data.content,
      });
    }
  }
  return results;
}

function extractTokenUsage(message: SDKResultMessage): BbProviderEventTokenUsage | undefined {
  const parsed = sdkUsageSchema.safeParse(message.usage);
  const total = parsed.success ? toTokenUsageBreakdown(parsed.data) : undefined;
  const modelContextWindow = extractModelContextWindow(message.modelUsage);

  if (!total && modelContextWindow === null) {
    return undefined;
  }

  const emptyBreakdown: BbProviderEventTokenUsageBreakdown = {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };

  return {
    total: total ?? emptyBreakdown,
    last: total ?? emptyBreakdown,
    modelContextWindow,
  };
}

function toTokenUsageBreakdown(
  usage: z.infer<typeof sdkUsageSchema>,
): BbProviderEventTokenUsageBreakdown {
  const inputTokens = toNonNegativeNumber(usage.input_tokens);
  const outputTokens = toNonNegativeNumber(usage.output_tokens);
  const cacheReadTokens = toNonNegativeNumber(usage.cache_read_input_tokens);
  const cacheCreationTokens = toNonNegativeNumber(usage.cache_creation_input_tokens);
  const cachedInputTokens = cacheReadTokens + cacheCreationTokens;

  return {
    totalTokens: inputTokens + outputTokens + cachedInputTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}

function extractModelContextWindow(
  modelUsage: Record<string, { contextWindow: number }> | undefined,
): number | null {
  if (!modelUsage) return null;

  let largestContextWindow: number | null = null;
  for (const usage of Object.values(modelUsage)) {
    const contextWindow = toPositiveNumber(usage.contextWindow);
    if (contextWindow === null) continue;
    if (largestContextWindow === null || contextWindow > largestContextWindow) {
      largestContextWindow = contextWindow;
    }
  }

  return largestContextWindow;
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function toPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// ---------------------------------------------------------------------------
// Tool call → BbProviderEventItem translation
// ---------------------------------------------------------------------------

const BASH_TOOLS = new Set(["Bash", "bash"]);
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "edit", "write"]);
const WEB_SEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);

function translateToolCallToItem(
  callId: string,
  toolName: string,
  args: unknown,
): BbProviderEventItem {
  if (BASH_TOOLS.has(toolName)) {
    const parsed = bashArgsSchema.safeParse(args);
    return {
      type: "commandExecution",
      id: callId,
      command: parsed.success ? String(parsed.data.command ?? "") : "",
      cwd: parsed.success && typeof parsed.data.cwd === "string" ? parsed.data.cwd : "",
      status: "pending",
    };
  }

  if (FILE_EDIT_TOOLS.has(toolName)) {
    const parsed = fileEditArgsSchema.safeParse(args);
    const filePath = parsed.success
      ? (parsed.data.file_path ?? parsed.data.path ?? "")
      : "";
    return {
      type: "fileChange",
      id: callId,
      changes: [{ path: filePath, kind: "update" as const }],
      status: "pending",
    };
  }

  if (WEB_SEARCH_TOOLS.has(toolName)) {
    const parsed = webSearchArgsSchema.safeParse(args);
    return {
      type: "webSearch",
      id: callId,
      query: parsed.success ? String(parsed.data.query ?? parsed.data.url ?? "") : "",
    };
  }

  return {
    type: "toolCall",
    id: callId,
    tool: toolName,
    arguments: args,
    status: "pending",
  };
}

function translateToolResultToItem(
  callId: string,
  toolName: string | undefined,
  content: unknown,
): BbProviderEventItem {
  const outputText = extractResultText(content);

  if (toolName && BASH_TOOLS.has(toolName)) {
    return {
      type: "commandExecution",
      id: callId,
      command: "",
      cwd: "",
      aggregatedOutput: outputText,
      exitCode: 0,
      status: "completed",
    };
  }

  if (toolName && FILE_EDIT_TOOLS.has(toolName)) {
    return {
      type: "fileChange",
      id: callId,
      changes: [],
      status: "completed",
    };
  }

  if (toolName && WEB_SEARCH_TOOLS.has(toolName)) {
    return {
      type: "webSearch",
      id: callId,
      query: "",
    };
  }

  return {
    type: "toolCall",
    id: callId,
    tool: toolName ?? "unknown",
    status: "completed",
    result: outputText,
  };
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");

  const chunks: string[] = [];
  for (const block of content) {
    const parsed = textBlockSchema.safeParse(block);
    if (parsed.success) {
      chunks.push(parsed.data.text);
    }
  }
  return chunks.join("\n");
}
