/**
 * Provider registry.
 *
 * Manages the set of available built-in provider adapters (codex, claude-code, pi).
 */

import { createClaudeCodeProviderAdapter } from "./claude-code/adapter.js";
import { claudeCodeVisibilityMetadata } from "./claude-code/visibility.js";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import { codexVisibilityMetadata } from "./codex/visibility.js";
import { createPiProviderAdapter } from "./pi/adapter.js";
import { piVisibilityMetadata } from "./pi/visibility.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { ProviderVisibilityMetadata } from "./provider-visibility.js";
import type { ProviderInfo } from "./types.js";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

type ProviderFactory = () => ProviderAdapter;

const builtInFactories = new Map<string, ProviderFactory>([
  ["codex", createCodexProviderAdapter],
  ["claude-code", createClaudeCodeProviderAdapter],
  ["pi", createPiProviderAdapter],
]);

const builtInVisibility = new Map<string, ProviderVisibilityMetadata>([
  ["codex", codexVisibilityMetadata],
  ["claude-code", claudeCodeVisibilityMetadata],
  ["pi", piVisibilityMetadata],
]);

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Create a provider adapter by ID.
 *
 * Looks up built-in providers. Throws if the ID is not found.
 */
export function createProviderForId(providerId: string): ProviderAdapter {
  const factory = builtInFactories.get(providerId);

  if (!factory) {
    const allIds = [...builtInFactories.keys()];
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  return factory();
}

export function getProviderVisibilityMetadata(
  providerId: string,
): ProviderVisibilityMetadata {
  const metadata = builtInVisibility.get(providerId);

  if (!metadata) {
    const allIds = [...builtInVisibility.keys()];
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  return metadata;
}

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  const infos: ProviderInfo[] = [];

  for (const [id] of builtInFactories) {
    const provider = createProviderForId(id);
    infos.push({
      id: provider.id,
      displayName: provider.displayName,
      capabilities: { ...provider.capabilities },
      available: true,
    });
  }

  return infos;
}
