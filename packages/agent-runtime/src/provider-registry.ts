/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and adapter factories
 * (codex, claude-code, pi).
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
interface BuiltInProviderDescriptor {
  createAdapter: ProviderFactory;
  info: ProviderInfo;
}

const builtInProviders = [
  {
    createAdapter: createCodexProviderAdapter,
    info: {
      id: "codex",
      displayName: "Codex",
      capabilities: {
        supportsRename: true,
        supportsServiceTier: true,
      },
      available: true,
    },
  },
  {
    createAdapter: createClaudeCodeProviderAdapter,
    info: {
      id: "claude-code",
      displayName: "Claude Code",
      capabilities: {
        supportsRename: false,
        supportsServiceTier: false,
      },
      available: true,
    },
  },
  {
    createAdapter: createPiProviderAdapter,
    info: {
      id: "pi",
      displayName: "Pi",
      capabilities: {
        supportsRename: false,
        supportsServiceTier: false,
      },
      available: true,
    },
  },
] satisfies BuiltInProviderDescriptor[];

const builtInProvidersById = new Map(
  builtInProviders.map((descriptor) => [descriptor.info.id, descriptor]),
);

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
  const descriptor = builtInProvidersById.get(providerId);

  if (!descriptor) {
    const allIds = builtInProviders.map((provider) => provider.info.id);
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  return descriptor.createAdapter();
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
  return builtInProviders.map(({ info }) => ({
    ...info,
    capabilities: { ...info.capabilities },
  }));
}
