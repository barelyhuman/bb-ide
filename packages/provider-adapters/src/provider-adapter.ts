import type {
  AvailableModel,
  PromptInput,
  ProviderCapabilities,
  SpawnThreadRequest,
} from "@bb/core";
import type { ReasoningLevel, SandboxMode, ServiceTier } from "@bb/core";

// ---------------------------------------------------------------------------
// BbProviderEvent — the canonical inbound event type
//
// This is a closed, discriminated union of every event that flows from
// providers into bb. Each adapter's `translateEvent` maps its native events
// into `BbProviderEvent[]`. Downstream code (to-ui-messages, persist,
// broadcast, env-daemon) works with `BbProviderEvent` directly.
//
// See plans/bb-event-design.md for the full design rationale.
// ---------------------------------------------------------------------------

// --- Supporting types ---

export type BbProviderEventItemStatus = "pending" | "completed" | "failed" | "interrupted";

export type BbProviderEventTurnStatus = "completed" | "failed" | "interrupted";

export type BbProviderEventFileChangeKind = "add" | "delete" | "update";

export interface BbProviderEventFileChange {
  path: string;
  kind: BbProviderEventFileChangeKind;
  /** Target path for renames/moves. Only present when kind is "update". */
  movePath?: string;
  /** Unified diff content. */
  diff?: string;
}

export type BbProviderEventPlanStepStatus = "pending" | "active" | "completed" | "failed";

export interface BbProviderEventPlanStep {
  step: string;
  status?: BbProviderEventPlanStepStatus;
}

export type BbProviderEventUserContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "localFile"; path: string };

export interface BbProviderEventTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface BbProviderEventTokenUsage {
  total: BbProviderEventTokenUsageBreakdown;
  last: BbProviderEventTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export type BbProviderEventWarningCategory = "deprecation" | "config" | "general";

// --- Item types ---

export type BbProviderEventItem =
  | { type: "userMessage"; id: string; content: BbProviderEventUserContent[] }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: BbProviderEventItemStatus;
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | {
      type: "fileChange";
      id: string;
      changes: BbProviderEventFileChange[];
      status: BbProviderEventItemStatus;
    }
  | { type: "webSearch"; id: string; query: string; action?: string }
  | {
      type: "toolCall";
      id: string;
      server?: string;
      tool: string;
      arguments?: unknown;
      status: BbProviderEventItemStatus;
      result?: unknown;
      error?: string;
      durationMs?: number;
    }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "plan"; id: string; text: string }
  | { type: "contextCompaction"; id: string };

// --- Event union ---

export type BbProviderEvent =
  // Turn lifecycle
  | { type: "turn/started"; threadId: string; turnId: string }
  | {
      type: "turn/completed";
      threadId: string;
      turnId: string;
      status: BbProviderEventTurnStatus;
      error?: { message: string };
    }

  // Thread lifecycle
  | { type: "thread/started"; threadId: string }
  | { type: "thread/identity"; threadId: string; providerThreadId: string }
  | { type: "thread/name/updated"; threadId: string; threadName: string }
  | { type: "thread/compacted"; threadId: string }

  // Items
  | { type: "item/started"; threadId: string; turnId: string; item: BbProviderEventItem }
  | { type: "item/completed"; threadId: string; turnId: string; item: BbProviderEventItem }

  // Streaming deltas
  | { type: "item/agentMessage/delta"; threadId: string; turnId: string; itemId?: string; delta: string }
  | { type: "item/commandExecution/outputDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item/fileChange/outputDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item/reasoning/summaryTextDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item/reasoning/textDelta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item/plan/delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { type: "item/mcpToolCall/progress"; threadId: string; turnId: string; itemId: string; message?: string }

  // Token usage
  | { type: "thread/tokenUsage/updated"; threadId: string; turnId: string; tokenUsage: BbProviderEventTokenUsage }

  // Plan/diff
  | { type: "turn/plan/updated"; threadId: string; turnId: string; plan: BbProviderEventPlanStep[]; explanation?: string }
  | { type: "turn/diff/updated"; threadId: string; turnId: string; diff?: string }

  // Errors
  | { type: "error"; threadId: string; turnId?: string; message: string; detail?: string; willRetry?: boolean }

  // Warnings
  | { type: "warning"; threadId: string; category: BbProviderEventWarningCategory; summary?: string; details?: string };

// ---------------------------------------------------------------------------
// ProviderRequest — bb's discriminated union for all outbound requests
//
// Every request has a `type`. Every thread-scoped request has a `threadId`.
// The adapter translates these into provider-specific commands.
// ---------------------------------------------------------------------------

export type ProviderRequest =
  | {
      type: "initialize";
      clientInfo: { name: string; version: string };
    }
  | {
      type: "thread/start";
      threadId: string;
      req: SpawnThreadRequest;
      context: ProviderThreadContext;
      dynamicTools?: ProviderDynamicTool[];
    }
  | {
      type: "thread/resume";
      threadId: string;
      providerThreadId: string | undefined;
      context: ProviderThreadContext;
      options?: ProviderExecutionOptions;
      resumePath?: string;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string | undefined;
      input: PromptInput[];
      options?: ProviderExecutionOptions;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string | undefined;
      expectedTurnId: string;
      input: PromptInput[];
    }
  | {
      type: "thread/name/set";
      threadId: string;
      providerThreadId: string | undefined;
      title: string;
    };

// ---------------------------------------------------------------------------
// Execution and context types
// ---------------------------------------------------------------------------

export interface ProviderExecutionOptions {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  sandboxMode?: SandboxMode;
}

export interface ProviderThreadContext {
  projectId: string;
  threadId: string;
  serverUrl?: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Dynamic tool types
//
// `inputSchema` is a JSON Schema object supplied by extensions at runtime.
// bb never inspects it — it passes it through to the provider process.
// ---------------------------------------------------------------------------

export interface ProviderDynamicTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. Genuinely dynamic — bb does not inspect. */
  inputSchema: unknown;
}

// ---------------------------------------------------------------------------
// Tool call types
//
// `arguments` is the dynamic tool input from the provider. Each tool defines
// its own shape via `inputSchema` above — bb does not inspect the args.
// ---------------------------------------------------------------------------

export interface ProviderToolCallRequest {
  requestId: string | number;
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  /** Dynamic tool arguments from the provider. bb does not inspect. */
  arguments: unknown;
}

export type ProviderToolCallOutputItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string };

