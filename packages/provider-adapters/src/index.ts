// ---------------------------------------------------------------------------
// Contract types — what extension authors implement
// ---------------------------------------------------------------------------

export type {
  ProviderAdapter,
  ProviderRequest,
  BbProviderEvent,
  BbProviderEventItem,
  BbProviderEventItemStatus,
  BbProviderEventTurnStatus,
  BbProviderEventFileChange,
  BbProviderEventFileChangeKind,
  BbProviderEventPlanStep,
  BbProviderEventPlanStepStatus,
  BbProviderEventUserContent,
  BbProviderEventTokenUsage,
  BbProviderEventTokenUsageBreakdown,
  BbProviderEventWarningCategory,
  ProviderExecutionOptions,
  ProviderThreadContext,
  ProviderDynamicTool,
  ProviderToolCallRequest,
  ProviderToolCallResponse,
  ProviderToolCallOutputItem,
  ProviderLaunchConfiguration,
  ProviderLaunchFile,
  ProviderLaunchFilePlacement,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Adapter helpers — standalone utilities (not on the ProviderAdapter interface)
// ---------------------------------------------------------------------------

// Standalone utilities — used by server consumers, not by adapters.
// These will move to @bb/core once consumers are migrated.
export {
  deriveThreadTitleFromInput,
  normalizeTitle,
  outputFromEvent,
} from "./adapter-helpers.js";

// ---------------------------------------------------------------------------
// Provider registry — lookup, registration, and default resolution
// ---------------------------------------------------------------------------

export type { CreateProviderAdapterOptions } from "./provider-registry.js";
export {
  createProviderAdapter,
  createProviderForId,
  listAvailableProviderInfos,
  registerProvider,
  unregisterProvider,
  clearExtensionProviders,
  resolveDefaultProviderId,
} from "./provider-registry.js";

// ---------------------------------------------------------------------------
// Built-in adapter factories
// ---------------------------------------------------------------------------

export { createCodexProviderAdapter } from "./codex-provider-adapter.js";
export { createClaudeCodeProviderAdapter } from "./claude-code-provider-adapter.js";
export { createPiProviderAdapter } from "./pi-provider-adapter.js";

// ---------------------------------------------------------------------------
// Tool hosting
// ---------------------------------------------------------------------------

export type { ProviderToolDefinition } from "./provider-tool-host.js";
export { ProviderToolHost } from "./provider-tool-host.js";

// ---------------------------------------------------------------------------
// LLM completion services
// ---------------------------------------------------------------------------

export type {
  ProviderCommitMessageGenerator,
  ProviderCommitMessageGeneratorArgs,
  ProviderTitleGenerator,
  ProviderTitleGeneratorArgs,
} from "./provider-adapter.js";

export type {
  LlmCompletionService,
  LlmThreadTitleGenerationArgs,
  LlmThreadTitleGenerator,
  LlmCommitMessageGenerationArgs,
  LlmCommitMessageGenerator,
  CreateLlmCompletionServiceOptions,
} from "./llm-completion.js";

export {
  createLlmCompletionService,
  createCodexLlmCompletionService,
} from "./llm-completion.js";

export { generateCodexThreadTitle } from "./codex-title-generator.js";
export { generateCodexCommitMessage } from "./codex-commit-message-generator.js";
export { generateOpenAIResponsesText } from "./openai-responses-model.js";
