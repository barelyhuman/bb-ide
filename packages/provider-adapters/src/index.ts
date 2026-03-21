// ---------------------------------------------------------------------------
// Adapter interface and request types
// ---------------------------------------------------------------------------

export type {
  ProviderAdapter,
  ProviderRequest,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Provider registry
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