export interface ProviderToolCallResponse {
  contentItems: ProviderToolCallOutputItem[];
  success: boolean;
}

// ---------------------------------------------------------------------------
// LLM completion types
// ---------------------------------------------------------------------------

export interface ProviderTitleGeneratorArgs {
  input: PromptInput[];
  cwd: string;
}

export type ProviderTitleGenerator = (
  args: ProviderTitleGeneratorArgs,
) => Promise<string | undefined>;

export interface ProviderCommitMessageGeneratorArgs {
  cwd: string;
  includeUnstaged?: boolean;
}

export type ProviderCommitMessageGenerator = (
  args: ProviderCommitMessageGeneratorArgs,
) => Promise<string | undefined>;

// ---------------------------------------------------------------------------
// Launch configuration
// ---------------------------------------------------------------------------

export type ProviderLaunchFilePlacement = "home";

export interface ProviderLaunchFile {
  path: string;
  content: string;
  placement: ProviderLaunchFilePlacement;
}

export interface ProviderLaunchConfiguration {
  env?: Record<string, string>;
  files?: ProviderLaunchFile[];
}

// ---------------------------------------------------------------------------
// ProviderAdapter — the extension contract
//
// This is the interface that each provider (codex, claude-code, pi, and future
// extensions) implements. It is the single translation layer between bb and
// each provider.
//
// Generic type parameters:
//   TProviderEvent  — the raw event type from the provider's SDK/bridge
//   TProviderCommand — the command type the provider process understands
//
// Consumers that don't need the specific types use the defaults (unknown).
// The env-daemon stores `ProviderAdapter` and serializes whatever
// `buildCommand` returns. Each adapter validates `TProviderEvent` internally.
// ---------------------------------------------------------------------------

export interface ProviderAdapter<
  TProviderEvent,
  TProviderCommand,
> {
  // -- Identity & launch ---------------------------------------------------

  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[] };

  resolveLaunchConfiguration?(
    context: ProviderThreadContext,
  ):
    | ProviderLaunchConfiguration
    | Promise<ProviderLaunchConfiguration | undefined>
    | undefined;

  /** Return an error message if the provider cannot start, or undefined if ok. */
  preflightSessionStart?():
    | string
    | undefined
    | Promise<string | undefined>;

  // -- Outbound: bb request → provider command -----------------------------

  /**
   * Translate a bb request into a provider-specific command.
   * Returns `null` for unsupported operations (e.g. `thread/name/set` on a
   * provider that doesn't support rename).
   */
  buildCommand(request: ProviderRequest): TProviderCommand | null;

  // -- Inbound: provider event → bb events --------------------------------

  /**
   * Translate a raw provider event into bb events.
   * The event arrives as parsed JSON from the bridge process. The adapter
   * validates it against the expected shape and translates to zero or more
   * strongly-typed `BbEvent` values.
   */
  translateEvent(event: TProviderEvent): BbProviderEvent[];

  // -- Tool call codec -----------------------------------------------------

  decodeToolCallRequest(args: {
    requestId: string | number;
    method: string;
    params: Record<string, unknown>;
  }): ProviderToolCallRequest | null;

  encodeToolCallResponse(
    response: ProviderToolCallResponse,
  ): ProviderToolCallResponse;

  // -- Provider capabilities -----------------------------------------------

  listModels(): Promise<AvailableModel[]>;
}
